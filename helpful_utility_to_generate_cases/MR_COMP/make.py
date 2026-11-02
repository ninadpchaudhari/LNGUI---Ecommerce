"""
MR_COMP: sentences said in turn must end the same as one sentence that says them all.
  1. every control's first sentence (sentences.toml) said twice, against said once (5)
  2. MR_AC's 12 pairs as two turns, the base then δ on its own, against "base δ" (12)
  3. the same, with "sort by rating" as a third turn, against "base δ sorted by rating" (12)
Run: python3 helpful_utility_to_generate_cases/MR_COMP/make.py
"""
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))  # so Python finds helpful_utility_to_generate_cases/app.py, one folder up
from app import constraint_pairs, load_sentences, save

MACROS = tomllib.load(open(HERE / "control-agnostic.toml", "rb"))  # two = "{a} {b}", three = "… sorted by {c|after sort by}"


def twice_case(control):
    """u, u against u."""
    u = controls[control]["first"]
    return {"source": [u, u], "followup": u, "writes": {u: [control]}}


def joined_case(turns):
    """The turns [(sentence, its control)], against one sentence saying them all. The joined sentence changes what
    every turn changes."""
    (a, _), (b, _), *c = turns
    joined = MACROS["two" if not c else "three"].replace("{a}", a).replace("{b}", b)
    if c:
        joined = joined.replace("{c|after sort by}", c[0][0].removeprefix("sort by "))
    writes = {u: [control] for u, control in turns}
    return {"source": [u for u, _ in turns], "followup": joined,
            "writes": {**writes, joined: [control for _, control in turns]}}


controls, _ = load_sentences()
sort = (controls["sort"]["first"], "sort")

cases = [twice_case(control) for control in controls]
for third in ([], [sort]):
    for base, d in constraint_pairs(controls):
        cases.append(joined_case([(controls[base]["first"], base), (controls[d]["delta"], d)] + third))

save(HERE / "MR_COMP.out.toml", "MR_COMP", cases)
