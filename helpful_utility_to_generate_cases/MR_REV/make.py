"""
MR_REV: a command then its inverse must bring the shop back to the start.
Every control's first sentence (sentences.toml), then its undo sentence. The source is empty (the start itself). 5.
Run: python3 helpful_utility_to_generate_cases/MR_REV/make.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))  # so Python finds helpful_utility_to_generate_cases/app.py, one folder up
from app import load_sentences, save


def rev_case(control):
    """Nothing said on the source side; the follow-up says u1, then its undo. Both change the same control."""
    u1, u2 = controls[control]["first"], controls[control]["undo"]
    return {"source": [], "followup": [u1, u2], "writes": {u1: [control], u2: [control]}}


controls, _ = load_sentences()
cases = [rev_case(control) for control in controls]

save(HERE / "MR_REV.out.toml", "MR_REV", cases)
