import type { Conversation } from "@/lib/types";

// Synthetic conversational provenance (FR-2, DR-2). Authored SAMPLE DATA (NFR-6).
// Each record names the exact file/parameter it explains so the link is traceable (FR-3).

export const conversations: Conversation[] = [
  {
    id: "conv-grch37-chat",
    kind: "chat",
    title: "Reference build for the Helix cohort",
    source: "Slack · #genomics-pipeline",
    date: "2024-03-12",
    participants: ["Elena Vasquez", "Raj Patel", "Marie Lindqvist"],
    references: ["conf/params.config", "params.genome"],
    messages: [
      {
        author: "Raj Patel",
        role: "Bioinformatician",
        time: "10:02",
        body: "Quick one before I kick off the rerun — are we on GRCh38 for the Helix cohort? Most new pipelines default to it now.",
      },
      {
        author: "Elena Vasquez",
        role: "Senior Computational Biologist",
        time: "10:14",
        pivotal: true,
        body: "No — keep it on GRCh37 (b37). The Helix cohort's existing variant calls and the clinical annotations from the 2019–2022 freeze are all in GRCh37 coordinates. If we switch to GRCh38 now, every downstream comparison against the historical cohort needs a liftover, and we'd lose concordance with the published baseline. We can migrate, but it's a deliberate re-baselining project, not a parameter flip.",
      },
      {
        author: "Marie Lindqvist",
        role: "Lab Lead",
        time: "10:21",
        body: "Agreed. Let's lock GRCh37 until the cohort-wide GRCh38 migration is scoped. Please leave a comment in the config so the next person doesn't 'helpfully' bump it.",
      },
      {
        author: "Elena Vasquez",
        role: "Senior Computational Biologist",
        time: "10:23",
        body: "Done — added `// legacy cohort concordance — do not bump without re-baselining` next to params.genome.",
      },
    ],
  },
  {
    id: "conv-mapq-pr",
    kind: "pr",
    title: "Tighten variant hard-filters before joint genotyping",
    source: "GitHub · PR #142",
    date: "2024-04-29",
    participants: ["Elena Vasquez", "Raj Patel"],
    references: ["modules/local/filter_variants.nf", "params.mapq_min"],
    messages: [
      {
        author: "Raj Patel",
        role: "Bioinformatician",
        time: "review",
        body: "Why MAPQ ≥ 30 specifically? The previous pipeline used 20. Bumping it this high will drop a chunk of reads in the segmental-duplication regions.",
      },
      {
        author: "Elena Vasquez",
        role: "Senior Computational Biologist",
        time: "review",
        pivotal: true,
        body: "That's the point. At MAPQ 20 we were getting a wave of false hets in the seg-dup and pseudo-autosomal regions — they showed up in the validation set as Mendelian-inconsistent calls. MAPQ 30 (≈ 99.9% mapping confidence with BWA-MEM) cleared almost all of them with negligible loss of true positives in the GIAB benchmark. We're optimizing for precision on the germline cohort, not sensitivity on hard regions. Keep it at 30.",
      },
      {
        author: "Raj Patel",
        role: "Bioinformatician",
        time: "review",
        body: "Makes sense — the GIAB numbers are convincing. Approving.",
      },
    ],
  },
  {
    id: "conv-bwa-meeting",
    kind: "meeting",
    title: "Pipeline sync — alignment settings",
    source: "Meeting notes · 2024-02-08",
    date: "2024-02-08",
    participants: ["Elena Vasquez", "Raj Patel", "Marie Lindqvist"],
    references: ["modules/local/bwa_mem.nf", "params.bwa_extra_args"],
    messages: [
      {
        author: "Meeting notes",
        role: "Weekly pipeline sync",
        time: "agenda item 3",
        body: "Discussed BWA-MEM invocation for the alignment module.",
      },
      {
        author: "Elena Vasquez",
        role: "Senior Computational Biologist",
        time: "decision",
        pivotal: true,
        body: "We run BWA-MEM with -M so that shorter split hits are flagged as secondary rather than supplementary. Picard MarkDuplicates and the older GATK 4.1 tooling in our env expect that convention — without -M, MarkDuplicates miscounts split reads and BQSR throws on the supplementary flags. It's a compatibility requirement for our specific toolchain, not a quality preference.",
      },
      {
        author: "Raj Patel",
        role: "Bioinformatician",
        time: "action",
        body: "Action: keep `bwa_extra_args = '-M'` in params.config; note the Picard/GATK compatibility reason inline.",
      },
    ],
  },
  {
    id: "conv-gatk-email",
    kind: "email",
    title: "Re: GATK upgrade — hold at 4.1.9.0",
    source: "Email · genomics-eng@helix.bio",
    date: "2024-05-17",
    participants: ["Elena Vasquez", "Marie Lindqvist"],
    references: ["environment.yml", "params.gatk_version", "gatk4"],
    messages: [
      {
        author: "Marie Lindqvist",
        role: "Lab Lead",
        time: "Fri 09:12",
        body: "IT wants to standardize everyone on the latest GATK (4.2.x). Any objection to upgrading the germline pipeline?",
      },
      {
        author: "Elena Vasquez",
        role: "Senior Computational Biologist",
        time: "Fri 11:40",
        pivotal: true,
        body: "Please hold us at 4.1.9.0 for now. GATK 4.2 changed a default in GenotypeGVCFs (the handling of the QUALapprox / new-qual model) and our validated callset shifts measurably when we move — a handful of borderline sites flip genotype. That callset is the one referenced in the cohort manuscript, so any change has to be re-validated and documented before we adopt it. The pin in environment.yml is intentional; the inline comment explains it. Let's schedule the 4.2 migration as its own validated change.",
      },
      {
        author: "Marie Lindqvist",
        role: "Lab Lead",
        time: "Fri 13:05",
        body: "Understood — staying on 4.1.9.0. I'll tell IT this pipeline is exempt pending a validated migration.",
      },
    ],
  },
  {
    id: "conv-depth-chat",
    kind: "chat",
    title: "Minimum depth for genotype emission",
    source: "Slack · #genomics-pipeline",
    date: "2024-04-30",
    participants: ["Elena Vasquez", "Raj Patel"],
    references: ["modules/local/filter_variants.nf", "params.min_depth"],
    messages: [
      {
        author: "Raj Patel",
        role: "Bioinformatician",
        time: "15:41",
        body: "DP ≥ 10 for the depth filter — is that just convention or is there a reason for the cohort?",
      },
      {
        author: "Elena Vasquez",
        role: "Senior Computational Biologist",
        time: "15:58",
        pivotal: true,
        body: "Reason. Helix is ~30x WGS, and below ~10x the het/hom genotype calls get unreliable — allele balance gets noisy and we start emitting low-confidence hets that fail Mendelian checks in the trios. DP ≥ 10 is the floor where genotype quality stabilizes for this coverage. If we ever move to a higher-coverage cohort we can revisit, but for Helix 10 is the validated threshold.",
      },
      {
        author: "Raj Patel",
        role: "Bioinformatician",
        time: "16:03",
        body: "Got it, leaving it at 10.",
      },
    ],
  },
];
