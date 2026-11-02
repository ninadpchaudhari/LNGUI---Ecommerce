"""
MR_CA: two independent commands must end the same in either order.
Every pair of controls, each by its first sentence (sentences.toml): a then b, against b then a. 5 controls → 10.
Run: python3 helpful_utility_to_generate_cases/MR_CA/make.py
"""
import sys
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))  # so Python finds helpful_utility_to_generate_cases/app.py, one folder up
from app import load_sentences, save


def ca_case(x, y):
    """a then b, against b then a."""
    a, b = controls[x]["first"], controls[y]["first"]
    return {"source": [a, b], "followup": [b, a], "writes": {a: [x], b: [y]}}


controls, _ = load_sentences()
cases = [ca_case(x, y) for x, y in combinations(controls, 2)]

save(HERE / "MR_CA.out.toml", "MR_CA", cases)
