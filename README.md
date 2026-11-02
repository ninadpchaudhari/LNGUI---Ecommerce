# The E-commerce Catalog for MORPH-UI

A product catalog whose filters and sort are set by typing in an "ask" bar. The mediator (a model behind
`POST /api/command`) turns each sentence into a filter command, and the app applies it. Live: https://lngui-ecommerce.ninadpchaudhari.workers.dev/

**How the harness works with the app:** for every case, it resets the app to σ0, sends the source sentences to it one
by one in one conversation, reads back every control's value and the products shown (O(σ′) = ⟨V′, D′⟩), resets
again, sends the follow-up sentences (O(σ″)), and checks the relation between the two.

## The files

**What the experiment is made of** (flat files you edit)

| File | What it is |
|---|---|
| `cases/<relation>.toml` | The test cases: two sides of sentences, and the controls each sentence should change |
| `shop.toml` | The shop's controls (filters and sort), their values, and each one's start value (σ0) |
| `configs/<config>.env` | One configuration under test. The model's settings (`LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_TOP_P`, `LLM_REASONING_EFFORT`, ...) are environment variables here |
| `helpful_utility_to_generate_cases/` | Generates `cases/` from templates to help automate the creation of test cases |

**The harness** (`harness/`, code to talk to the app and to run the experiment)

| File | What it does |
|---|---|
| `relations.py` | The six relations, as the rows of Table 4.1: is a case valid, and the verdict on O(σ′) and O(σ″). **Start here** |
| `run.py` | Algorithm 1: every case N times on one configuration |
| `shop.py` | Talks to the app: `reset()`, `say(sentence)`, `read()` |
| `setup.py` | Starts the app's server with one configuration's settings |
| `summary.py` | The fail-rate table across all configurations |

**What it produces**

| File | What it holds |
|---|---|
| `results/<config>.toml` | One line per case: ● ○ ◌ ! for each trial, and why the first failure failed |
| `results/<config>.csv` | One row per trial: verdict, reason, and what each side changed |
| `results/summary.csv` | Fail rate, fail@2, fail@5 per configuration and relation |

**The app** (`app/`, the system under test: a Node project of its own, with its build files)

| Folder | What it is |
|---|---|
| `app/src/` | The page: chat, filters, products, and a trace of every turn (React) |
| `app/api/` | The server: `command.ts` is the mediator; `session.ts` keeps one conversation for the harness |
| `app/shared/` | What both use: the app's filter logic (`transition.ts`), the catalog, the command format |
| `app/prompts/` | The system prompts. `default.txt` is the one every configuration uses |
| `app/control-surface.yaml` | The controls the app is built from (`npm run gen:surface`); `shop.toml` must match it |

**Support** (not needed to run or understand the experiment)

| Folder | What it is |
|---|---|
| `z_extra/` | The earlier TypeScript harness (sweep, report, LLM judge, Experiments page), its recorded runs, and the check that the new relations give its verdicts |

## Steps to reproduce

Needs Node 22 (`app/.nvmrc`), Python ≥ 3.11, and an OpenRouter key for the model configurations.
The steps are as such:

1. Prepare your environment: put your OpenRouter key in `app/.env`.
2. Install dependencies.
3. Ensure `shop.toml` is correct for the app (`setup.py` checks it against the running app).
4. `setup.py`: start the app's server with one configuration's settings, in the background, on that configuration's
   port. It checks the server is the shop in `shop.toml` and prints the model settings the server resolved.
5. `run.py`: run every case 10 times on that configuration → `results/<config>.toml` and `results/<config>.csv`.
6. `summary.py`: the table over every configuration → `results/summary.csv`.

```bash
# 1. Prepare your environment (only OPEN_ROUTER_API_KEY is needed)
cp app/.env.example app/.env

# 2. Install dependencies
(cd app && nvm use && npm ci)
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# 3. Check the cases against shop.toml
python harness/run.py --check

# 4. Start a configuration's app (prints its pid; stop it with kill <pid>)
python harness/setup.py gpt-4o-mini-default-t1-p1

# 5. Run every case 10 times on it
python harness/run.py gpt-4o-mini-default-t1-p1

# 6. The table over every configuration
python harness/summary.py
```

