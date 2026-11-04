# z_extra/: support material

Nothing here is needed to run the experiment. The experiment is `harness/` (see the README).

- `validation/`: the check that `harness/relations.py` gives the verdicts the earlier harness gave, on the cases that
  harness ran. `pilot-cases/` is that 100-case pilot set in the new TOML format (from `cases/pilot.jsonl`); `cases/`
  now holds the rule-based set instead. `old-verdicts.ts` judges about 100,000 made-up outcomes on the pilot cases
  with the old `check()` (run it against a checkout of commit `5d3d6ba`); `same-verdicts.py` judges the same
  outcomes, and every recorded trial in `results/`, with the relations of commit `a4827c5` (run it against a
  checkout of that commit; the harness has been simplified since). On 2026-11-02: 0 of 100,000 and 0 of
  12,200 differ (an old pass is a new pass or ◌).
- `prompt-v1/`: the first prompt, which did not say what null does, with its configurations and results.
- `prompt-v2-diff/`: the second prompt, which asked for changes only, with its results.

The rest is the earlier, larger version of the harness, kept for reference:

- `results/`: the recorded runs the paper's tables come from (`results/README.md`), with every turn
- `cases/`: the pilot set as the earlier harness stored it (`pilot.jsonl`), its manifest and the rejected candidates
- `experiments/`: the earlier experiment files (cases, N, seed, configurations)
- `scripts/`: the sweep, the report, the LLM judge, the RQ1 oracle table, the case generator
- `shared/`: the earlier relations, case checks, generator and report code
- `src/`: the Experiments page and case inspector of the app, and the browser sweep engine
- `judge/`: the LLM judge's prompt
- `docs/`: the design notes and how the earlier generator made the pilot set
- `HANDOFF.md`, `old-README.md`: the earlier plan to simplify this repo, and the earlier README

This code is TypeScript, not maintained, and its paths still point to the old layout; to run it, check out commit
`5d3d6ba`.
