"""Generate the cohortA paper figures from pipeline outputs."""

import sys


def main(results_dir: str) -> None:
    # Figure 2: variant counts from cohortA_sample01.vcf
    # Figure 3: transcript abundance from rnaseq_sampleA_quant.sf
    print(f"rendering figures from {results_dir}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/data/results")
