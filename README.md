# The E-commerce Catalog for MORPH-UI

A product catalog whose filters and sort are set by typing in an "ask" bar. The mediator (a model behind
`POST /api/command`) turns each sentence into a filter command, and the app applies it. Live: https://lngui-ecommerce.ninadpchaudhari.workers.dev/

**How the harness works with the app:** for every case, it resets the app, sends the source sentences to it one by one
in one conversation, and reads back every control's value. It resets again, does the same
with the follow-up sentences, and checks the relation between the two outcomes.

## The files

**What the experiment is made of** (flat files you edit)

| File | What it is |
|---|---|
| `shop.toml` | The model: the shop's controls (filters and sort), their values, and each one's start value |
| `lexicon.toml` | What the tester writes by hand: each control's base sentence and its target, rewording, undo sentence and narrowing phrase |
| `design/<relation>.toml` | Made by `make_design.py` from the lexicon: every case, each sentence with its target. The answer key; no oracle reads it |
| `cases/<relation>.toml` | Made by `blind.py` from the design: the test cases, the same sentences with only the controls each one changes |

**The scripts** (plain Python; only `summary.py` needs a package, pandas)

| File | What it does |
|---|---|
| `run_study.sh` | Runs a whole study unattended: every configuration at once, then its summary |
| `serve.sh` | Starts the app's server for one configuration of a study |
| `run.py` | Runs every case N times on one configuration of a study; `--check` checks the cases and their coverage |
| `summary.py` | Writes a study's `summary.csv` and the paper's table, `table.csv` (pandas) |
| `combine.py` | Combines every study into `studies/all-trials.csv` and `studies/all-table.csv` (pandas) |
| `harness/relations.py` | The six relations: is a case valid, and the verdict on one trial. **Start here** |
| `harness/shop.py` | Talks to the running app: `reset()`, `say(sentence)` |

**The studies** (`studies/<study>/`: everything one study used and produced, and nothing is written outside it)

| File | What it holds |
|---|---|
| `configs/<config>.env` | One configuration under test: its port, the model, and the model's settings |
| `prompt.txt` | The study's system prompt, if not `app/prompts/default.txt` (same format) |
| `results/<config>.csv` | One row per trial: verdict, reason, and what each side changed |
| `summary.csv` | Fail rate, fail@2, fail@5 per configuration and relation |
| `table.csv` | The paper's table: each relation's fail rate per configuration, and All 5 |
| `logs/` | Each server's log and turn records (not committed) |

- `studies/icst-2027/`: the ICST 2027 paper's study, with `app/prompts/default.txt`. Done; leave it as it is.
- `studies/A-minimal-prompt/` and `studies/B-student-x-prompt/`: the next two studies, the same 7 models (the 5 above
  plus GPT-6.1 Sol and Claude Opus 5.5) at provider default settings, with `app/prompts/default.txt` and
  `app/prompts/student-x.txt`. The plan and checklist are in `studies/PLAN.md`.

A new study is a new folder with a `configs/` (and a `prompt.txt` if its prompt differs).

**The app** (`app/`, the system under test: a Node project of its own, with its build files)

| Folder | What it is |
|---|---|
| `app/src/` | The page: chat, filters, products, and a trace of every turn (React) |
| `app/api/` | The server: `command.ts` is the mediator; `session.ts` keeps one conversation for the harness |
| `app/shared/` | What both use: the app's filter logic (`transition.ts`), the catalog, the command format |
| `app/prompts/default.txt` | The system prompt every configuration uses |
| `app/control-surface.yaml` | The controls the app is built from; `shop.toml` describes the same controls |

`z_extra/` holds support material: the earlier TypeScript harness and its runs, and the two earlier prompts.

## Steps to reproduce

Needs Node 22 (`app/.nvmrc`), Python ≥ 3.11, and an OpenRouter key for the model configurations.

```bash
# 1. Put your OpenRouter key in app/.env (it holds only keys), and install the app
cp app/.env.example app/.env
(cd app && nvm use && npm ci)

# 2. Check the cases: every precondition, and every relation covers every control it admits
python3 run.py --check

# 3. Start one configuration's server (log in studies/A-minimal-prompt/logs/)
./serve.sh studies/A-minimal-prompt gpt-6.1-sol-default

# 4. Run every case 10 times on it → studies/A-minimal-prompt/results/gpt-6.1-sol-default.csv
python3 run.py studies/A-minimal-prompt gpt-6.1-sol-default

# 5. Over every configuration: the study's summary.csv and table.csv (needs pandas)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python summary.py studies/A-minimal-prompt
```

