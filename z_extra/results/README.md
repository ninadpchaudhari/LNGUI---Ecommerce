# Recorded runs

Sweep outputs that are kept and reported, copied here unchanged from `runs/`. Every table can be
regenerated from these files with no `.env`, no API key and no server:

    npm run report  -- results/<run> --format latex     # or md, csv; --by case for one row per case
    npm run oracles -- results/<run> --format latex     # RQ1

Cases for all runs: `cases/pilot.jsonl` (sha256 `a3c32eae2d7edeaf753290944f231f5488d0d4e52fc09706c7ca43aab1331d67`), 100 cases.

| Run | Experiment file | Configurations | Trials (N) | Failed | Date | Git commit | Purpose |
|---|---|---|---|---|---|---|---|
| `paper0-combined` | the two runs below | all 6 below | 6,000 (10) | 2,121 | 2026-10-25 | – | **The paper's table.** See below. |
| `small-models-default-5cfg-n10-2026-10-25T02-58-33-404Z` | `experiments/small-models-default-5cfg-n10.json` | GPT-5 nano (reasoning minimal), Claude Haiku 5.5 (reasoning none), Llama 3.2 3B (T 0.6, top_p 0.9), Qwen3.5 9B (reasoning none) at T 1 / top_p 0.95 and at T 0; all on OpenRouter, prompt `default.txt` | 5,000 (10) | 1,789 | 2026-10-25 | `f3bcc98` (dirty) | Small models under the default prompt |
| `gpt-4o-mini-default-1cfg-n10-2026-10-25T03-27-50-930Z` | `experiments/gpt-4o-mini-default-1cfg-n10.json` | GPT-4o mini (T 1, top_p 1), OpenRouter, prompt `default.txt` | 1,000 (10) | 332 | 2026-10-25 | `f3c5b26` (clean) | GPT-4o mini under the same prompt and cases |
| `pilot-local-smoke-2026-10-24T19-32-03-735Z` | `experiments/pilot-local-smoke.json` | the rule-based parser (`LOCAL_TEST_MODE`), no model | 200 (2) | 0 | 2026-10-24 | `0ffabfd` (clean) | **Harness check, not a result.** The sweep, records and checker work end to end; there are no violations to look at. |

No run had an infrastructure failure.

## Notes

- **`paper0-combined`** is the two OpenRouter runs joined: its `trials.jsonl` and `turns.jsonl` are
  the small-models files followed by the gpt-4o-mini files, byte for byte (checked 2026-10-25). It
  has no `manifest.json` (each part's manifest is in its own folder), so `report` prints no header
  for it and lngui-explorer opens the two parts, not this folder. The two parts share cases, N and
  seed, but each was shuffled on its own.
- **Qwen3.5 9B sampling.** Both Qwen configurations ran with thinking off (`reasoning: none`; about
  65 completion tokens per reply). The T 1 / top_p 0.95 configuration used the model card's
  *thinking-mode* values; for thinking off the card recommends T 0.7 / top_p 0.8. The T 0
  configuration sent no top_p, so the provider's default applied.
- **Smoke run.** `experiments/pilot-local-smoke.json` was edited after the run: its configuration's
  prompt file name changed (`default.txt` → `student-x.txt`, the same sha256). The local parser
  ignores the prompt.
- Each OpenRouter run has `surface.json` (from `npm run export:surface`) for lngui-explorer.

## Regenerating a run

    npm run sweep -- experiments/pilot-local-smoke.json                  # free, about a second
    npm run sweep -- experiments/small-models-default-5cfg-n10.json      # needs OPEN_ROUTER_API_KEY; costs money
    npm run sweep -- experiments/gpt-4o-mini-default-1cfg-n10.json

A sweep writes `runs/<experiment name>/`; copy it here under a name with the date. A re-run gets new
turn ids, timestamps and latencies, and new model replies; only the local parser's verdicts are
deterministic.
