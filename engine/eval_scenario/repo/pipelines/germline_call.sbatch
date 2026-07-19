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

gatk HaplotypeCaller \
  --reference /refs/GRCh38/GRCh38_full_analysis_set.fasta \
  --input /data/aligned/cohortA_sample01.bam \
  --output /data/results/cohortA_sample01.vcf \
  --min-base-quality-score 18 \
  --standard-min-confidence-threshold-for-calling 30 \
  --native-pair-hmm-threads 8
