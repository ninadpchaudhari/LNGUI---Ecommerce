"""
The metamorphic relations, as the rows of Table 4.1 in the proposal.

A case has two sides, a source and a follow-up, each a list of sentences. Each sentence u comes with W(u): the controls
it is meant to change (the case file's [case.writes]). run.py runs each side from σ0 and hands both Traces to the
case's relation. What a side ends in is O(σ) = ⟨V, D⟩: every control's value, and the products shown, in order.

Each relation is two functions:

    <relation>_valid(source, followup)   None if the case fits the relation, else what is wrong (checked before any run)
    <relation>(source, followup)         the verdict on one trial, and why: PASS, FAIL or NO_EFFECT

NO_EFFECT: the relation held only because the command it is about changed nothing, so it is not a real pass.
"""

from dataclasses import dataclass

from shop import load_shop

PASS, FAIL, NO_EFFECT = "pass", "fail", "no-effect"
CONTROLS = load_shop()  # shop.toml: which controls are constraining and reversible, and their values


@dataclass
class Utterance:
    text: str
    writes: set  # W(u): the controls it is meant to change
    delta: tuple | None = None  # MR_AC's u_ref only: (d, w), the control δ sets and its value (the case's `refine`)


@dataclass
class Trace:
    """One side of a case as it ran: what was said, the state before (σ0) and after, and what each sentence changed."""

    said: list  # the Utterances
    start: dict  # V0 = σ0
    end: dict  # V′ for the source, V″ for the follow-up
    turns: list  # for each sentence, the set of controls it changed
    shown_at_start: list  # D0: the ids of the products shown in σ0
    shown: list  # D′ or D″: the ids of the products shown at the end, in order

    def changed(self):
        """The controls this side changed from σ0."""
        return diff(self.start, self.end)


def diff(a, b):
    """The controls on which two states differ."""
    return {c for c in a.keys() | b.keys() if a.get(c) != b.get(c)}


def names(controls):
    return ", ".join(sorted(controls))


def same_outcome(a, b):
    """O(σ′) = O(σ″), else why not. D is compared in order: sort is a control, so a different order is a difference."""
    differ = diff(a.end, b.end)
    if differ:
        return f"V′ ≠ V″ on: {names(differ)}"
    if a.shown != b.shown:
        return "D′ ≠ D″: the products shown differ"
    return None


# ── Predicates, as far as the write sets let us check them ────────────────────


def para(u1, u2):
    """Para(u1, u2): the same command, worded differently. Checked as W(u1) = W(u2)."""
    return u1.writes == u2.writes


def indep(u1, u2):
    """Indep(u1, u2): the two commands share no control. W(u1) ∩ W(u2) = ∅."""
    return not (u1.writes & u2.writes)


def rev(uf, ui):
    """Rev(uf, ui): ui undoes uf. Checked as W(uf) = W(ui), and every control in it is reversible (shop.toml)."""
    return uf.writes == ui.writes and all(CONTROLS[c].reversible for c in uf.writes)


def comp(s, us):
    """Comp(s, us): us says all of s at once. Checked as W(us) = W(u1) ∪ … ∪ W(un)."""
    return us.writes == set().union(*(u.writes for u in s))


def refine(u_ref, u_base):
    """
    Refine(u_ref, u_base, δ): u_ref = u_base ⊕ δ ("… that are in stock"), and δ sets one constraining control d, which
    u_base does not, to w. Checked as: u_ref starts with u_base, W(u_ref) = W(u_base) ∪ {d}, d ∉ W(u_base), d is
    constraining (shop.toml) and w is one of its values.
    """
    if u_ref.delta is None:
        return False
    d, w = u_ref.delta
    return (u_ref.text.startswith(u_base.text) and d not in u_base.writes and u_ref.writes == u_base.writes | {d}
            and d in CONTROLS and CONTROLS[d].constraining and CONTROLS[d].allows(w))


# ── MR_CE: Control Equivalence ────────────────────────────────────────────────
# Two wordings of one command leave the shop in the same state.        Para(u1, u2)  ⟹  O(σ′) = O(σ″)


def mr_ce_valid(source, followup):
    if len(source) != 1 or len(followup) != 1:
        return "it needs one sentence on each side"
    u1, u2 = source[0], followup[0]
    if u1.text == u2.text:
        return "u1 and u2 are the same sentence"
    if not para(u1, u2):
        return "Para(u1, u2) fails: W(u1) ≠ W(u2)"
    return None


def mr_ce(source, followup):
    if problem := same_outcome(source, followup):
        return FAIL, problem
    if not source.changed() and not followup.changed():
        return NO_EFFECT, "neither wording changed anything"
    return PASS, "O(σ′) = O(σ″)"


# ── MR_CA: Commuting Actions ──────────────────────────────────────────────────
# Two independent commands, in either order, leave the shop in the same state.   Indep(u1, u2)  ⟹  O(σ′) = O(σ″)
# Source: [u1, u2].  Follow-up: [u2, u1].


def mr_ca_valid(source, followup):
    if len(source) != 2 or len(followup) != 2:
        return "it needs two sentences on each side"
    u1, u2 = source
    if [u.text for u in followup] != [u2.text, u1.text]:
        return "the follow-up must be u2 then u1"
    if not u1.writes or not u2.writes:
        return "u1 and u2 must each change something"
    if not indep(u1, u2):
        return "Indep(u1, u2) fails: they share a control"
    return None


