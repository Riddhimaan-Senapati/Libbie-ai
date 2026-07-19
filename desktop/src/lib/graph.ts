// Normalisation for the engine's provenance graph.
//
// The `engine` GraphStore (the `libbie join` output at
// `engine/libbie_store/graph.json`) serialises as:
//
//   { "nodes": { "<id>": { id, kind, ...kind-specific, provenance }, ... },
//     "edges": [ { id, src, dst, type, confidence, status, rationale,
//                  evidence_spans }, ... ] }
//
// react-force-graph wants `{ nodes: [...], links: [...] }` with `source`/`target`
// on the links. `normalizeGraph` performs that mapping and derives a short,
// human-readable `label` per node so the canvas stays legible.

/** The kinds of node the provenance engine emits. */
export type NodeKind =
  | "person"
  | "file"
  | "commit"
  | "pipeline_step"
  | "param"
  | "job_run"
  | "message"
  | "decision"
  | "finding"
  | "paper"
  | "claim";

/** An edge's lifecycle status. `committed` = asserted fact; `hypothesis` =
 *  inferred/unconfirmed (rendered dashed + amber). */
export type EdgeStatus = "committed" | "hypothesis";

/** A raw node as stored by the engine (kind-specific fields are open-ended). */
export interface RawNode {
  id: string;
  kind: string;
  provenance?: Record<string, unknown>;
  [field: string]: unknown;
}

/** A raw edge as stored by the engine. */
export interface RawEdge {
  id: string;
  src: string;
  dst: string;
  type: string;
  confidence: number;
  status: string;
  rationale?: string;
  evidence_spans?: unknown[];
  [field: string]: unknown;
}

/** The on-disk / IPC shape of the provenance graph. */
export interface RawGraph {
  nodes: Record<string, RawNode>;
  edges: RawEdge[];
}

/** A node in react-force-graph's shape, plus our derived `label` + retained
 *  kind-specific `fields` (everything except id/kind/provenance) for the
 *  inspector. */
export interface GNode {
  id: string;
  kind: string;
  label: string;
  /** Kind-specific fields (everything but id/kind/provenance), for the inspector. */
  fields: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

/** A link in react-force-graph's shape (edges → links, src → source, dst → target). */
export interface GLink {
  id: string;
  source: string;
  target: string;
  type: string;
  confidence: number;
  status: string;
  rationale?: string;
}

/** The normalised graph consumed by `GraphView`. */
export interface NormalizedGraph {
  nodes: GNode[];
  links: GLink[];
}

/** One distinct colour per node kind, tuned for the Benchling light canvas. */
export const KIND_COLORS: Record<string, string> = {
  person: "#7c3aed", // violet — a human actor
  file: "#0a2bd6", // code blue — the fusion "signal" hue
  commit: "#0a8f5b", // green — version-control history
  pipeline_step: "#000db5", // royal primary — the pipeline spine
  param: "#6b7aa8", // slate — configuration
  job_run: "#b45309", // burnt amber — an execution
  message: "#0891b2", // cyan — conversation
  decision: "#d61f3f", // red — load-bearing decisions
  finding: "#db2777", // pink — an empirical finding
  paper: "#4338ca", // indigo — a reference
  claim: "#ca8a04", // gold — a cited claim
};

/** Fallback colour for any unrecognised kind. */
export const UNKNOWN_KIND_COLOR = "#6b7aa8";

/** Colour for a node of the given kind. */
export function colorForKind(kind: string): string {
  return KIND_COLORS[kind] ?? UNKNOWN_KIND_COLOR;
}

/** Human-readable label per node kind (for the legend + inspector header). */
export const KIND_LABEL: Record<string, string> = {
  person: "Person",
  file: "File",
  commit: "Commit",
  pipeline_step: "Pipeline step",
  param: "Parameter",
  job_run: "Job run",
  message: "Message",
  decision: "Decision",
  finding: "Finding",
  paper: "Paper",
  claim: "Claim",
};

/** Human label for a kind, falling back to the raw kind string. */
export function labelForKind(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

// ---------------------------------------------------------------------------

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function trim(s: string, max = 48): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const s = v.find((x) => typeof x === "string" && x.trim());
      if (typeof s === "string") return s.trim();
    }
  }
  return null;
}

/**
 * Derive a short, human field for a node so the graph reads at a glance:
 *  - person   → an alias/handle/email
 *  - file     → path basename
 *  - commit   → sha7 + subject line
 *  - param    → key=value
 *  - message/decision/claim/finding → trimmed statement/text
 *  - paper    → title; pipeline_step → name; job_run → job id
 */
export function nodeLabel(n: RawNode): string {
  const kind = n.kind;
  switch (kind) {
    case "person":
      return firstString(n.aliases, n.handles, n.emails, n.canonical_id) ?? n.id;
    case "file":
      return typeof n.path === "string" ? basename(n.path) : n.id;
    case "commit": {
      const sha = typeof n.sha === "string" ? n.sha.slice(0, 7) : "";
      const subject =
        typeof n.message === "string" ? trim(n.message.split("\n")[0], 40) : "";
      return [sha, subject].filter(Boolean).join(" ") || n.id;
    }
    case "param": {
      const key = typeof n.key === "string" ? n.key : "";
      const value = n.value == null ? "" : String(n.value);
      return key ? trim(`${key}=${value}`, 40) : n.id;
    }
    case "pipeline_step":
      return firstString(n.name) ?? n.id;
    case "job_run":
      return firstString(n.job_id) ? `job ${String(n.job_id)}` : n.id;
    case "message":
      return typeof n.text === "string" ? trim(n.text) : n.id;
    case "decision":
    case "claim":
    case "finding":
      return typeof n.statement === "string" ? trim(n.statement) : n.id;
    case "paper":
      return firstString(n.title) ?? n.id;
    default:
      return (firstString(n.name, n.title, n.statement, n.text) ?? n.id) as string;
  }
}

const RESERVED_NODE_FIELDS = new Set(["id", "kind", "provenance"]);

/** Map the engine graph JSON to react-force-graph's `{ nodes, links }`. */
export function normalizeGraph(raw: RawGraph): NormalizedGraph {
  const rawNodes = raw?.nodes ?? {};
  const rawEdges = raw?.edges ?? [];

  const nodes: GNode[] = Object.values(rawNodes).map((n) => {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (!RESERVED_NODE_FIELDS.has(k)) fields[k] = v;
    }
    return {
      id: n.id,
      kind: n.kind,
      label: nodeLabel(n),
      fields,
      provenance: n.provenance,
    };
  });

  // Only keep edges whose endpoints both exist, so the force layout never holds
  // a dangling reference (react-force-graph would otherwise create phantom nodes).
  const present = new Set(nodes.map((n) => n.id));
  const links: GLink[] = rawEdges
    .filter((e) => present.has(e.src) && present.has(e.dst))
    .map((e) => ({
      id: e.id,
      source: e.src,
      target: e.dst,
      type: e.type,
      confidence: typeof e.confidence === "number" ? e.confidence : 1,
      status: e.status,
      rationale: e.rationale,
    }));

  return { nodes, links };
}

/** Parse a JSON string into a normalised graph, or throw a friendly error. */
export function parseGraphJson(text: string): NormalizedGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`That file isn't valid JSON: ${String(e)}`);
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("nodes" in raw) ||
    !("edges" in raw)
  ) {
    throw new Error(
      "That JSON doesn't look like a provenance graph (expected top-level `nodes` and `edges`).",
    );
  }
  return normalizeGraph(raw as RawGraph);
}
