"""
Runs every case N times on one configuration (Algorithm 1):

    for each round 1..N, for each case (shuffled, in the same order every run):
        reset to σ0, say the source sentences      → O(σ′)
        reset to σ0, say the follow-up sentences   → O(σ″)
        the case's relation compares them (relations.py) → pass / fail / no-effect

    python harness/run.py <config> [--n 10]     (start its app first: python harness/setup.py <config>)
    python harness/run.py --check               only check the cases (no app needed)

Writes results/<config>.csv (one row per trial) and results/<config>.toml (one line per case). A run replaces both.
To run only some cases, move the others out of cases/.
A trial whose plumbing failed (InfraError) is tried again, twice at most; then it is recorded as infra.
"""

import argparse
import csv
import json
import random
import tomllib
from dataclasses import dataclass

from relations import FAIL, RELATIONS, Trace, Utterance, diff
from shop import ROOT, InfraError, Shop, load_shop

SEED = 1
RETRIES = 2
SYMBOL = {"pass": "●", "fail": "○", "no-effect": "◌", "infra": "!"}


# ── Cases: cases/<relation>.toml ──────────────────────────────────────────────


@dataclass
class Case:
    id: str
    relation: str
    source: list  # the Utterances of each side
    followup: list


def load_cases(folder=ROOT / "cases"):
    """Every case in cases/, and what is wrong with them (unknown controls, missing writes, broken preconditions)."""
    known = load_shop()
    cases, problems = [], []
    for file in sorted(folder.glob("*.toml")):
        data = tomllib.loads(file.read_text(encoding="utf-8"))
        relation = data["relation"]
        if relation not in RELATIONS:
            problems.append(f"{file.name}: unknown relation {relation}")
            continue
        for w in data.get("case", []):
            where = f"{file.name} {w['id']}"
            writes = w.get("writes", {})
            sides = []
            for side in (w["source"], w["followup"]):
                utterances = []
                for text in [side] if isinstance(side, str) else side:
                    if text not in writes:
                        problems.append(f'{where}: no writes for "{text}"')
                    problems += [f"{where}: unknown control {x}" for x in writes.get(text, []) if x not in known]
                    utterances.append(Utterance(text, set(writes.get(text, []))))
                sides.append(utterances)
            said = {u.text for side in sides for u in side}
            problems += [f'{where}: writes names "{text}", which neither side says' for text in writes if text not in said]
            if "refine" in w:  # MR_AC: the (d, w) that δ sets, carried by u_ref
                sides[1][-1].delta = (w["refine"]["control"], w["refine"]["value"])

            case = Case(w["id"], relation, *sides)
            valid, _ = RELATIONS[relation]
            if problem := valid(case.source, case.followup):
                problems.append(f"{where}: {relation}: {problem}")
            cases.append(case)

    ids = [c.id for c in cases]
    problems += [f"case id used twice: {id}" for id in sorted({id for id in ids if ids.count(id) > 1})]
    return cases, problems


# ── One trial ─────────────────────────────────────────────────────────────────


def run_side(shop, said):
    """Resets to σ0, then says each sentence in one conversation. Returns the Trace, and the first mediator error."""
    start, shown_at_start = shop.reset()
    V, shown, turns, error = start, shown_at_start, [], None
    for u in said:
        problem = shop.say(u.text)
        after, shown = shop.read()
        turns.append(diff(V, after))
        V = after
        if problem and not error:
            error = f'mediator error on "{u.text}": {problem}'
    return Trace(said, start, V, turns, shown_at_start, shown), error


def run_trial(shop, case):
    """→ (verdict, reason, source Trace, follow-up Trace)"""
    for attempt in range(RETRIES + 1):
        try:
            source, source_error = run_side(shop, case.source)
            followup, followup_error = run_side(shop, case.followup)
        except InfraError as e:
            if attempt == RETRIES:
                return "infra", str(e), None, None
            continue
        if source_error or followup_error:
            return FAIL, source_error or followup_error, source, followup
        _, check = RELATIONS[case.relation]
        verdict, reason = check(source, followup)
        return verdict, reason, source, followup


# ── Results ───────────────────────────────────────────────────────────────────


def changes(trace):
    """What a side changed from σ0, e.g. "category=books maxPrice=50"."""
    return "" if trace is None else " ".join(f"{c}={json.dumps(trace.end[c])}" for c in sorted(trace.changed()))


def write_toml(path, config, n, rows):
    """One line per case: its trials as marks, its fail count, and why the first failure failed."""
    lines = [
        f"# {config}: {len({r['case'] for r in rows})} cases × N={n}. Settings: configs/{config}.env. Every trial: {config}.csv",
        "# ● pass   ○ fail   ◌ passed with no effect   ! infrastructure failure",
        "",
        f"[{json.dumps(config)}]",
    ]
    ids = sorted({r["case"] for r in rows})
    width = max(len(json.dumps(id)) for id in ids)
    for id in ids:
        trials = sorted((r for r in rows if r["case"] == id), key=lambda r: r["trial"])
        fails = [r for r in trials if r["verdict"] == FAIL]
        fields = [f'trials = "{"".join(SYMBOL[r["verdict"]] for r in trials)}"', f"fails = {len(fails)}"]
        if fails:
            fields.append(f"first = {json.dumps(fails[0]['reason'], ensure_ascii=False)}")
        lines.append(f"{json.dumps(id).ljust(width)} = {{ {', '.join(fields)} }}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── Command line ──────────────────────────────────────────────────────────────


def main():
    args = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    args.add_argument("config", nargs="?", help="one of configs/*.env")
    args.add_argument("--n", type=int, default=10, help="trials per case (default 10)")
    args.add_argument("--check", action="store_true", help="only check the cases")
    args = args.parse_args()

    cases, problems = load_cases()
    if problems:
        raise SystemExit("cases/ has problems:\n  " + "\n  ".join(problems))
    if args.check:
        return print(f"{len(cases)} cases, all fine")
    if not args.config:
        raise SystemExit("which configuration? python harness/run.py <config> (one of configs/*.env)")

    (ROOT / "results").mkdir(exist_ok=True)
    csv_path, toml_path = ROOT / "results" / f"{args.config}.csv", ROOT / "results" / f"{args.config}.toml"
    shop = Shop(args.config)
    try:
        shop.read()
    except InfraError:
        raise SystemExit(f"{args.config}'s app is not running; python harness/setup.py {args.config}")
    print(f"{args.config}: {len(cases)} cases × N={args.n} → results/{args.config}.csv, results/{args.config}.toml")

    order = random.Random(SEED)
    rows = []
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        out = csv.DictWriter(f, ["config", "case", "relation", "trial", "verdict", "reason", "source_changed", "followup_changed"])
        out.writeheader()
        for trial in range(1, args.n + 1):
            for case in order.sample(cases, len(cases)):
                verdict, reason, source, followup = run_trial(shop, case)
                row = {"config": args.config, "case": case.id, "relation": case.relation, "trial": trial, "verdict": verdict,
                       "reason": reason, "source_changed": changes(source), "followup_changed": changes(followup)}
                rows.append(row)
                out.writerow(row)
                f.flush()
                write_toml(toml_path, args.config, args.n, rows)
                fails = sum(r["verdict"] == FAIL for r in rows)
                print(f"{len(rows)}/{len(cases) * args.n}  fails {fails}  {case.id} {verdict}{'' if verdict == 'pass' else ': ' + reason}")


if __name__ == "__main__":
    main()
