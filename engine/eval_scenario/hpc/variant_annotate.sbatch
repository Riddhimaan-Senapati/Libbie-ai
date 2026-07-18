#!/bin/bash
#SBATCH --job-name=variant-annotate
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=4
#SBATCH --mem=16G
#SBATCH --time=02:00:00
#SBATCH --output=/data/logs/slurm-%j.out

module load ensembl-vep/105

# Functional annotation of the germline calls with Ensembl VEP.
# cache-version 105 pinned in #annotation (2021-02-11) to match the assembly.
vep \
  --input /data/results/cohortA_sample01.vcf \
  --cache-version 105 \
  --fork 4 \
  --output /data/annot/cohortA_annotated.vcf
