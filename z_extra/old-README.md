# E-commerce LNGUI case study

A product catalog whose filters and sort are set by typing in an "ask" bar. Every turn is recorded, and
metamorphic relations between pairs of runs are checked. Live: https://lngui-ecommerce.ninadpchaudhari.workers.dev/
Background, relations and record formats: [`docs/design.md`](docs/design.md), `../HANDOFF.md`, `../docs/`.

## Steps to reproduce

Needs Node 22 (`.nvmrc`). The paper's tables come from committed runs in `results/`, with no key or server:

```bash
nvm use
npm ci
npm run report  -- results/paper0-combined --format latex   # failures per configuration × relation
npm run oracles -- results/paper0-combined --format latex   # RQ1: MR checker vs implicit oracle (vs judge)
```

To record the runs again (calls OpenRouter; costs money):

```bash
cp .env.example .env                                                  # add OPEN_ROUTER_API_KEY
npm run sweep -- experiments/small-models-default-5cfg-n10.json --dry-run   # the plan, no calls
npm run sweep -- experiments/small-models-default-5cfg-n10.json             # → runs/small-models-default-5cfg-n10/
npm run sweep -- experiments/gpt-4o-mini-default-1cfg-n10.json              # → runs/gpt-4o-mini-default-1cfg-n10/
npm run report -- runs/small-models-default-5cfg-n10 --format latex
```

## What `npm run sweep` does

```
1. read the experiment file          experiments/<name>.json: cases, N, seed, configurations
2. check the cases file              its SHA-256 must equal the file's casesSha256
3. check each prompt file            its SHA-256 must equal the configuration's prompt.sha256
4. resolve each configuration's P    model, temperature, top_p, reasoning, history, as the server sees them
5. print the plan                    --dry-run stops here
6. write runs/<name>/manifest.json   the folder is emptied first: a re-run replaces it
7. run every case N times            in seeded rounds; infra failures retried, then recorded as infra
8. record when it finished           trials.jsonl and turns.jsonl are complete
```

The Experiments page (`npm run dev`, then `#experiments`) runs the same engine in the browser.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | the app at http://localhost:5173 (chat, filters, Experiments page); API on :3001 |
| `npm run sweep -- <experiment.json>` | run an experiment → `runs/<name>/` |
| `npm run report -- <run> [--format md\|latex\|csv] [--by case]` | the results table |
| `npm run judge -- <run> [--dry-run \| --yes]` | LLM judge over a recorded run → `<run>/judge.jsonl` (costs money) |
| `npm run oracles -- <run>` | the RQ1 table |
| `npm run gen:cases` | regenerate `cases/pilot.jsonl` (+ manifest, rejected log) |
| `npm run gen:surface` | `control-surface.yaml` → `shared/surface.generated.ts` |
| `npm run export:surface -- <run>/surface.json` | the surface description lngui-explorer needs next to a run |
| `npm test` | unit tests |
| `npm run deploy` | build and deploy to Cloudflare |

## How to

- **Free check of the whole pipeline:** `npm run sweep -- experiments/pilot-local-smoke.json` (rule-based parser, no model).
- **Make an experiment:** build it on the Experiments page and copy its JSON into `experiments/`, or copy an existing file. N, seed and the cases file are in the file.
- **Add a model:** add it to `shared/models.ts` with its sampling, reasoning efforts and a link to where they come from.
- **Change the cases:** edit `control-surface.yaml` or `shared/generate.ts`, run `npm run gen:surface` and `npm run gen:cases`, then put the printed sha256 in each experiment's `casesSha256`.
- **Keep a run:** copy `runs/<name>/` into `results/`, run `npm run export:surface -- results/<name>/surface.json`, add a line to `results/README.md`.
- **Judge a run:** `npm run judge -- results/<run> --dry-run` shows the turns and the price; `--yes` runs it.
- **Use Ollama:** start the Ollama app; configurations with `LLM_PROVIDER: ollama` reach it at `OLLAMA_BASE_URL`.
- **Trace calls in Langfuse:** set the Langfuse keys in `.env`; sweeps trace only with `--langfuse`.
- **Deploy:** `npx wrangler login`, `npx wrangler d1 create lngui-turns` (put the id in `wrangler.jsonc`), `npm run d1:migrate`, `npx wrangler secret put OPEN_ROUTER_API_KEY` (and the Langfuse keys), `npm run deploy`. Try it in the Workers runtime first with `npm run dev:cf` (reads `.dev.vars`).
