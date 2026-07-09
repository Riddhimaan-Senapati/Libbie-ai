// Retrieval-augmented grounding over the indexed pipeline corpus.
//
// This is real retrieval, not a lookup table: the question is scored against
// every code file and every conversation, the best-matching code line(s) and
// conversation are selected, and a grounded prompt is built from them. The
// local LLM then synthesises the verdict from that context. The dual citation
// shown to the user is derived from what retrieval actually selected.

import { pipeline, conversations, getCodeFile, getConversation } from "@/lib/data";
import type { CodeRef, Conversation } from "@/lib/types";
import type { ChatMessage, Chunk, Hit } from "@/lib/tauri";
import * as api from "@/lib/tauri";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "for", "with", "as", "at", "by", "it", "this", "that",
  "why", "how", "what", "when", "which", "was", "not", "instead", "set", "than",
  "built", "made", "use", "used", "using", "does", "do", "did", "so", "we", "our",
  // generic, non-discriminative domain words that add noise to retrieval:
  "pipeline", "version", "value", "run", "flag", "file", "config", "param", "params",
  "as", "high", "low", "default", "latest",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t),
  );
}

/**
 * Weighted term frequency: exact token matches are worth far more than loose
 * substring matches, so discriminative tokens (grch37, mapq, gatk…) dominate
 * over generic ones.
 */
function count(haystackTokens: string[], term: string): number {
  let n = 0;
  for (const t of haystackTokens) {
    if (t === term) n += 3;
    else if (term.length >= 4 && t.includes(term)) n += 1;
  }
  return n;
}

export interface Retrieved {
  code: CodeRef[];
  conversations: Conversation[];
  confidence: number;
  /** The grounded context block fed to the model. */
  context: string;
  /** How this evidence was retrieved. */
  mode: "vector" | "lexical";
}

interface ScoredFile {
  path: string;
  score: number;
  line: number;
  lineText: string;
  symbol: string;
}

