"""
MR_AC: adding a constraint must set just that control and keep what the plain command set.
Every constraining control's first sentence (sentences.toml) as the base, against it with each other constraining
control's δ added: "show electronics items" vs "show electronics items that are in stock". 4 × 3 = 12.
Run: python3 helpful_utility_to_generate_cases/MR_AC/make.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))  # so Python finds helpful_utility_to_generate_cases/app.py, one folder up
from app import constraint_pairs, load_sentences, save


def ac_case(base, d):
    """u against "u δ". The restricted sentence changes what u changes, and δ's control d."""
    u = controls[base]["first"]
    restricted = f"{u} {controls[d]['delta']}"
    return {"source": u, "followup": restricted, "refine": {"control": d, "value": controls[d]["value"]},
            "writes": {u: [base], restricted: [base, d]}}


controls, _ = load_sentences()
cases = [ac_case(base, d) for base, d in constraint_pairs(controls)]

save(HERE / "MR_AC.out.toml", "MR_AC", cases)
