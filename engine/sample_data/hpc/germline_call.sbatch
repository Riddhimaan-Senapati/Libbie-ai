#!/bin/bash
#SBATCH --job-name=germline-call
#SBATCH --partition=gpu
#SBATCH --nodes=1
#SBATCH --ntasks=8
#SBATCH --mem=64G
#SBATCH --time=12:00:00
#SBATCH --output=/data/logs/slurm-%j.out

module load gatk/4.2.6.1
module load samtools/1.15

# germline short-variant discovery, 2019 exome cohort.
# Reference build is GRCh37 on purpose -- see #pipeline-genomics thread (2023-02).
gatk HaplotypeCaller \
  --reference /refs/GRCh37/human_g1k_v37.fasta \
  --input /data/aligned/sample01.bam \
  --output /data/results/sample01.vcf \
  --min-base-quality-score 20 \
  --standard-min-confidence-threshold-for-calling 30
