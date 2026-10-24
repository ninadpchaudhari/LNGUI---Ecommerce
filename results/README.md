# Recorded runs

Sweep outputs that are kept and reported. `runs/` is gitignored scratch space; a run is copied here
once it is worth keeping, unchanged (`manifest.json`, `trials.jsonl`, `turns.jsonl`). Every table
below can be regenerated from these files with no `.env`, no API key and no server.

| Run | Experiment file | Model / mediator | Cases × conditions × N | Date | Git commit | Purpose |
|---|---|---|---|---|---|---|
| `pilot-local-smoke-2026-10-24T19-32-03-735Z` | `experiments/pilot-local-smoke.json` | none: `LOCAL_TEST_MODE` rule-based parser, no model call | 100 × 1 × 2 = 200 trials, 558 turns | 2026-10-24 | `0ffabfd` (clean) | **Harness check, not a result.** Shows that the sweep, the records and the checker work end to end. 0 failures, 0 infra; there are no violations to look at. |
| *pending* | `experiments/paper0-gpt-4o-mini-4cond-n10.json` | `openai/gpt-4o-mini` via OpenRouter; default and minimal prompts × default temperature and T=0 | 100 × 4 × 10 | — | — | The Paper 0 runs. **Not yet run; Ninad runs them** (they cost money and need a key). Copy the run directory here when done and add a row. |

Cases for all runs: `cases/pilot.jsonl` (sha256 `a3c32eae2d7edeaf753290944f231f5488d0d4e52fc09706c7ca43aab1331d67`).

## Reading a run

    npm run report -- results/<run>                  # one row per condition × relation (Markdown)
    npm run report -- results/<run> --by case        # one row per condition × case
    npm run report -- results/<run> --format latex   # or csv

`report` reads only `trials.jsonl` and `manifest.json`. It needs no `.env`, key, server or Docker.

## Regenerating a run

    npm run sweep -- experiments/pilot-local-smoke.json          # local parser, free, ~1 s
    npm run sweep -- experiments/paper0-gpt-4o-mini-4cond-n10.json  # needs OPENROUTER_API_KEY; costs money

A sweep writes `runs/<name>-<timestamp>/`; copy that directory here. A re-run gets new turn ids,
timestamps and latencies, so the files are not byte-identical, but the trial verdicts of the local
parser are deterministic.

## Surface description

`npm run export:surface -- <out.json>` writes `surface.json` (the control surface as JSON, for
`lngui-explorer`) from `shared/surface.generated.ts`; its `sha256` is that of `control-surface.yaml`.
