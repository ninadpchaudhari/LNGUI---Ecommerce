"""
fail rate, fail@2 and fail@5 per configuration and relation, from every results/<config>.csv.

    python harness/summary.py          → printed, and results/summary.csv

Infra trials are left out of every rate. 
fail@k is the chance that at least one of k trials of a case fails,
1 − C(N−c, k) / C(N, k) for a case with c fails in N trials, 
averaged over the relation's cases.
"""

import csv
from collections import defaultdict
from math import comb

from shop import ROOT

K = [2, 5]

rows = []
for path in sorted((ROOT / "results").glob("*.csv")):
    if path.name != "summary.csv":
        rows += list(csv.DictReader(open(path, encoding="utf-8-sig")))

groups = defaultdict(list)
for r in rows:
    groups[r["config"], r["relation"]].append(r)

table = [["config", "relation", "cases", "trials", "fails", "no_effect", "infra", "fail_rate", *[f"fail@{k}" for k in K]]]
for (config, relation), trials in sorted(groups.items()):
    valid = [t for t in trials if t["verdict"] != "infra"]
    fails = sum(t["verdict"] == "fail" for t in valid)
    by_case = defaultdict(list)
    for t in valid:
        by_case[t["case"]].append(t["verdict"] == "fail")

    def fail_at(k):
        rates = [1 - comb(len(c) - sum(c), k) / comb(len(c), k) for c in by_case.values() if len(c) >= k]
        return f"{100 * sum(rates) / len(rates):.1f}%" if rates else ""

    table.append([
        config, relation, str(len(by_case)), str(len(valid)), str(fails),
        str(sum(t["verdict"] == "no-effect" for t in valid)), str(len(trials) - len(valid)),
        f"{100 * fails / len(valid):.1f}%" if valid else "", *[fail_at(k) for k in K],
    ])

with open(ROOT / "results" / "summary.csv", "w", newline="", encoding="utf-8-sig") as f:
    csv.writer(f).writerows(table)
widths = [max(len(row[i]) for row in table) for i in range(len(table[0]))]
for row in table:
    print("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))