**Configurations run in parallel.** Each has its own port, so start several and run each in its own terminal.

Other commands:

| Command | Does |
|---|---|
| `python harness/run.py <config> --n 1` | every case once instead of 10 times (to run only some cases, move the others out of `cases/`) |
| `python harness/run.py --check` | basic check of every case (controls exist, write sets, preconditions) without the app |
| `python harness/setup.py local`, then `python harness/run.py local --n 2` | the whole pipeline for free: the app's rule-based parser instead of a model |
| `cd app && npm run dev` | the app itself at http://localhost:5173, to try sentences by hand |
| `cd app && npm test` / `npm run deploy` | the app's unit tests / build and deploy it to Cloudflare |

## Experiments

A configuration is named `<model>-<prompt>-<settings>`, plus `local`:

- **local**: the app's rule-based parser, no model. It parses each sentence alone and ignores the history; it checks
  that the harness works, and is not a result.
- **gpt-4o-mini-default-t1-p1**: GPT-4o mini, temperature 1, top_p 1.
- **gpt-5-nano-default-rminimal**: GPT-5 nano, reasoning minimal (its sampling cannot be set).
- **claude-haiku-5.5-default-rnone**: Claude Haiku 5.5, reasoning off.
- **llama-3.2-3b-instruct-default-t0.6-p0.9**: Llama 3.2 3B, temperature 0.6, top_p 0.9 (Meta's defaults).
- **gpt-4o-mini-explained-t1-p1**: as gpt-4o-mini-default-t1-p1, with `app/prompts/explained.txt` (see below).
- **qwen3.5-9b-default-t1-p0.95-rnone** and **qwen3.5-9b-default-t0-rnone**: Qwen3.5 9B, thinking off, at
  temperature 1 / top_p 0.95 and at temperature 0.

All of them use OpenRouter and the full conversation history, and all but the explained one use
`app/prompts/default.txt` (the server's default). A
setting a configuration file leaves out is unset (the provider's default applies); `app/.env` never fills it in.
To change a configuration, edit its file, stop its server, and run `python harness/setup.py <config>` again.
A new configuration is a copy of a file with a new `PORT` and a new name.

### Trying another prompt

The default prompt (`app/prompts/default.txt`) lists every field as "<value> or null" and never says what null does.
In the app, null resets a filter, and a field left out keeps its value. GPT-4o mini fills in every field and sends
null for the ones a sentence does not mention, so every turn wipes what the earlier turns set. That is why MR_CA and
CONTEXT_AMNESIA fail on every case, and most of MR_COMP. `app/prompts/explained.txt` is the same prompt, plus two
lines that say what a left-out field and null do (and its header asks for changes only: `implementation: diff`).

To run the cases with it, by hand:

1. Copy the configuration, give it a new name (the prompt's name in the middle) and a new `PORT`, and add one line:
   `PROMPT=explained.txt`. `configs/gpt-4o-mini-explained-t1-p1.env` is this, for GPT-4o mini.
2. Start it and run it as any configuration. Its results go to their own file, so the default prompt's stay.

```bash
python harness/setup.py gpt-4o-mini-explained-t1-p1     # prints the prompt's hash, and "(diff)"
python harness/run.py gpt-4o-mini-explained-t1-p1
python harness/summary.py
```

Configurations for the other models are in `configs/` too (`<model>-explained-…`). Over all of them (93 cases × 10,
failures out of 930; "state" = the filters ended up wrong, "rejected" = the app refused the reply):

| Model | Default prompt: fails (state / rejected) | Explained prompt: fails (state / rejected) |
|---|---|---|
| Claude Haiku 5.5 | 114 (114 / 0) | 44 (30 / 14) |
| GPT-4o mini | 297 (289 / 8) | 211 (10 / 201) |
| GPT-5 nano | 394 (394 / 0) | 175 (15 / 160) |
| Qwen3.5 9B, t=0 | 178 (178 / 0) | 97 (30 / 67) |
| Qwen3.5 9B, t=1 | 193 (157 / 36) | 132 (30 / 102) |
| Llama 3.2 3B | 868 (13 / 855) | 855 (27 / 828) |

The wiping is not one model's quirk: with the default prompt every model but Llama loses earlier filters, and MR_CA
and CONTEXT_AMNESIA fail on most trials. The explained prompt cuts those, but the failure moves: most of what still
fails is rejected on "sort by rating" said after earlier turns (in the replies we looked at, the model leaves out
`"filters"`, though the prompt says to always include it). Qwen also stops undoing: on "show all categories", "remove
the price limit" and "remove the rating filter" it leaves the field out instead of sending null, so MR_REV goes from
0 to 30/50. Llama 3.2 3B mostly does not answer in JSON with either prompt, so it says nothing about the contract.

`PROMPT=<file>` takes any file in `app/prompts/` that starts with the header (`---`, `implementation: diff` or
`full`, `---`); the header is never sent to the model.

### Writing a case

```toml
relation = "MR_AC"

[[case]]
id = "MR_AC-001"
source = "filter to electronics only"                         # one sentence, or a list
followup = "filter to electronics only that are in stock"
refine = {control = "inStockOnly", value = true}              # MR_AC only: the control δ sets, and its value

[case.writes]                                                 # every sentence → the controls it should change
"filter to electronics only" = ["category"]
"filter to electronics only that are in stock" = ["category", "inStockOnly"]
```

A control is a name from `shop.toml`, e.g. `category`. Before a run, every case is checked against its relation's
precondition (for example, MR_CE needs W(u1) = W(u2)); a run does not start while any case has a problem.

The 93 cases in `cases/` come from `helpful_utility_to_generate_cases/`, by stated rules: one value per control
(electronics, $100, 4 stars, in stock, sort by rating), the app's templates filled with it, and one rule per relation
(MR_CE 32, MR_COMP 29, MR_AC 12, MR_CA 10, MR_REV 5, CONTEXT_AMNESIA 5). Its README has the rules. The paper's earlier
runs (`z_extra/results/`) used a different set, the 100-case pilot (`z_extra/validation/pilot-cases/`).

### Reading the results

`results/<config>.toml` has one line per case:

```toml
["gpt-4o-mini-default-t1-p1"]
"CONTEXT_AMNESIA-003" = { trials = "○", fails = 1, first = "lost what u1 set: minRating" }
"MR_CA-001"           = { trials = "○", fails = 1, first = "V′ ≠ V″ on: category, maxPrice" }
"MR_CE-001"           = { trials = "●", fails = 0 }
```

| Mark | Means |
|---|---|
| ● pass | the relation held |
| ○ fail | the relation did not hold, or the model's answer was not a command the app could apply. `first` says why the first failure failed |
| ◌ passed with no effect | the relation held, but only because nothing happened, so it proves nothing. Counted apart from passes. See below |
| ! infra | the plumbing failed (the server down, the model provider answering with an error: out of credits, rate limit, 5xx), not the system under test. Such a trial is retried twice, then recorded as `!`, and it is left out of every rate |

**Why "passed with no effect" is not a pass.** It is a sanity check: a relation can hold simply because the app did
nothing, and then nothing was tested.

- **MR_CE-001** compares "show electronics items" with "filter to electronics only". If the mediator ignores both, the
  filters are unchanged both times, so O(σ′) = σ0 = O(σ″) and the check passes, without ever choosing electronics.
- **MR_REV-004** says "hide out-of-stock items", then "show out-of-stock items again", and checks the shop is back at
  σ0. If the first sentence is ignored, nothing was hidden, so the shop is still at σ0 and the check holds, but nothing
  was reversed.

Each relation names the command whose effect it needs (`relations.py`); a trial where that command changed nothing is
marked ◌ instead of ●.

`results/<config>.csv` has one row per trial: the verdict, the reason, and what each side changed from σ0
(`category="electronics" maxPrice=100`), so a failure can be read without rerunning it.

`results/summary.csv` (from `python harness/summary.py`) has one row per configuration and relation:

- **fail_rate**: failed trials / trials (infra left out)
- **fail@k**: the chance that at least one of k runs of a case fails, averaged over the relation's cases
- **no_effect**: how many trials passed with no effect
