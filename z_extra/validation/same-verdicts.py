"""
Does harness/relations.py give the verdicts the old TypeScript harness gave, on the pilot cases it ran?

    python z_extra/validation/same-verdicts.py old-verdicts.jsonl     (from old-verdicts.ts: random outcomes, old check())

It judges, with the new relations, on the pilot cases written as TOML (pilot-cases/, from z_extra/cases/pilot.jsonl):
  1. every random outcome in old-verdicts.jsonl, against the old check()'s verdict on it
  2. every recorded trial in z_extra/results/*/, from its recorded turns, against its recorded verdict
An old pass must be a new pass or no-effect, an old fail a new fail, an old infra a new infra. Reasons may differ.
"""

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "harness"))
from relations import FAIL, RELATIONS, Trace, diff  # noqa: E402
from run import load_cases  # noqa: E402
from shop import INFRA_CODES, load_shop  # noqa: E402

V0 = {c.name: c.start for c in load_shop().values()}

# The old case ids → the new cases, matched on what they say.
new_cases, problems = load_cases(Path(__file__).parent / "pilot-cases")
assert not problems, problems
by_sentences = {(c.relation, tuple(u.text for u in c.source), tuple(u.text for u in c.followup)): c for c in new_cases}
case_of = {}
for line in open(ROOT / "z_extra/cases/pilot.jsonl", encoding="utf-8"):
    old = json.loads(line)
    case_of[old["id"]] = by_sentences[old["relation"], tuple(old["sourceTrace"]), tuple(old["followupTrace"])]


def same(old, new):
    return (old == "pass" and new in ("pass", "no-effect")) or old == new


def report(title, results):
    differ = [r for r in results if not same(r[1], r[2])]
    print(f"{title}: {len(results)} trials, {len(differ)} differ")
    print("   old → new:", dict(Counter(f"{old} → {new}" for _, old, new, _ in results)))
    for case, old, new, reason in differ[:10]:
        print(f"   {case}: old {old}, new {new} ({reason})")
    return not differ


# ── 1. Random outcomes ────────────────────────────────────────────────────────


def trace(said, side, shown_at_start):
    return Trace(said, V0, side["end"], [set(t) for t in side["turns"]], shown_at_start, side["shown"])


random_results = []
for line in open(sys.argv[1], encoding="utf-8"):
    r = json.loads(line)
    case = case_of[r["case"]]
    source = trace(case.source, r["source"], r["shownAtStart"])
    followup = trace(case.followup, r["followup"], r["shownAtStart"])
    verdict, reason = RELATIONS[case.relation][1](source, followup)
    random_results.append((case.id, "pass" if r["holds"] else "fail", verdict, reason))


# ── 2. Recorded trials ────────────────────────────────────────────────────────


def recorded_verdict(case, turns, trial):
    """What run.py would say, from the turns the old harness recorded."""
    failed = next((t for t in turns if not t["ok"]), None)
    if failed:
        code = (failed["meta"] or {}).get("error", {}) or {}
        return ("infra" if code.get("code") in INFRA_CODES else FAIL), f"mediator error: {failed['error']}"
    shown_at_start = turns[0]["dBefore"]["productIds"]
    sides = []
    for role, said in (("source", case.source), ("followup", case.followup)):
        mine = [t for t in turns if t["role"] == role]
        end = mine[-1]["vAfter"] if mine else V0
        shown = trial["observations"][role]["D"]["productIds"]
        sides.append(Trace(said, V0, end, [diff(t["vBefore"], t["vAfter"]) for t in mine], shown_at_start, shown))
    return RELATIONS[case.relation][1](*sides)


recorded_results = []
for run in sorted((ROOT / "z_extra/results").glob("*/trials.jsonl")):
    turns = {}
    for line in open(run.parent / "turns.jsonl", encoding="utf-8"):
        t = json.loads(line)
        turns[t["id"]] = t
    for line in open(run, encoding="utf-8"):
        trial = json.loads(line)
        case = case_of[trial["caseId"]]
        verdict, reason = recorded_verdict(case, [turns[i] for i in trial["turnIds"]], trial)
        recorded_results.append((case.id, trial["status"], verdict, reason))

ok = report("1. random outcomes", random_results)
ok = report("2. recorded trials", recorded_results) and ok
print("same verdicts" if ok else "VERDICTS DIFFER")
sys.exit(0 if ok else 1)
