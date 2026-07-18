#!/bin/bash
#SBATCH --job-name=rnaseq-quant
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=8
#SBATCH --mem=32G
#SBATCH --time=04:00:00
#SBATCH --output=/data/logs/slurm-%j.out

module load salmon/1.5.2

salmon quant \
  --index /refs/salmon/gencode_v38 \
  --libType ISR \
  --threads 8 \
  --numBootstraps 100 \
  --output /data/rnaseq/rnaseq_sampleA_quant.sf