/** Score every code file and select the best-matching line within the winners. */
function retrieveCode(queryTokens: string[]): ScoredFile[] {
  const scored: ScoredFile[] = [];
  for (const file of pipeline.files) {
    const pathTokens = tokenize(file.path);
    const descTokens = tokenize(file.description);
    const lines = file.content.split("\n");

    let score = 0;
    for (const q of queryTokens) {
      score += count(pathTokens, q) * 4;
      score += count(descTokens, q) * 3;
    }

    // Best matching line inside the file.
    let bestLine = 0;
    let bestLineScore = 0;
    lines.forEach((line, i) => {
      const lt = tokenize(line);
      let ls = 0;
      for (const q of queryTokens) ls += count(lt, q);
      score += ls; // whole-file recall
      if (ls > bestLineScore) {
        bestLineScore = ls;
        bestLine = i;
      }
    });

    if (score > 0 && bestLineScore > 0) {
      const lineText = lines[bestLine] ?? "";
      scored.push({
        path: file.path,
        score,
        line: bestLine + 1, // 1-based
        lineText: lineText.trim(),
        symbol: deriveSymbol(lineText),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Extract a readable symbol/param name from a code line for the citation. */
function deriveSymbol(line: string): string {
  const trimmed = line.trim();
  const param = trimmed.match(/([a-zA-Z_][\w.]*)\s*[:=]/);
  if (param) return param[1];
  const kv = trimmed.match(/^([a-zA-Z0-9_.-]+)/);
  if (kv) return kv[1];
  return trimmed.slice(0, 40) || "cited line";
}

interface ScoredConv {
  conv: Conversation;
  score: number;
}

function retrieveConversations(queryTokens: string[]): ScoredConv[] {
  const scored: ScoredConv[] = [];
  for (const conv of conversations) {
    const titleTokens = tokenize(conv.title);
    let score = 0;
    for (const q of queryTokens) score += count(titleTokens, q) * 3;
    for (const m of conv.messages) {
      const bodyTokens = tokenize(m.body);
      let ms = 0;
      for (const q of queryTokens) ms += count(bodyTokens, q);
      score += m.pivotal ? ms * 2 : ms;
    }
    // Explicit code references in the conversation boost precision.
    for (const q of queryTokens) {
      for (const ref of conv.references) {
        if (ref.toLowerCase().includes(q)) score += 2;
      }
    }
    if (score > 0) scored.push({ conv, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Retrieve the top code + conversation evidence for a question and build the
 * grounded context block.
 */
export function retrieve(question: string): Retrieved {
  const q = tokenize(question);

  const codeHits = retrieveCode(q).slice(0, 2);
  const convHits = retrieveConversations(q).slice(0, 2);

  const convs = convHits.map((h) => h.conv);

  // Confidence: reward having BOTH sides (the fusion signal), scaled by score.
  const topCode = codeHits[0]?.score ?? 0;
  const topConv = convHits[0]?.score ?? 0;
  let confidence = 0.4;
  if (topCode > 0) confidence += 0.25;
  if (topConv > 0) confidence += 0.2;
  if (topCode >= 4 && topConv >= 4) confidence += 0.1;
  confidence = Math.min(0.96, confidence);

  return assemble(codeHits, convs, confidence, "lexical");
}

/** Build the shared `Retrieved` shape from selected code + conversation hits. */
function assemble(
  codeHits: ScoredFile[],
  convs: Conversation[],
  confidence: number,
  mode: "vector" | "lexical",
): Retrieved {
  const code: CodeRef[] = codeHits.map((h) => ({
    path: h.path,
    lineStart: h.line,
    lineEnd: h.line,
    symbol: h.symbol,
  }));
  return { code, conversations: convs, confidence, context: buildContext(codeHits, convs), mode };
}

// ---------------------------------------------------------------------------
// Vector retrieval (embeddings + sqlite-vec KNN via the Rust core)
// ---------------------------------------------------------------------------

/**
 * Chunk the corpus for embedding: one chunk per meaningful code line (carrying
 * its path + line for citation) and one per conversation message (carrying its
 * conversation id). Text is what gets embedded; the rest is citation metadata.
 */
export function chunkCorpus(): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of pipeline.files) {
    const lines = file.content.split("\n");
    lines.forEach((line, i) => {
      const t = line.trim();
      // Skip blanks and pure structural punctuation — no rationale to embed.
      if (t.length < 3 || t === "}" || t === "{" || t === "]" || t === ")") return;
      chunks.push({
        text: `${file.path} — ${file.description}\n${t}`,
        path: file.path,
        kind: "code",
        line_start: i + 1,
        conv_id: null,
      });
    });
  }
  for (const conv of conversations) {
    for (const m of conv.messages) {
      chunks.push({
        text: `${conv.title} (${conv.source})\n${m.author}: ${m.body}`,
        path: null,
        kind: "conversation",
        line_start: 0,
        conv_id: conv.id,
      });
    }
  }
  return chunks;
}

/** Map a code KNN hit back to a citation-ready `ScoredFile`. */
function hitToScoredFile(h: Hit): ScoredFile {
  const file = getCodeFile(h.path);
  const lineText = file ? (file.content.split("\n")[h.line_start - 1] ?? "").trim() : "";
  return {
    path: h.path,
    score: h.similarity,
    line: h.line_start,
    lineText,
    symbol: deriveSymbol(lineText),
  };
}

/**
 * Retrieve evidence by semantic similarity: embed the question and run KNN over
 * the vector index (code + conversation legs separately, so both sides of the
 * dual citation are represented). Returns null if the index/embedder is
 * unavailable so the caller can fall back to lexical retrieval.
 */
export async function retrieveVector(question: string): Promise<Retrieved | null> {
  let codeRows: Hit[];
  let convRows: Hit[];
  try {
    [codeRows, convRows] = await Promise.all([
      api.vectorSearch(question, 5, "code"),
      api.vectorSearch(question, 5, "conversation"),
    ]);
  } catch {
    return null;
  }
  if ((codeRows?.length ?? 0) === 0 && (convRows?.length ?? 0) === 0) return null;

  // Top code hits, de-duplicated by file+line, capped at 2.
  const seen = new Set<string>();
  const codeHits: ScoredFile[] = [];
  for (const r of codeRows ?? []) {
    const key = `${r.path}:${r.line_start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    codeHits.push(hitToScoredFile(r));
    if (codeHits.length >= 2) break;
  }

  // Top conversations, de-duplicated by id, capped at 2.
  const convSeen = new Set<string>();
  const convs: Conversation[] = [];
  for (const r of convRows ?? []) {
    if (!r.conv_id || convSeen.has(r.conv_id)) continue;
    convSeen.add(r.conv_id);
    const c = getConversation(r.conv_id);
    if (c) convs.push(c);
    if (convs.length >= 2) break;
  }

  const topCode = codeRows?.[0]?.similarity ?? 0;
  const topConv = convRows?.[0]?.similarity ?? 0;
  let confidence = 0.35 + topCode * 0.35 + topConv * 0.25;
  if (topCode > 0.5 && topConv > 0.5) confidence += 0.05;
  confidence = Math.min(0.97, Math.max(0.3, confidence));

  return assemble(codeHits, convs, confidence, "vector");
}

/** Format retrieved evidence into a compact, citation-friendly context block. */
function buildContext(codeHits: ScoredFile[], convs: Conversation[]): string {
  const parts: string[] = [];

  parts.push("=== CODE EVIDENCE ===");
  for (const h of codeHits) {
    parts.push(
      `File: ${h.path} (line ${h.line})\n  ${h.line}: ${h.lineText}`,
    );
  }
  if (codeHits.length === 0) parts.push("(no matching code found)");

  parts.push("\n=== CONVERSATION EVIDENCE ===");
  for (const conv of convs) {
    parts.push(`Source: ${conv.source} — "${conv.title}" (${conv.date})`);
    for (const m of conv.messages) {
      const mark = m.pivotal ? " [KEY]" : "";
      parts.push(`  ${m.author}${m.role ? ` (${m.role})` : ""}${mark}: ${m.body}`);
    }
  }
  if (convs.length === 0) parts.push("(no matching conversation found)");

  return parts.join("\n");
}

const SYSTEM_PROMPT = `You are Libbie, an institutional-memory copilot for a bioinformatics R&D lab. You have read this pipeline's code and the team's conversations. Answer "why" questions by reconstructing the original intent.

Rules:
- Ground every claim ONLY in the provided CODE EVIDENCE and CONVERSATION EVIDENCE. Never invent facts, versions, or names.
- Lead with a one-line verdict (the answer), then one or two sentences of justification.
- Name the humans involved when the conversation names them (e.g. "Elena pinned it…").
- If the evidence does not explain the decision, say so honestly ("The rationale was never recorded").
- Be warm, concise, and precise. Do not repeat the question. Do not use markdown headers.`;

/**
 * Build the message list for a grounded completion. `audience` swaps the
 * closing instruction so the same evidence yields a technical or executive
 * rendering (FR-9), without a second retrieval.
 */
export function buildMessages(
  question: string,
  retrieved: Retrieved,
  audience: "technical" | "executive",
): ChatMessage[] {
  const audienceLine =
    audience === "executive"
      ? "Write for a non-technical executive: focus on continuity and risk, avoid parameter names and jargon."
      : "Write for the engineer who inherited this pipeline: precise, include the parameter/version names.";

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${retrieved.context}\n\n=== QUESTION ===\n${question}\n\n=== INSTRUCTION ===\n${audienceLine}`,
    },
  ];
}
