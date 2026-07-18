import type { Answer } from "@/lib/types";

// Rehearsed, dual-cited answers (FR-5..FR-9, DR-4). Each carries a technical and an
// executive rendering of the SAME reconstructed reasoning, plus code + conversation
// citations. Authored SAMPLE DATA (NFR-6) — the magic-moment path cannot misfire (NFR-1).

export const answers: Answer[] = [
  {
    id: "ans-grch37",
    chip: "Why GRCh37 and not GRCh38?",
    question: "Why was this pipeline built on GRCh37 instead of GRCh38?",
    technical: {
      summary:
        "GRCh37 was retained deliberately so the Helix cohort stays coordinate-concordant with its historical callset and clinical annotations. It was not kept because GRCh38 was unavailable.",
      body: [
        "`params.genome` is pinned to `'GRCh37'` in conf/params.config. Elena Vasquez added the inline note (“legacy cohort concordance — do not bump without re-baselining”) at the team's request.",
        "The Helix cohort's existing variant calls and the 2019–2022 clinical annotation freeze are all in GRCh37 coordinates. Switching to GRCh38 would require a liftover of every downstream comparison and would break concordance with the published baseline.",
        "Migration to GRCh38 was explicitly scoped as a separate, deliberate re-baselining project, not a parameter change.",
      ],
    },
    executive: {
      summary:
        "The pipeline uses an older reference map of the genome on purpose, so results stay directly comparable to years of prior cohort data.",
      body: [
        "The team's historical results and clinical annotations were all produced against this reference version. Changing it now would make new results no longer line up with the established baseline.",
        "Upgrading is possible but is treated as a planned project with re-validation, not a quick switch, to protect continuity of the cohort's record.",
      ],
    },
    codeCitations: [
      { path: "conf/params.config", lineStart: 6, lineEnd: 6, symbol: "params.genome" },
    ],
    conversationCitations: ["conv-grch37-chat"],
  },
  {
    id: "ans-mapq",
    chip: "Why is the mapping-quality filter set to 30?",
    question: "Why is the mapping-quality filter (MAPQ) set as high as 30?",
    isLocal: true,
    technical: {
      summary:
        "MAPQ ≥ 30 was chosen over the previous 20 to suppress false heterozygous calls in segmental-duplication and pseudo-autosomal regions, trading a little sensitivity for precision on the germline cohort.",
      body: [
        "`params.mapq_min = 30` (conf/params.config) is applied in filter_variants.nf via the bcftools expression `MQ < ${params.mapq_min}`.",
        "At MAPQ 20 the validation set showed a wave of Mendelian-inconsistent false hets in seg-dup / PAR regions. MAPQ 30 (~99.9% mapping confidence under BWA-MEM) cleared almost all of them with negligible true-positive loss on the GIAB benchmark.",
        "The decision optimizes for precision on a germline cohort rather than sensitivity in hard-to-map regions; it was reviewed and approved in PR #142.",
      ],
    },
    executive: {
      summary:
        "The pipeline keeps only high-confidence read alignments to avoid spurious findings. It's a precision-first choice, validated against a gold-standard benchmark.",
      body: [
        "A looser setting was producing false positives in genomic regions that are inherently hard to read, which showed up as biologically impossible results in family data.",
        "Tightening the threshold removed nearly all of those errors without meaningfully losing real findings, and was peer-reviewed before adoption.",
      ],
    },
    codeCitations: [
      { path: "conf/params.config", lineStart: 14, lineEnd: 14, symbol: "params.mapq_min" },
      { path: "modules/local/filter_variants.nf", lineStart: 16, lineEnd: 16, symbol: "MQ filter" },
    ],
    conversationCitations: ["conv-mapq-pr"],
  },
  {
    id: "ans-bwa",
    chip: "Why run BWA-MEM with -M?",
    question: "Why is BWA-MEM invoked with the -M flag?",
    technical: {
      summary:
        "`-M` flags shorter split hits as secondary so Picard MarkDuplicates and the pinned GATK 4.1 toolchain handle split reads correctly. It's a toolchain-compatibility requirement, not a quality preference.",
      body: [
        "`params.bwa_extra_args = '-M'` (conf/params.config) is passed straight into the alignment command in bwa_mem.nf.",
        "Without -M, split reads are marked supplementary; Picard MarkDuplicates then miscounts them and BQSR can throw on the supplementary flags in this environment's GATK 4.1.",
        "The convention was agreed at the 2024-02-08 pipeline sync and documented inline.",
      ],
    },
    executive: {
      summary:
        "A specific alignment option is set so the downstream tools in this environment process reads correctly. It keeps the toolchain working together reliably.",
      body: [
        "Removing this option would cause later steps to mishandle certain reads and could break the run.",
        "It was a documented team decision tied to the specific versions of the tools this pipeline depends on.",
      ],
    },
    codeCitations: [
      { path: "conf/params.config", lineStart: 11, lineEnd: 11, symbol: "params.bwa_extra_args" },
      { path: "modules/local/bwa_mem.nf", lineStart: 15, lineEnd: 15, symbol: "bwa mem invocation" },
    ],
    conversationCitations: ["conv-bwa-meeting"],
  },
  {
    id: "ans-gatk",
    chip: "Why is GATK pinned to 4.1.9.0?",
    question: "Why is GATK pinned to 4.1.9.0 instead of the latest version?",
    technical: {
      summary:
        "GATK is held at 4.1.9.0 because 4.2 changed a GenotypeGVCFs default (the new-qual / QUALapprox model) that measurably shifts the validated callset referenced in the cohort manuscript.",
      body: [
        "`gatk4=4.1.9.0` is pinned in environment.yml and mirrored by `params.gatk_version`, both with inline notes.",
        "Moving to 4.2 flips a handful of borderline sites' genotypes. Because the existing callset underpins the cohort manuscript, any change must be re-validated and documented before adoption.",
        "The upgrade was deferred to a dedicated, validated migration rather than absorbed into a routine dependency bump.",
      ],
    },
    executive: {
      summary:
        "The analysis tool is intentionally frozen at a specific version so published results remain reproducible and defensible.",
      body: [
        "A newer version subtly changes some results, and those results back a published manuscript, so upgrading requires formal re-validation first.",
        "The freeze is a compliance-minded, reproducibility decision, not neglect; the upgrade is planned as its own controlled change.",
      ],
    },
    codeCitations: [
      { path: "environment.yml", lineStart: 8, lineEnd: 8, symbol: "gatk4=4.1.9.0" },
      { path: "conf/params.config", lineStart: 19, lineEnd: 19, symbol: "params.gatk_version" },
    ],
    conversationCitations: ["conv-gatk-email"],
  },
  {
    id: "ans-depth",
    chip: "Why is the depth filter DP ≥ 10?",
    question: "Why is the minimum depth filter set to DP ≥ 10?",
    technical: {
      summary:
        "DP ≥ 10 is the validated floor where genotype quality stabilizes for the ~30x Helix WGS cohort. Below ~10x, het/hom calls become unreliable and fail Mendelian checks.",
      body: [
        "`params.min_depth = 10` (conf/params.config) is applied in filter_variants.nf via `INFO/DP < ${params.min_depth}`.",
        "Below ~10x, allele balance gets noisy and low-confidence hets start failing Mendelian consistency in the trios. DP ≥ 10 is where genotype quality stabilizes for 30x coverage.",
        "The threshold is cohort-specific; a higher-coverage cohort could revisit it.",
      ],
    },
    executive: {
      summary:
        "The pipeline only reports a result at a genome position when it has read it enough times to be confident. It's a data-quality safeguard tuned to this cohort.",
      body: [
        "With too few reads the call becomes unreliable, which showed up as inconsistencies in family data.",
        "The chosen minimum is the validated point where results become trustworthy for this dataset's coverage level.",
      ],
    },
    codeCitations: [
      { path: "conf/params.config", lineStart: 15, lineEnd: 15, symbol: "params.min_depth" },
      { path: "modules/local/filter_variants.nf", lineStart: 16, lineEnd: 16, symbol: "DP filter" },
    ],
    conversationCitations: ["conv-depth-chat"],
  },
];
