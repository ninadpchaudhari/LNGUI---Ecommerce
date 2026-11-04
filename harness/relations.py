"""
The file to test relations!
Each relation is two functions:

    <relation>_valid(case)                is the case a proper case of this relation? None if so, else what is wrong
    <relation>(case, source, followup)    the verdict on one run of the case, and why: PASS, FAIL or NO_EFFECT

A case comes from cases/<relation>.toml: its "source" and "followup" sentences, and "writes", the controls each
sentence should change. run.py runs each side from a reset, and hands over what it saw on that side:

    start, end    every control's value after the reset, and at the end
    turns         for each sentence, the controls it changed

The relations compare only the controls' values, not the products shown.

NO_EFFECT: the relation held only because nothing changed, so it is not a real pass.
"""

import tomllib
from pathlib import Path

PASS, FAIL, NO_EFFECT = "pass", "fail", "no-effect"
SHOP = tomllib.loads((Path(__file__).parent.parent / "shop.toml").read_text(encoding="utf-8"))["control"]


def writes(case, sentence):
    return set(case["writes"][sentence])


def changed(before, after):
    """The controls whose values differ between two states, sorted."""
    return sorted(c for c in before.keys() | after.keys() if before.get(c) != after.get(c))


def did_nothing(side):
    return not changed(side["start"], side["end"])


def same_end(source, followup):
    """MR_CE, MR_CA and MR_COMP: 
    both sides end with the same "value" for every "control".
    PASS if equavalent.
    FALL if not
    NO_EFFECT if both sides did nothing.
    """
    different = changed(source["end"], followup["end"])
    if different:
        return FAIL, "V′ ≠ V″ on: " + ", ".join(different)
    if did_nothing(source) and did_nothing(followup):
        return NO_EFFECT, "nothing changed"
    return PASS, "V′ = V″"


# ── MR_CE 
def mr_ce_valid(case):
    if len(case["source"]) != 1 or len(case["followup"]) != 1:
        return "needs u1 vs u2"
    first, second = case["source"][0], case["followup"][0]
    if first == second or writes(case, first) != writes(case, second):
        return "needs u1 ≠ u2, W(u1) = W(u2)"


def mr_ce(case, source, followup):
    return same_end(source, followup)


# ── MR_CA 
def mr_ca_valid(case):
    if len(case["source"]) != 2 or case["followup"] != case["source"][::-1]:
        return "needs a, b vs b, a"
    a, b = case["source"]
    if writes(case, a) & writes(case, b):
        return "needs W(a) ∩ W(b) = ∅"


def mr_ca(case, source, followup):
    return same_end(source, followup)


# ── MR_COMP 
def mr_comp_valid(case):
    if len(case["source"]) < 2 or len(case["followup"]) != 1:
        return "needs u1, …, un vs one sentence"
    together = set().union(*(writes(case, sentence) for sentence in case["source"]))
    if writes(case, case["followup"][0]) != together:
        return "needs W(us) = W(u1) ∪ … ∪ W(un)"


def mr_comp(case, source, followup):
    return same_end(source, followup)


# ── MR_REV: a command, then its undo, ends where the reset left the shop.
#    Source: nothing. Follow-up: a sentence, then its undo, on reversible controls.

def mr_rev_valid(case):
    if case["source"] or len(case["followup"]) != 2:
        return "needs nothing vs u, undo"
    sentence, undo = case["followup"]
    if writes(case, sentence) != writes(case, undo) or not all(SHOP[c]["reversible"] for c in writes(case, sentence)):
        return "needs W(u) = W(undo), reversible"


def mr_rev(case, source, followup):
    not_back = changed(followup["start"], followup["end"])
    if not_back:
        return FAIL, "V″ ≠ V0 on: " + ", ".join(not_back)
    if not followup["turns"][0]:
        return NO_EFFECT, "u changed nothing"
    return PASS, "V″ = V0"


# ── MR_AC: adding a constraint to a sentence sets that one control, and keeps what the sentence set.
#    Source: a sentence. Follow-up: the same sentence with a constraint added. The case's refine says which
#    constraining control the constraint sets, and to what value.

def mr_ac_valid(case):
    if len(case["source"]) != 1 or len(case["followup"]) != 1 or "refine" not in case:
        return "needs base vs base δ, and refine"
    base, narrowed = case["source"][0], case["followup"][0]
    control = case["refine"]["control"]
    if not narrowed.startswith(base):
        return "needs the follow-up to start with the base"
    if not SHOP[control]["constraining"] or control in writes(case, base):
        return "needs δ to set a new constraining control"
    if writes(case, narrowed) != writes(case, base) | {control}:
        return "needs W(base δ) = W(base) ∪ {d}"


def mr_ac(case, source, followup):
    control, value = case["refine"]["control"], case["refine"]["value"]
    if followup["end"][control] != value:
        return FAIL, f"δ not applied: {control} = {followup['end'][control]!r}, not {value!r}"
    expected = {**source["end"], control: value}
    not_kept = changed(expected, followup["end"])
    if not_kept:
        return FAIL, "base not kept on: " + ", ".join(not_kept)
    if did_nothing(source):
        return NO_EFFECT, "base changed nothing"
    return PASS, "V_ref = V_base[d ↦ w]"


# ── CONTEXT_AMNESIA: what the first sentence set survives later sentences on other controls.
#    Source: one sentence. Follow-up: the same sentence, then more.

def context_amnesia_valid(case):
    if len(case["source"]) != 1 or len(case["followup"]) < 2 or case["followup"][0] != case["source"][0]:
        return "needs u1 vs u1, u2, …"
    first = case["source"][0]
    if any(writes(case, first) & writes(case, later) for later in case["followup"][1:]):
        return "needs W(u1) ∩ W(uk) = ∅"


def context_amnesia(case, source, followup):
    set_by_first = source["turns"][0]
    changed_later = set().union(*(writes(case, later) for later in case["followup"][1:]))  # these may change again
    lost = [c for c in sorted(set_by_first - changed_later) if followup["end"][c] != source["end"][c]]
    if lost:
        return FAIL, "lost what u1 set: " + ", ".join(lost)
    if not set_by_first:
        return NO_EFFECT, "u1 changed nothing"
    return PASS, "u1 kept"


RELATIONS = {
    "MR_CE": (mr_ce_valid, mr_ce),
    "MR_CA": (mr_ca_valid, mr_ca),
    "MR_COMP": (mr_comp_valid, mr_comp),
    "MR_REV": (mr_rev_valid, mr_rev),
    "MR_AC": (mr_ac_valid, mr_ac),
    "CONTEXT_AMNESIA": (context_amnesia_valid, context_amnesia),
}