Each configuration has its own port, so several can run at once. Stop a server with `kill $(lsof -ti tcp:<PORT>)`.
`python3 run.py studies/<study> local 2` runs the whole pipeline for free, with the app's rule-based parser
instead of a model. `cd app && npm run dev` serves the app at http://localhost:5173 to try sentences by hand, and
`cd app && npm test` runs its unit tests.

## Experiments

A configuration is named `<model>-<prompt>-<settings>`, plus `local`:

- **local**: the app's rule-based parser, no model. It parses each sentence alone and ignores the history; it checks
  that the harness works, and is not a result.
- **gpt-4o-mini-default-t1-p1**: GPT-4o mini, temperature 1, top_p 1.
- **gpt-5-nano-default-rminimal**: GPT-5 nano, reasoning minimal (its sampling cannot be set).
- **claude-haiku-5.5-default-rnone**: Claude Haiku 5.5, reasoning off.
- **gpt-6-luna-default-rnone**: GPT-6 Luna, reasoning off (its sampling cannot be set).
- **qwen3.5-9b-default-t1-p0.95-rnone** and **qwen3.5-9b-default-t0-rnone**: Qwen3.5 9B, thinking off, at
  temperature 1 / top_p 0.95 and at temperature 0.

All of them use OpenRouter, the full conversation history, `app/prompts/default.txt`, and JSON mode
(`LLM_JSON_MODE=true`: the model must answer with a JSON object). Llama 3.2 3B was dropped: no provider on
OpenRouter offers JSON mode for it. A setting a configuration
file leaves out is unset, and the provider's default applies. A new configuration is a copy of a file with a new name
and `PORT`.

**The prompt** gives the reply's format, asks for every filter in every reply, and says what null means: no filter.
Two earlier prompts are in `z_extra/`: `prompt-v1/` did not say what null means, and `prompt-v2-diff/` asked for
changes only. Another prompt is tried by putting it in a study's `prompt.txt`; `serve.sh` passes it to the server
as `SYSTEM_PROMPT`, and its `implementation:` header as `LNGUI_COMMAND_MODE`.

## The cases

Each control in `shop.toml` is one test requirement, and every relation must cover every control it admits (MR_REV
admits only reversible controls, MR_AC only constraining ones). For each control we picked one value other than its start
value and wrote its sentences by hand, in `lexicon.toml`. Each relation then combines them by one rule:
`python3 make_design.py` writes `design/`, and `python3 blind.py` writes `cases/` from it:

| Relation | Rule | Cases |
|---|---|---|
| MR_CE | each control's sentence vs its rewording, and vs 4 edits of it: uppercase, "could you please …", "…, thanks", "hey, …" | 25 |
| MR_CA | every pair of controls: a, b vs b, a | 10 |
| MR_COMP | each sentence said twice vs once; every pair: a, b vs "a and b" | 15 |
| MR_REV | each control's sentence, then its undo, vs nothing said | 5 |
| MR_AC | each constraining control's sentence vs the same plus another constraining control's phrase | 12 |
| CONTEXT_AMNESIA | each control's sentence, then the next three controls' sentences: what the first set must stay | 5 |

A case looks like this:

```toml
relation = "MR_AC"

[[case]]
id = "MR_AC-001"
source = "show electronics items"                         # one sentence, or a list
followup = "show electronics items under $100"
refine = {control = "maxPrice", value = 100}              # MR_AC only: the control the constraint sets, and its value

[case.writes]                                             # every sentence → the controls it should change
"show electronics items" = ["category"]
"show electronics items under $100" = ["category", "maxPrice"]
```

## Reading the results

A study's `results/<config>.csv` has one row per trial: the verdict, the reason, and what each side changed from the reset
(`category="electronics" maxPrice=100`), so a failure can be read without rerunning it. The verdicts:

| Verdict | Means |
|---|---|
| pass | the relation held |
| fail | the relation did not hold, or the model's answer was not a command the app could apply |
| no-effect | the relation held, but only because the command it is about changed nothing, so it proves nothing. For example, MR_REV-001 says "show electronics items", then "show all categories": if the first is ignored, the shop is still as the reset left it and the check holds, but nothing was reversed |
| infra | the plumbing failed (the server, or the model provider answering with an error), not the shop. Left out of every rate |

A study's `summary.csv` (from `summary.py`) has one row per configuration and relation: fail_rate
(failed trials / trials), fail@k (the chance that at least one of k runs of a case fails, averaged over the
relation's cases), and how many trials had no effect.
