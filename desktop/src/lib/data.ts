// Libbie.ai — single import surface for all demo data + lookup helpers.
// UI code should import from "@/lib/data" rather than reaching into fixtures.

import { pipeline } from "@/lib/fixtures/pipeline";
import { conversations } from "@/lib/fixtures/conversations";
import { answers } from "@/lib/fixtures/answers";
import { linkMap } from "@/lib/fixtures/linkmap";
import { staleness, scanItems } from "@/lib/fixtures/staleness";
import type { Answer, CodeFile, Conversation, LinkEdge } from "@/lib/types";

export { pipeline, conversations, answers, linkMap, staleness, scanItems };

export const getConversation = (id: string): Conversation | undefined =>
  conversations.find((c) => c.id === id);

export const getAnswer = (id: string): Answer | undefined =>
  answers.find((a) => a.id === id);

export const getCodeFile = (path: string): CodeFile | undefined =>
  pipeline.files.find((f) => f.path === path);

/** All link edges whose code side lives in the given file. */
export const getLinksForFile = (path: string): LinkEdge[] =>
  linkMap.filter((e) => e.code.path === path);

/** All link edges pointing at a conversation. */
export const getLinksForConversation = (conversationId: string): LinkEdge[] =>
  linkMap.filter((e) => e.conversationId === conversationId);

/** The single answer wired to the real local / air-gapped path (FR-14). */
export const localAnswer = (): Answer | undefined => answers.find((a) => a.isLocal);

// Brand + product config -----------------------------------------------------

export const brand = {
  name: "Libbie.ai",
  tagline: "Reconstruct the intent behind your pipelines.",
  oneLiner:
    "The institutional-memory layer for compute-heavy R&D — fusing code, conversations, and domain knowledge into one queryable memory.",
} as const;

// Freemium counter (MR-1, MR-3). Non-functional upgrade path for the demo.
export const freemium = {
  used: 23,
  limit: 50,
  resetLabel: "Resets monthly",
} as const;

// Libbie — the assistant persona (an ambient AI chief of staff). Her presence,
// voice and proactivity are the product's new center of gravity.
export const libbie = {
  name: "Libbie",
  role: "your chief of staff for pipeline knowledge",
  greeting:
    "I've read this pipeline end to end — every line and every thread. Ask me why anything was built the way it was, and I'll show you the code and the conversation behind it.",
  idleStatus: "Memory synced",
  thinkingLines: [
    "Cross-referencing config and threads…",
    "Fusing code with the conversation behind it…",
    "Finding where this was decided…",
  ],
  suggestedActions: [
    "Show me the other stale decisions",
    "Draft a handover doc",
    "Explain this for an exec",
  ],
} as const;

// What Libbie proactively surfaces before you ask — the signature moment.
export const proactiveNudge = {
  answerId: "ans-grch37",
  title: "One decision here is load-bearing — and the person who made it has left.",
  body:
    "Elena pinned this pipeline to GRCh37 for cohort concordance, 14 months ago. I kept the thread that explains it, so you can decide rather than guess.",
} as const;
