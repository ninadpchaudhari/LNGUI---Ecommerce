"""
MR_CE: the same command said two ways must leave the shop in the same state.
  1. every pair of templates of one control (sentences.toml)
  2. every template with the value's first phrase, against it with each other phrase ("rating" / "best rated first")
  3. every reviewed pair (reviewed.toml)
  4. every macro (control-agnostic.toml) on every sentence it fits: the 8 sentences, and Figure 1.2's
Run: python3 helpful_utility_to_generate_cases/MR_CE/make.py
"""
import re
import sys
import tomllib
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))  # so Python finds helpful_utility_to_generate_cases/app.py, one folder up
from app import fill, load_sentences, save

MACROS = tomllib.load(open(HERE / "control-agnostic.toml", "rb"))
REVIEWED = tomllib.load(open(HERE / "reviewed.toml", "rb"))["pair"]


def sort_clause_first(u):
    """ "show electronics under $100 sorted by rating" → "sorted by rating show electronics under $100" """
    clause = re.search(r" sorted by [\w ]+$", u)
    return f"{clause.group().strip()} {u.removesuffix(clause.group())}" if clause else None


# A filter returns None when it does not fit the sentence; the macro is then skipped for it.
FILTERS = {"upper": str.upper,
           "after show": lambda u: u.removeprefix("show ") if u.startswith("show ") else None,
           "sort clause first": sort_clause_first}


def apply(macro, u):
    """A control-agnostic macro, applied to the sentence u: {u} is u, {u|f} is u passed through the filter f. None if
    a filter does not fit u."""
    parts = {m[1]: FILTERS[m[1]](u) for m in re.finditer(r"\{u\|([^}]+)\}", macro)}
    if None in parts.values():
        return None
    return re.sub(r"\{u(?:\|([^}]+))?\}", lambda m: parts[m[1]] if m[1] else u, macro)


def ce_case(u1, u2, writes):
    """u1 against u2. Both change the same controls."""
    return {"source": u1, "followup": u2, "writes": {u1: writes, u2: writes}}


controls, figure = load_sentences()
cases = []

for control, c in controls.items():
    for u1, u2 in combinations(c["sentences"], 2):
        cases.append(ce_case(u1, u2, [control]))

for control, c in controls.items():
    first, *others = c["phrases"]
    for template in c["templates"]:
        for other in others:
            cases.append(ce_case(fill(template, first), fill(template, other), [control]))

for pair in REVIEWED:
    cases.append(ce_case(pair["u1"], pair["u2"], pair["writes"]))

sentences = [(u, [control]) for control, c in controls.items() for u in c["sentences"]]
sentences.append((figure, ["category", "maxPrice", "sort"]))
for macro in MACROS.values():
    for u1, writes in sentences:
        if u2 := apply(macro, u1):
            cases.append(ce_case(u1, u2, writes))

save(HERE / "MR_CE.out.toml", "MR_CE", cases)