def mr_ca(source, followup):
    if problem := same_outcome(source, followup):
        return FAIL, problem
    if not source.changed() and not followup.changed():
        return NO_EFFECT, "neither order changed anything"
    return PASS, "O(σ′) = O(σ″)"


# ── MR_COMP: Composition ──────────────────────────────────────────────────────
# Commands said one by one, or all in one sentence, leave the shop in the same state.   Comp(s, us)  ⟹  O(σ′) = O(σ″)
# Source: s = [u1, …, un], n ≥ 2.  Follow-up: [us].


def mr_comp_valid(source, followup):
    if len(source) < 2 or len(followup) != 1:
        return "it needs two or more sentences, s, and one sentence, us"
    if not comp(source, followup[0]):
        return "Comp(s, us) fails: W(us) ≠ the union of W(u) over s"
    return None


def mr_comp(source, followup):
    if problem := same_outcome(source, followup):
        return FAIL, problem
    if not source.changed() and not followup.changed():
        return NO_EFFECT, "neither side changed anything"
    return PASS, "O(σ′) = O(σ″)"


# ── MR_REV: Action Reversibility ──────────────────────────────────────────────
# A command, then its inverse, returns the shop to where it started.     Rev(uf, ui)  ⟹  O(σ″) = O(σ0)
# Source: nothing (it is σ0).  Follow-up: [uf, ui].


def mr_rev_valid(source, followup):
    if source:
        return "the source must be empty (it is σ0)"
    if len(followup) != 2:
        return "the follow-up must be uf then ui"
    uf, ui = followup
    if not rev(uf, ui):
        return "Rev(uf, ui) fails: W(uf) ≠ W(ui), or a control in it is not reversible"
    return None


def mr_rev(source, followup):
    not_back = followup.changed()
    if not_back:
        return FAIL, f"V″ ≠ σ0 on: {names(not_back)}"
    if followup.shown != followup.shown_at_start:
        return FAIL, "D″ ≠ D0: the products shown differ"
    if not followup.turns[0]:  # back at σ0 proves nothing if uf did nothing
        return NO_EFFECT, "uf changed nothing"
    return PASS, "O(σ″) = O(σ0)"


# ── MR_AC: Additive Constraining ──────────────────────────────────────────────
# Adding a constraint ("show sports gear" ⊕ "that are in stock") sets that one control and keeps everything the base
# command set; the products shown can only shrink.     Refine(u_ref, u_base, δ)  ⟹  V_ref = V_base[d ↦ w] ∧ D_ref ⊆ D_base
# Source: [u_base].  Follow-up: [u_ref].


def mr_ac_valid(source, followup):
    if len(source) != 1 or len(followup) != 1:
        return "it needs one sentence on each side"
    if not refine(followup[0], source[0]):
        return ("Refine(u_ref, u_base, δ) fails: u_ref must start with u_base, `refine` must set a constraining control "
                "u_base does not write to one of its values, and W(u_ref) = W(u_base) ∪ {d}")
    return None


def mr_ac(base, ref):
    d, w = ref.said[0].delta
    expected = {**base.end, d: w}  # V_base[d ↦ w]
    if ref.end[d] != w:
        return FAIL, f"δ was not applied: {d} is {ref.end[d]!r}, not {w!r}"
    moved = diff(expected, ref.end)
    if moved:
        return FAIL, f"u_ref did not keep what u_base set: V_ref ≠ V_base[d ↦ w] on: {names(moved)}"
    extra = [p for p in ref.shown if p not in base.shown]
    if extra:
        return FAIL, f"D_ref ⊄ D_base: u_ref shows products u_base did not: {', '.join(map(str, extra))}"
    if not base.changed():  # u_base set nothing, so there was no constraint to keep
        return NO_EFFECT, "u_base changed nothing"
    return PASS, "V_ref = V_base[d ↦ w] and D_ref ⊆ D_base"


# ── CONTEXT_AMNESIA (diagnostic) ──────────────────────────────────────────────
# What u1 set survives the later, independent commands of the same conversation.
#                                                      Indep(u1, uk) for every later uk  ⟹  V″ = V′ on what u1 changed
# Source: [u1].  Follow-up: [u1, u2, …, uk].


def context_amnesia_valid(source, followup):
    if len(source) != 1 or len(followup) < 2:
        return "it needs one source sentence u1 and a longer follow-up"
    u1 = source[0]
    if followup[0].text != u1.text:
        return "the follow-up must start with u1"
    if not all(indep(u1, uk) for uk in followup[1:]):
        return "Indep(u1, uk) fails for a later uk"
    return None


def context_amnesia(source, followup):
    set_by_u1 = source.turns[0]
    written_later = set().union(*(uk.writes for uk in followup.said[1:]))
    lost = {c for c in set_by_u1 - written_later if source.end[c] != followup.end[c]}
    if lost:
        return FAIL, f"lost what u1 set: {names(lost)}"
    if not set_by_u1:
        return NO_EFFECT, "u1 changed nothing"
    return PASS, "what u1 set survived"


RELATIONS = {
    "MR_CE": (mr_ce_valid, mr_ce),
    "MR_CA": (mr_ca_valid, mr_ca),
    "MR_COMP": (mr_comp_valid, mr_comp),
    "MR_REV": (mr_rev_valid, mr_rev),
    "MR_AC": (mr_ac_valid, mr_ac),
    "CONTEXT_AMNESIA": (context_amnesia_valid, context_amnesia),
}
