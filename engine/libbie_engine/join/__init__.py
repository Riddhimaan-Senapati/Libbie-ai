"""The join layer -- candidate generation -> scoring -> edge commit.

Everything else is plumbing; this is the company. Candidate generation is cheap
and recall-oriented; scoring is expensive and precision-oriented (an LLM
adjudicates each candidate with its evidence spans). Edges below the commit
threshold survive as ``hypothesis`` edges, surfaced honestly in the briefing.
"""

from .runner import run_join

__all__ = ["run_join"]
