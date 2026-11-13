"""
Combines every study into two files in studies/:

    all-trials.csv   every trial of every study (local left out), with a study column first
    all-table.csv    the paper's table for every study and configuration: each fault model's fail rate, and All

Rates are percentages with infra trials left out, computed as in summary.py.

    python combine.py
"""

from pathlib import Path

import pandas as pd

STUDIES = Path(__file__).parent / "studies"
FAULTS = {"MR_CE": "CE", "MR_AC": "AC", "MR_CA": "CA", "CONTEXT_AMNESIA": "Amnesia", "MR_REV": "REV", "MR_COMP": "COMP"}

trials = pd.concat([pd.read_csv(f, encoding="utf-8-sig").assign(study=f.parent.parent.name)
                    for f in sorted(STUDIES.glob("*/results/*.csv")) if f.stem != "local"], ignore_index=True)
trials = trials[["study"] + [c for c in trials.columns if c != "study"]]
trials.to_csv(STUDIES / "all-trials.csv", index=False, encoding="utf-8-sig")

paper = trials[(trials.verdict != "infra") & trials.relation.isin(FAULTS)].assign(failed=lambda t: t.verdict == "fail")
fails = paper.pivot_table(index=["study", "config"], columns="relation", values="failed", aggfunc=["sum", "count"])
table = 100 * fails["sum"][list(FAULTS)] / fails["count"][list(FAULTS)]
table["All"] = 100 * fails["sum"].sum(axis=1) / fails["count"].sum(axis=1)
table = table.rename(columns=FAULTS)
table.round(1).to_csv(STUDIES / "all-table.csv", encoding="utf-8-sig")
print(f"{len(trials)} trials from {trials.study.nunique()} studies; studies/all-trials.csv and all-table.csv written")
