"""
Prints the cases for one control, to paste into cases/<relation>.toml. Set CONTROL below (or pass it), then:

    python3 helpful_utility_to_generate_cases/make.py              # CONTROL below
    python3 helpful_utility_to_generate_cases/make.py maxPrice     # another control

The sentences are ours, written by hand from shop.toml (SENTENCES below). For each control: one value other than its start
value, a sentence that sets it, a rewording, an undo (reversible controls), and a phrase that adds it to another
sentence (constraining controls). A case that pairs two controls is printed under the first of them in shop.toml.
Case ids are numbered in shop.toml's order of controls, so pasting the controls in that order gives MR_CE-001, -002, ….
"""

import json
import sys

CONTROL = sys.argv[1] if len(sys.argv) > 1 else "category"

SENTENCES = {
    "category":    {"value": "electronics", "set": "show electronics items", "reword": "filter to electronics only",
                    "undo": "show all categories", "narrow": "in electronics"},
    "maxPrice":    {"value": 100, "set": "show items under $100", "reword": "show items cheaper than $100",
                    "undo": "remove the price limit", "narrow": "under $100"},
    "minRating":   {"value": 4, "set": "show items rated 4 stars and up", "reword": "show items with at least 4 stars",
                    "undo": "remove the rating filter", "narrow": "rated 4 stars and up"},
    "inStockOnly": {"value": True, "set": "hide out-of-stock items", "reword": "only show items that are in stock",
                    "undo": "show out-of-stock items again", "narrow": "that are in stock"},
    "sort":        {"value": "rating_desc", "set": "sort by rating", "reword": "order the results by rating",
                    "undo": "use the default order"},
}
ORDER = list(SENTENCES)  # shop.toml's order


def case(source, followup, writes, refine=None):
    return source, followup, writes, refine


def toml(id, source, followup, writes, refine):
    """One case, as TOML. q() writes a value: JSON's strings, numbers, booleans and lists are TOML's too."""
    q = lambda value: json.dumps(value, ensure_ascii=False)
    side = lambda s: q(s[0] if len(s) == 1 else s)
    lines = ["[[case]]", f'id = "{id}"', f"source = {side(source)}", f"followup = {side(followup)}"]
    if refine:
        lines.append(f"refine = {{control = {q(refine[0])}, value = {q(refine[1])}}}")
    lines += ["", "[case.writes]"] + [f"{q(u)} = {q(w)}" for u, w in writes.items()]
    return "\n".join(lines) + "\n"


def cases_for(c):
    """The cases of one control, by relation: each rule applied to its sentences."""
    u = SENTENCES[c]["set"]
    later = ORDER[ORDER.index(c) + 1:]  # the controls after c: each pair of controls once
    others = [x for x in ORDER if x != c]

    out = {"MR_CE": [], "MR_CA": [], "MR_COMP": [], "MR_REV": [], "MR_AC": [], "CONTEXT_AMNESIA": []}

    # MR_CE: u vs its rewording, and vs four edits of u
    for v in [SENTENCES[c]["reword"], u.upper(), f"could you please {u}", f"{u}, thanks", f"hey, {u}"]:
        out["MR_CE"].append(case([u], [v], {u: [c], v: [c]}))

    # MR_CA: a, b vs b, a
    for b in later:
        ub = SENTENCES[b]["set"]
        out["MR_CA"].append(case([u, ub], [ub, u], {u: [c], ub: [b]}))

    # MR_COMP: u, u vs u; and a, b vs "a and b"
    out["MR_COMP"].append(case([u, u], [u], {u: [c]}))
    for b in later:
        ub = SENTENCES[b]["set"]
        joined = f"{u} and {ub}"
        out["MR_COMP"].append(case([u, ub], [joined], {u: [c], ub: [b], joined: [c, b]}))

    # MR_REV: nothing said vs u, then its undo
    if "undo" in SENTENCES[c]:
        undo = SENTENCES[c]["undo"]
        out["MR_REV"].append(case([], [u, undo], {u: [c], undo: [c]}))

    # MR_AC: u vs u plus another constraining control's phrase
    if "narrow" in SENTENCES[c]:
        for d in others:
            if "narrow" in SENTENCES[d]:
                narrowed = f"{u} {SENTENCES[d]['narrow']}"
                out["MR_AC"].append(case([u], [narrowed], {u: [c], narrowed: [c, d]},
                                         refine=(d, SENTENCES[d]["value"])))

    # CONTEXT_AMNESIA: u vs u, then the next three controls' sentences
    next3 = [ORDER[(ORDER.index(c) + k) % len(ORDER)] for k in (1, 2, 3)]
    said = [SENTENCES[x]["set"] for x in next3]
    out["CONTEXT_AMNESIA"].append(case([u], [u, *said],
                                       {u: [c], **{SENTENCES[x]["set"]: [x] for x in next3}}))
    return out


# Number every case in shop.toml's order, then print CONTROL's.
numbers = {}
for x in ORDER:
    for relation, found in cases_for(x).items():
        start = numbers.get(relation, 0)
        numbers[relation] = start + len(found)
        if x == CONTROL and found:
            print(f"# ==> paste into cases/{relation}.toml\n")
            print(f"# ── C = {x} " + "─" * (90 - len(x)) + "\n")
            print("\n".join(toml(f"{relation}-{start + i:03d}", *c) for i, c in enumerate(found, start=1)))
