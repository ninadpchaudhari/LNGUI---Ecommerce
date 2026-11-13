# Next ecommerce studies: plan and checklist

## The design

Two studies with the same 7 models at **provider default settings**: no temperature, top_p or reasoning effort is
sent, so thinking is on wherever that is the model's default. Only the prompt differs.

| Study folder | Prompt (`prompt.txt`) | Ports |
|---|---|---|
| `A-minimal-prompt/` | `app/prompts/default.txt` (the one icst-2027 used) | 3301–3307 |
| `B-student-x-prompt/` | `app/prompts/student-x.txt` | 3401–3407 |

Models, one config each (`<model>-default.env`): gpt-4o-mini, gpt-5-nano, gpt-6-luna, claude-haiku-5.5,
qwen3.5-9b, **gpt-6.1-sol** (`openai/gpt-6.1-sol`), **claude-opus-5.5** (`anthropic/claude-opus-5.5`).
Each study also has `local.env` (port 3300 / 3400), a free check that is not a result.

`icst-2027/` stays as it is: the paper's numbers (reasoning off, fixed sampling). It is not rerun.
**A vs B** is the prompt's effect; **A vs icst-2027** is the settings' effect for the 5 models in both.

## Checklist

Setup
- [x] Studies A and B made, each with `prompt.txt` and 8 configs
- [x] `python run.py --check`
- [x] Free smoke test of both (`local`, 1 trial per case): 72 trials each, end to end
- [x] One paid trial per case on Opus 5.5 and GPT-6.1 Sol in both studies: all parse, no infra
      (A: 72/72 pass for both; B: 15 fails each, mostly MR_CA and CONTEXT_AMNESIA)
- [x] Prompt check via `/api/config`: A's hash is `fnv1a32:b22ccb6a` (same as icst-2027), B's is `fnv1a32:5a348657`;
      no temperature or reasoning effort is sent

Run each study overnight, one terminal each (all 7 configs at once; about 2 hours; rerun to redo anything missing):

    caffeinate -i ./run_study.sh studies/A-minimal-prompt
    caffeinate -i ./run_study.sh studies/B-student-x-prompt

- [x] All 14 runs done (2026-11-12), 720 trials each
- [x] Infra rows: only 1, in A qwen3.5-9b (MR_CA-007, a timeout), left out of the rates; not rerun

Summarize and combine
- [x] Each study's `summary.csv` and `table.csv` (`run_study.sh` writes them at the end)
- [x] Write `combine.py`: reads every `studies/*/results/*.csv`, adds a `study` column, writes
      `studies/all-trials.csv` and `studies/all-table.csv` (one row per study × config, the paper's columns)
- [x] Table and takeaways in the dissertation (Chapter 6, RQ4, `tab:shop-prompts`)
- [x] Copied to `../archive-2026-11/` for archival
- [ ] Point the datasette build (`lngui-homeassistant/study/datasette/build.sh`) at `studies/all-trials.csv`,
      so one `results.db` holds HA and every shop study
