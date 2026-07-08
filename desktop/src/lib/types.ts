// Libbie.ai — shared data contract for the MVP.
// All demo content is authored sample data (NFR-6). The shapes here are the
// contract every UI surface builds against.

export type ConversationKind = "chat" | "pr" | "meeting" | "email";

/** A single source file in the hero pipeline (FR-1, FR-8). */
export interface CodeFile {
  /** Repo-relative path, e.g. "conf/igenomes.config". */
  path: string;
  /** Language id for the syntax highlighter. */
  language: string;
  /** One-line description shown in the file tree. */
  description: string;
  /** Full file contents; citations reference 1-based line ranges into this. */
  content: string;
}

/** A precise, citable location inside a code file (FR-7, FR-8). */
export interface CodeRef {
  path: string;
  /** 1-based inclusive line range. */
  lineStart: number;
  lineEnd: number;
  /** Human label for the cited element, e.g. "params.mapq_min". */
  symbol: string;
}

/** One message inside a conversational record. */
export interface ConversationMessage {
  author: string;
  /** Short role/affiliation shown under the name. */
  role?: string;
  time: string;
  body: string;
  /** Render this message highlighted as the key justification. */
  pivotal?: boolean;
}

/** Conversational provenance: chat / PR / meeting / email (FR-2). */
export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  /** Source label, e.g. "Slack · #genomics-pipeline" or "GitHub PR #142". */
  source: string;
  /** ISO date the conversation took place. */
  date: string;
  participants: string[];
  messages: ConversationMessage[];
  /** Code element(s) this record explains (FR-3). */
  references: string[];
}

/** Precomputed code↔conversation edge (DR-3, locked decision 6). */
export interface LinkEdge {
  id: string;
  code: CodeRef;
  conversationId: string;
  /** 0–1 confidence; authored for the MVP, computed in the main plan. */
  confidence: number;
  /** Why the linker believes this conversation explains this code. */
  rationale: string;
}

/** An audience-specific rendering of an answer (FR-9). */
export interface AnswerView {
  /** Plain-language reconstructed reasoning. */
  summary: string;
  /** Additional paragraphs / detail. */
  body: string[];
}

/** A rehearsed, dual-cited answer (FR-5..FR-9). */
export interface Answer {
  id: string;
  question: string;
  /** Short chip label for the question. */
  chip: string;
  technical: AnswerView;
  executive: AnswerView;
  /** Code citations (FR-7, FR-8). */
  codeCitations: CodeRef[];
  /** Conversation citations by id (FR-7). */
  conversationCitations: string[];
  /** The one question wired to the real local / air-gapped path (FR-14). */
  isLocal?: boolean;
}

export type StalenessStatus = "current" | "behind" | "major";

/** A dependency / reference-build row in the risk panel (FR-10, FR-11). */
export interface StalenessItem {
  name: string;
  kind: "reference-build" | "tool" | "library" | "resource";
  pinned: string;
  current: string;
  status: StalenessStatus;
  /** Where this version is declared. */
  source: string;
  /** High-level caution about updating/integrating. */
  caution: string;
}

/** The hero pipeline snapshot (DR-1). */
export interface Pipeline {
  id: string;
  name: string;
  /** e.g. "nf-core/sarek-style germline variant calling". */
  family: string;
  description: string;
  language: string;
  repo: string;
  author: { name: string; role: string; departed: string };
  stats: { files: number; conversations: number; commits: number; lastActive: string };
  files: CodeFile[];
}

/** Items shown scrolling past during the "scanning at scale" animation (DR-5). */
export interface ScanItem {
  label: string;
  kind: "file" | "conversation" | "version";
}
