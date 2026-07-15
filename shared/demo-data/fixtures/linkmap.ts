import type { LinkEdge } from "../types";

// Precomputed code<->conversation link map (DR-3, locked decision 6).
// In the MVP these edges are hand-curated; the main plan infers + verifies them.

export const linkMap: LinkEdge[] = [
  {
    id: "edge-grch37",
    code: { path: "conf/params.config", lineStart: 6, lineEnd: 6, symbol: "params.genome" },
    conversationId: "conv-grch37-chat",
    confidence: 0.98,
    rationale:
      "Conversation names params.genome and the GRCh37/GRCh38 decision explicitly; author added the inline comment referenced in the thread.",
  },
  {
    id: "edge-mapq-config",
    code: { path: "conf/params.config", lineStart: 14, lineEnd: 14, symbol: "params.mapq_min" },
    conversationId: "conv-mapq-pr",
    confidence: 0.96,
    rationale: "PR #142 review discusses the MAPQ 20→30 change on this parameter.",
  },
  {
    id: "edge-mapq-apply",
    code: { path: "modules/local/filter_variants.nf", lineStart: 16, lineEnd: 16, symbol: "MQ filter" },
    conversationId: "conv-mapq-pr",
    confidence: 0.9,
    rationale: "The filter expression applying mapq_min is the code changed in PR #142.",
  },
  {
    id: "edge-bwa-config",
    code: { path: "conf/params.config", lineStart: 11, lineEnd: 11, symbol: "params.bwa_extra_args" },
    conversationId: "conv-bwa-meeting",
    confidence: 0.93,
    rationale: "Meeting decision records the -M flag and the action to keep it in params.config.",
  },
  {
    id: "edge-bwa-apply",
    code: { path: "modules/local/bwa_mem.nf", lineStart: 15, lineEnd: 15, symbol: "bwa mem invocation" },
    conversationId: "conv-bwa-meeting",
    confidence: 0.88,
    rationale: "bwa_extra_args is consumed in the BWA-MEM command discussed at the sync.",
  },
  {
    id: "edge-gatk-env",
    code: { path: "environment.yml", lineStart: 8, lineEnd: 8, symbol: "gatk4=4.1.9.0" },
    conversationId: "conv-gatk-email",
    confidence: 0.97,
    rationale: "Email thread justifies the GATK pin and references environment.yml directly.",
  },
  {
    id: "edge-gatk-config",
    code: { path: "conf/params.config", lineStart: 19, lineEnd: 19, symbol: "params.gatk_version" },
    conversationId: "conv-gatk-email",
    confidence: 0.85,
    rationale: "gatk_version mirrors the pinned environment version discussed in the email.",
  },
  {
    id: "edge-depth-config",
    code: { path: "conf/params.config", lineStart: 15, lineEnd: 15, symbol: "params.min_depth" },
    conversationId: "conv-depth-chat",
    confidence: 0.94,
    rationale: "Chat thread explains DP ≥ 10 on the min_depth parameter for the cohort coverage.",
  },
  {
    id: "edge-depth-apply",
    code: { path: "modules/local/filter_variants.nf", lineStart: 16, lineEnd: 16, symbol: "DP filter" },
    conversationId: "conv-depth-chat",
    confidence: 0.87,
    rationale: "The DP filter expression applies min_depth as discussed.",
  },
];
