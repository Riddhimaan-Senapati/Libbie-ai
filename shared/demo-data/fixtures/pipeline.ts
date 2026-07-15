import type { Pipeline } from "../types";

// Hero pipeline (DR-1): an nf-core/sarek-style germline variant-calling workflow.
// All content is authored SAMPLE DATA (NFR-6). Line numbers below are load-bearing:
// the link map and answer citations reference exact 1-based line ranges into `content`.

const paramsConfig = `// params.config — parameters for the germline variant-calling workflow
// Maintained by Elena Vasquez (departed 2024-08). Rationale lives in #genomics-pipeline.

params {
    // ---- Reference genome ----
    genome         = 'GRCh37'          // legacy cohort concordance — do not bump without re-baselining
    igenomes_base  = 's3://ngi-igenomes/igenomes'

    // ---- Alignment ----
    aligner        = 'bwa-mem'
    bwa_extra_args = '-M'              // flag shorter split reads as secondary (Picard/GATK compat)

    // ---- Variant filtering ----
    mapq_min       = 30                // drop reads below this mapping quality
    min_depth      = 10                // minimum site depth (DP) to emit a genotype
    min_qual       = 30                // minimum site QUAL

    // ---- Tooling ----
    gatk_version   = '4.1.9.0'         // pinned — see email re: GenotypeGVCFs default change
}
`;

const filterVariants = `// filter_variants.nf — hard-filter raw calls before joint genotyping.
// Thresholds kept conservative for the legacy germline cohort.

process FILTER_VARIANTS {
    tag "$sample_id"

    input:
    tuple val(sample_id), path(vcf)

    output:
    tuple val(sample_id), path("\${sample_id}.filtered.vcf.gz")

    script:
    """
    bcftools view \\
        -e 'MQ < \${params.mapq_min} || INFO/DP < \${params.min_depth} || QUAL < \${params.min_qual}' \\
        \${vcf} -Oz -o \${sample_id}.filtered.vcf.gz
    """
}
`;

const bwaMem = `// bwa_mem.nf — align reads against the configured reference build.

process BWA_MEM {
    tag "$sample_id"

    input:
    tuple val(sample_id), path(reads)
    path index

    output:
    tuple val(sample_id), path("\${sample_id}.bam")

    script:
    """
    bwa mem \${params.bwa_extra_args} -t \${task.cpus} \\
        \${index}/\${params.genome} \\
        \${reads} | samtools sort -o \${sample_id}.bam -
    """
}
`;

const environmentYml = `name: varcall-env
channels:
  - conda-forge
  - bioconda
dependencies:
  - bwa=0.7.17
  - samtools=1.10
  - gatk4=4.1.9.0          # pinned: 4.2+ changed GenotypeGVCFs defaults
  - bcftools=1.10.2
  - picard=2.23.8
  - python=3.8
`;

const mainNf = `// main.nf — germline short-variant calling (BWA-MEM -> GATK HaplotypeCaller).
// Original author: Elena Vasquez. Handover doc: none. Intent recovered via Libbie.ai.

include { BWA_MEM }         from './modules/local/bwa_mem'
include { FILTER_VARIANTS } from './modules/local/filter_variants'

workflow {
    reads_ch = Channel.fromFilePairs(params.input)
    BWA_MEM(reads_ch, file(params.bwa_index))
    // ... mark duplicates -> BQSR -> HaplotypeCaller (omitted for brevity) ...
    FILTER_VARIANTS(haplotype_calls)
}
`;

const readme = `# germline-varcall

Germline short-variant calling pipeline for the Helix cohort.
BWA-MEM alignment, GATK HaplotypeCaller, hard-filtering, joint genotyping.

> Original author **Elena Vasquez** left the team in Aug 2024. No handover
> document was written. Parameter rationale was reconstructed from chat,
> PR review, meeting notes and email by Libbie.ai.

- Reference build: **GRCh37**
- Aligner: **BWA-MEM**
- Caller: **GATK 4.1.9.0**
`;

export const pipeline: Pipeline = {
  id: "germline-varcall",
  name: "germline-varcall",
  family: "nf-core/sarek-style germline variant calling",
  description:
    "Germline short-variant calling for the Helix cohort: BWA-MEM alignment, GATK HaplotypeCaller, hard-filtering and joint genotyping.",
  language: "nextflow",
  repo: "helix-genomics/germline-varcall",
  author: {
    name: "Elena Vasquez",
    role: "Senior Computational Biologist",
    departed: "August 2024",
  },
  stats: {
    files: 47,
    conversations: 1284,
    commits: 612,
    lastActive: "2024-08-12",
  },
  files: [
    {
      path: "conf/params.config",
      language: "groovy",
      description: "Pipeline parameters — reference build, aligner, filters, tooling",
      content: paramsConfig,
    },
    {
      path: "modules/local/filter_variants.nf",
      language: "groovy",
      description: "Hard-filtering step applying MAPQ / depth / QUAL thresholds",
      content: filterVariants,
    },
    {
      path: "modules/local/bwa_mem.nf",
      language: "groovy",
      description: "BWA-MEM alignment against the configured reference",
      content: bwaMem,
    },
    {
      path: "environment.yml",
      language: "yaml",
      description: "Conda environment — pinned tool versions",
      content: environmentYml,
    },
    {
      path: "main.nf",
      language: "groovy",
      description: "Top-level workflow wiring",
      content: mainNf,
    },
    {
      path: "README.md",
      language: "markdown",
      description: "Project overview",
      content: readme,
    },
  ],
};
