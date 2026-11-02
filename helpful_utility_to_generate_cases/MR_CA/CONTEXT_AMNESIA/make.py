"""
CONTEXT_AMNESIA: MR_CA over more turns. What the first sentence set must keep its value while the others are said.
Every control's first sentence (sentences.toml) as u1, then every other control's first sentence, in file order: u1,
against u1 then the four others. 5 controls → 5.
Run: python3 helpful_utility_to_generate_cases/MR_CA/CONTEXT_AMNESIA/make.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))  # so Python finds helpful_utility_to_generate_cases/app.py, two folders up
from app import load_sentences, save


def amnesia_case(first):
    """u1, against u1 then the others."""
    said = [first] + [c for c in controls if c != first]
    return {"source": controls[first]["first"], "followup": [controls[c]["first"] for c in said],
            "writes": {controls[c]["first"]: [c] for c in said}}


controls, _ = load_sentences()
cases = [amnesia_case(control) for control in controls]

save(HERE / "CONTEXT_AMNESIA.out.toml", "CONTEXT_AMNESIA", cases)
