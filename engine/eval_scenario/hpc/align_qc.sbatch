#!/bin/bash
#SBATCH --job-name=align-qc
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=4
#SBATCH --mem=8G
#SBATCH --time=01:00:00
#SBATCH --output=/data/logs/slurm-%j.out

module load mosdepth/0.3.3

# Alignment coverage QC for cohortA.
mosdepth \
  --threads 4 \
  --output /data/qc/cohortA_qc_metrics.txt \
  --by 500 \
  /data/aligned/cohortA_sample01.bam
