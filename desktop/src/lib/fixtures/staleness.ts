import type { StalenessItem, ScanItem } from "@/lib/types";

// Risk & staleness data (FR-10, FR-11). "current" values are pre-curated for the MVP
// (the PRD permits this); the main plan computes them live. Authored SAMPLE DATA (NFR-6).

export const staleness: StalenessItem[] = [
  {
    name: "Reference build",
    kind: "reference-build",
    pinned: "GRCh37 / b37",
    current: "GRCh38 (T2T-CHM13 emerging)",
    status: "major",
    source: "conf/params.config · params.genome",
    caution:
      "Coordinates and annotations differ between GRCh37 and GRCh38. Migrating requires a full liftover and re-baselining of the cohort callset; do not switch in place.",
  },
  {
    name: "GATK",
    kind: "tool",
    pinned: "4.1.9.0",
    current: "4.6.1.0",
    status: "major",
    source: "environment.yml · gatk4",
    caution:
      "4.2+ changed GenotypeGVCFs new-qual defaults; the validated callset shifts. Upgrade only as a re-validated migration (manuscript dependency).",
  },
  {
    name: "BWA",
    kind: "tool",
    pinned: "0.7.17",
    current: "0.7.18",
    status: "behind",
    source: "environment.yml · bwa",
    caution: "Minor patch release; alignment output is effectively unchanged. Low-risk update.",
  },
  {
    name: "samtools",
    kind: "tool",
    pinned: "1.10",
    current: "1.21",
    status: "behind",
    source: "environment.yml · samtools",
    caution: "Several releases behind. Newer CRAM/threading fixes; verify sort output parity before adopting.",
  },
  {
    name: "bcftools",
    kind: "tool",
    pinned: "1.10.2",
    current: "1.21",
    status: "behind",
    source: "environment.yml · bcftools",
    caution: "Filter-expression semantics are stable across these versions, but re-test the hard-filter step.",
  },
  {
    name: "Picard",
    kind: "tool",
    pinned: "2.23.8",
    current: "3.3.0",
    status: "major",
    source: "environment.yml · picard",
    caution: "Picard 3.x requires Java 17 and changes some default behaviors; coordinate with the GATK upgrade.",
  },
  {
    name: "Python",
    kind: "library",
    pinned: "3.8",
    current: "3.12",
    status: "major",
    source: "environment.yml · python",
    caution: "Python 3.8 is end-of-life. No pipeline-blocking issue, but the environment is unsupported upstream.",
  },
  {
    name: "dbSNP",
    kind: "resource",
    pinned: "b151 (GRCh37)",
    current: "b156",
    status: "behind",
    source: "annotation resources",
    caution: "Annotation resource lags current dbSNP; novel-variant flags may be over-reported. Tied to the GRCh37 build choice.",
  },
];

// Items that scroll past during the "scanning at scale" animation (DR-5).
export const scanItems: ScanItem[] = [
  { kind: "file", label: "main.nf" },
  { kind: "file", label: "conf/params.config" },
  { kind: "file", label: "modules/local/bwa_mem.nf" },
  { kind: "conversation", label: "Slack · #genomics-pipeline (412 messages)" },
  { kind: "file", label: "modules/local/filter_variants.nf" },
  { kind: "version", label: "gatk4 = 4.1.9.0" },
  { kind: "conversation", label: "GitHub · PR #142" },
  { kind: "file", label: "environment.yml" },
  { kind: "version", label: "genome = GRCh37" },
  { kind: "conversation", label: "Email · genomics-eng@helix.bio" },
  { kind: "file", label: "modules/local/markduplicates.nf" },
  { kind: "conversation", label: "Meeting notes · 2024-02-08" },
  { kind: "version", label: "bwa = 0.7.17" },
  { kind: "file", label: "conf/igenomes.config" },
  { kind: "conversation", label: "Slack · #helix-cohort (873 messages)" },
  { kind: "version", label: "samtools = 1.10" },
  { kind: "file", label: "bin/concordance_check.py" },
  { kind: "conversation", label: "GitHub · PR #138" },
];
