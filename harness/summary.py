"""
From every results/<config>.csv, writes:

    results/summary.csv   per configuration and relation: cases, trials, fails, no_effect, infra, fail_rate, fail@2, fail@5
    results/table.csv     the paper's table: the fail rate of each fault model per configuration, and All (local left out)

Rates are percentages, with infra trials left out. fail@k is the chance that at least one of k trials of a case
fails, 1 − C(N−f, k) / C(N, k) for a case with f fails in N trials, averaged over the relation's cases.

    python3 harness/summary.py
"""

from math import comb, nan
from pathlib import Path

import pandas as pd

RESULTS = Path(__file__).parent.parent / "results"
OUTPUTS = {"summary.csv", "table.csv"}
# The paper's table: one column per fault model, from the relation whose cases expose it (the relations table's
# "Fault exposed"). Context amnesia is MR_CA's fault over more turns, from the CONTEXT_AMNESIA cases.
FAULTS = {
    "MR_CE": "CE",              # phrasing sensitivity
    "MR_AC": "AC",              # constraint leakage
    "MR_CA": "CA",              # order sensitivity
    "CONTEXT_AMNESIA": "Amnesia",  # context amnesia: MR_CA's fault over more turns
    "MR_REV": "REV",            # irreversibility
    "MR_COMP": "COMP",          # phrasing sensitivity across turns
}
K = [2, 5]

trials = pd.concat([pd.read_csv(f, encoding="utf-8-sig") for f in sorted(RESULTS.glob("*.csv")) if f.name not in OUTPUTS],
                   ignore_index=True)
infra = trials[trials.verdict == "infra"].groupby(["config", "relation"]).size()
trials = trials[trials.verdict != "infra"].assign(failed=lambda t: t.verdict == "fail", no_effect=lambda t: t.verdict == "no-effect")

# summary.csv
cases = trials.groupby(["config", "relation", "case"]).failed.agg(n="size", f="sum").reset_index()
for k in K:
    cases[f"fail@{k}"] = [1 - comb(n - f, k) / comb(n, k) if n >= k else nan for n, f in zip(cases.n, cases.f)]

summary = trials.groupby(["config", "relation"]).agg(cases=("case", "nunique"), trials=("failed", "size"),
                                                     fails=("failed", "sum"), no_effect=("no_effect", "sum"))
summary["infra"] = infra.reindex(summary.index, fill_value=0)
summary["fail_rate"] = 100 * summary.fails / summary.trials
for k in K:
    summary[f"fail@{k}"] = 100 * cases.groupby(["config", "relation"])[f"fail@{k}"].mean()
summary.round(1).to_csv(RESULTS / "summary.csv", encoding="utf-8-sig")

# table.csv
paper = trials[(trials.config != "local") & trials.relation.isin(FAULTS)]
fails = paper.pivot_table(index="config", columns="relation", values="failed", aggfunc=["sum", "count"])
table = 100 * fails["sum"][list(FAULTS)] / fails["count"][list(FAULTS)]  # fails / trials, as in summary.csv
table["All"] = 100 * fails["sum"].sum(axis=1) / fails["count"].sum(axis=1)
table = table.rename(columns=FAULTS)
table.round(1).to_csv(RESULTS / "table.csv", encoding="utf-8-sig")
