"""
Runs every case N times on one configuration, and checks the cases.

    python harness/run.py configs/<config>.env [N]     its server must be running (see the README); N defaults to 10
    python harness/run.py --check                      checks the cases and prints each relation's control coverage

For each case, N times: reset and say the source sentences; reset and say the follow-up sentences; the case's relation
(relations.py) gives the verdict. Each trial is one row of results/<config>.csv; a run replaces the file.
A trial whose plumbing failed (the server or the model provider, not the shop) is recorded as infra.
"""

import csv
import json
import sys
import tomllib
from pathlib import Path

from relations import FAIL, RELATIONS, SHOP, changed
from shop import InfraError, Shop

ROOT = Path(__file__).parent.parent
ADMITS = {"MR_REV": "reversible", "MR_AC": "constraining"}  # the controls these two relations admit; the others admit all


def load_cases():
    cases = []
    for file in sorted((ROOT / "cases").glob("*.toml")):
        data = tomllib.loads(file.read_text(encoding="utf-8"))
        for case in data["case"]:
            for side in ("source", "followup"):
                if isinstance(case[side], str):
                    case[side] = [case[side]]
            cases.append({**case, "relation": data["relation"]})
    return cases


def problem(case):
    """None if the case is fine, else what is wrong with it."""
    if missing := [u for u in case["source"] + case["followup"] if u not in case["writes"]]:
        return f'no writes for "{missing[0]}"'
    if unknown := [c for writes in case["writes"].values() for c in writes if c not in SHOP]:
        return f"unknown control {unknown[0]}"
    valid, _ = RELATIONS[case["relation"]]
    return valid(case)


def coverage(cases):
    """For each relation, how many of the controls it admits its cases change (the goal is all of them)."""
    for relation in RELATIONS:
        admitted = {c for c in SHOP if relation not in ADMITS or SHOP[c][ADMITS[relation]]}
        covered = {c for case in cases if case["relation"] == relation for w in case["writes"].values() for c in w}
        missing = sorted(admitted - covered)
        print(f"  {relation:16} {len(admitted & covered)}/{len(admitted)}" + (f"  missing: {', '.join(missing)}" if missing else ""))


def run_side(shop, sentences):
    """Resets the shop, then says each sentence in one conversation."""
    reset = shop.reset()
    side = {"start": reset["V"], "end": reset["V"], "turns": [], "error": None}
    for sentence in sentences:
        turn = shop.say(sentence)
        side["turns"].append(set(changed(side["end"], turn["V"])))
        side["end"] = turn["V"]
        if turn["error"] and not side["error"]:
            side["error"] = f'mediator error on "{sentence}": {turn["error"]}'
    return side


def describe(side):
    """What a side changed from the reset, e.g. category="books" maxPrice=50."""
    return " ".join(f"{c}={json.dumps(side['end'][c])}" for c in changed(side["start"], side["end"]))


def run_trial(shop, case):
    """Run a trial of the shop with the given case.
    Returns: verdict, reason, what the source changed, what the follow-up changed"""
    try:
        source, followup = run_side(shop, case["source"]), run_side(shop, case["followup"])
    except InfraError as e:
        return "infra", str(e), "", ""
    if error := source["error"] or followup["error"]:
        verdict, reason = FAIL, error
    else:
        _, check = RELATIONS[case["relation"]]
        verdict, reason = check(case, source, followup)
    return verdict, reason, describe(source), describe(followup)


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    cases = load_cases()
    bad = [f"{case['id']}: {p}" for case in cases if (p := problem(case))]
    if bad:
        raise SystemExit("cases/ has problems:\n  " + "\n  ".join(bad))
    if args[0] == "--check":
        print(f"{len(cases)} cases, all fine. Controls covered, per relation:")
        return coverage(cases)

    config, n = Path(args[0]), int(args[1]) if len(args) > 1 else 10
    port = next(line.split("=", 1)[1].strip() for line in config.read_text().splitlines() if line.startswith("PORT="))
    shop = Shop(port)
    (ROOT / "results").mkdir(exist_ok=True)
    with open(ROOT / "results" / f"{config.stem}.csv", "w", newline="", encoding="utf-8-sig") as f:
        out = csv.writer(f)
        out.writerow(["config", "case", "relation", "trial", "verdict", "reason", "source_changed", "followup_changed"])
        for case in cases:
            for trial in range(1, n + 1):
                verdict, reason, source, followup = run_trial(shop, case)
                out.writerow([config.stem, case["id"], case["relation"], trial, verdict, reason, source, followup])
                f.flush()
                print(f"{case['id']} {trial}/{n} {verdict}" + ("" if verdict == "pass" else f": {reason}"))


if __name__ == "__main__":
    main()
