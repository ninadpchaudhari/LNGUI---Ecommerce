# Chat-Assisted Ecommerce — LNGUI benchmark

[https://lngui-ecommerce.ninadpchaudhari.workers.dev/](https://lngui-ecommerce.ninadpchaudhari.workers.dev/)

The controlled benchmark for *Metamorphic Testing of Natural-Language-Mediated
Interfaces* (§4.16 and Appendix A of the proposal). A product catalog whose
filter and sort controls are driven by a natural-language "ask" bar, instrumented
so that every transition is observable and every metamorphic relation is runnable.

This is the application that produced Figure 1.2 — the all-caps utterance that
silently set `minRating > 4.0`.

---

## The formal model in the code

Each module implements one part of Chapter 4. Equation numbers in the source
refer to that chapter.

| Module | Implements |
| --- | --- |
| [`control-surface.yaml`](control-surface.yaml) | `Γ_app = ⟨C, Dom, V₀, C_rev, C_con, Templates, Gold_Syn⟩` (§4.10.2) |
| [`shared/surface.generated.ts`](shared/surface.generated.ts) | generated from the YAML; do not edit |
| [`shared/contract.ts`](shared/contract.ts) | `σ = ⟨V,H,P,D⟩`, `O(σ)`, `fp`, `Cov_NL`, `Cov_MR`, the `(N,ε)` rule |
| [`shared/transition.ts`](shared/transition.ts) | `Apply` and `A` (Eq. 4.7), `step` (Eq. 4.9), `ResetApp` |
| [`shared/history.ts`](shared/history.ts) | how `H` becomes the effective context |
| [`src/utils/mediator.ts`](src/utils/mediator.ts) | `M` — the only impure stage |
| [`shared/relations.ts`](shared/relations.ts) | Table 4.1 postconditions (`check`) |
| [`shared/cases.ts`](shared/cases.ts) | the frozen-case schema and each relation's precondition check |
| [`shared/generate.ts`](shared/generate.ts) | template-driven generation `G` and seeded test set selection |
| [`shared/experiment.ts`](shared/experiment.ts) | the experiment-file schema, shared by the page and the CLI |
| [`shared/overrides.ts`](shared/overrides.ts) | per-request P overrides: how a condition reaches the server |
| [`shared/report.ts`](shared/report.ts) | fail@k, report rows, Markdown / LaTeX / CSV tables |
| [`src/utils/relations.ts`](src/utils/relations.ts) | running traces through `M`, and ad-hoc cases from one utterance |
| [`src/utils/sweep.ts`](src/utils/sweep.ts) | **the** sweep engine, used by the Experiments page and `npm run sweep` |
| [`api/prompt.ts`](api/prompt.ts) | `P` — the system prompt and `Q` |

Two boundaries are load-bearing and deliberately explicit:

**`u --M--> q --Apply--> V′ --A--> D′`.** `M` is statistical and lives in `src/`;
`Apply` and `A` are pure and live in `shared/`. That split is what localizes a
violation to the mediator rather than the application (§4.5). The command `q` is
printed verbatim by *Show last command JSON* and by the trace panel.

**`O(σ) = ⟨V, D⟩`.** `H` and `P` are recorded but structurally cannot affect a
verdict, per §A.2. `P` is provenance; it answers *which mediator produced this*,
not *was it correct*.

### Two D comparators

`dataEqual` is **ordered** — `sort` is a control, so a permutation is a real
difference. `dataSubset` is **set containment**, used only by `MR_AC`. Collapsing
them silently breaks `MR_AC`; [`shared/model.test.ts`](shared/model.test.ts) pins
the pair apart.

### `c₆` Clear Filters

`|C| = 6` per Appendix A.1, including the Clear Filters action. Its domain is
`{⊥, "invoked"}` — a **sticky flag**, reset only by `ResetApp`. Sticky rather
than a counter so that clearing twice stays observationally equal to clearing
once; a count would leak `H` into `O`. Being value-bearing is what lets `c₆`
enter a footprint, which §A.7 requires when it speaks of `c₆` being "never
reached by language under this test set".

Because clearing cannot be undone in one utterance, `c₆ ∉ C_rev` and it generates
no `MR_REV` case. `clearFilters` is always part of `Q`: it is one of the
application's finite commands, so the mediator can always reach it, and both
committed prompts describe it.

---

## Relations

| Relation | Precondition | Postcondition | Fault exposed |
| --- | --- | --- | --- |
| `MR_CE` | `Para(u₁,u₂)` | `O(σ′) = O(σ″)` | phrasing sensitivity |
| `MR_AC` | `Refine(u_r,u_b,δ)` | `V_ur = V_ub[d↦w]` ∧ `D_ur ⊆ D_ub` | constraint leakage |
| `MR_CA` | `Indep(u₁,u₂)` | `O(σ_f) = O(σ′_f)` | order sensitivity |
| `MR_REV` | `Rev(u_f,u_i)` | `O(σ_f) = O(σ₀)` | irreversibility |
| `MR_COMP` | `Comp(s,u_s)` | `O(σ_c) = O(σ_s)` | phrasing sensitivity across turns |
| Context amnesia | multi-turn `MR_CA` (Table 4.3), reported as `MR_CA (multi-turn)` | earlier constraints survive | context amnesia |

Every case runs `N` times and every trial is recorded. The report gives each
case's failure count, the pass / intermittent / fail split and fail@k. The
benchmark no longer applies the `fails/N > ε` verdict rule.

**There is no `WEAK_PASS`.** Under `O(σ) = ⟨V,D⟩`, a `V` difference is a
violation even when the product set matches. `skipped` means the precondition did
not hold, which is a different thing and is excluded from `Cov_MR`.

`MR_CE` was called `MR_SE` in older records; read the two as the same relation.
Case Invariance, Synonym Prefix, Format Suffix and the old "Commutativity"
(which reordered clauses *within one utterance*, from a single starting state)
are all `MR_CE` instances. Idempotency is the `MR_COMP` special case
`s = ⟨u,u⟩, u_s = u`. Their labels are kept in `legacy_name` so older exports
can still be joined.

### Standing assertions

Reported separately from the fault taxonomy (§4.6):

- **`fp(u,σ) ⊆ W(u)`** — else *command over-reach*: the mediator moved a control
  the utterance was not constructed to write. This is the Figure 1.2 signature.
- **`|H_effective| = |H_displayed|`** — else *context integrity*: the transcript
  on screen is not the context the mediator received.

---

## Observability

`POST /api/command` returns `meta` on **every** path, including 400/422/500/502
and local-test mode. §4.17 requires it: *"every reported result will be paired
with the model identifier and parameters. It turns out cloud providers actively
change models, even under the same name."*

`meta` carries `P`, the attempt record (one attempt; there is no JSON repair), token
usage, and `langfuse {traceId, url}`. `requestId` doubles as the Langfuse trace
id, so a D1 row and its trace join on one key.

`attempts[].resolvedModel` is recorded **separately from** `requestedModel`,
because OpenRouter may serve something other than what was asked for. The trace
panel marks the difference with `≠`, and §5.7's cross-mediator comparison depends
on the distinction.

The trace panel renders each transition as the Eq. 4.7 chain with the `V` diff,
any control outside `W`, assignments rejected by `Apply`, the `D` set delta, and
the full `P`. A failed turn appears there too rather than vanishing into a chat
bubble.

---

## Command language: partial updates (v1)

The current benchmark emits partial updates, not complete filter states.
`filters` and `explanation` are required; `filters` may be empty. Each filter
and `sort` is optional. Omitted fields preserve their current values. A supplied
value sets that control; explicit JSON `null` resets only that control to its
specified default. This command-level reset is distinct from the formal state
symbol bottom. `clearFilters: true` resets all filters and sorting first, then
individual updates apply. All these operations are available in the default
benchmark. The checker does not constrain commands to the intended write set.

For example, after Books under $50, `{"filters":{"inStockOnly":true},
"explanation":"In-stock only"}` preserves Books and the price limit.
`{"filters":{"maxPrice":null},"explanation":"Remove price limit"}` resets
only price to 500. Unknown command fields are rejected rather than silently
ignored. Out-of-domain numeric assignments remain visible to Apply for rejection.

### Prompts

Prompts are experiment inputs, pinned by hash. Each prompt file declares its
implementation, the reply format it asks the model for, in a header the model
never sees:

```
---
implementation: full
---
You are a product filter assistant. …
```

The implementation is part of the prompt, not a separate setting, because the
prompt is what tells the model to send every field or only the changed ones.
Hashes cover only the text after the header. The committed prompts:

| Prompt | Implementation | What it is |
|---|---|---|
| `default.txt` | full | The output schema and one line asking for JSON only; no phrase rules. The server uses it when a request carries no prompt, so the chat app and deployed instance run it. Kept identical to `shared/default-prompt.ts`. |
| `student-x.txt` | full | The app's original prompt, byte for byte the one Figure 1.2 was recorded with (`fnv1a32:5a348657`), with its phrase rules ("top rated means minRating >= 4.0 and/or sort"). |

The two default prompts state the command language only and leave phrase
readings to the model, because those readings are what the relations measure;
a prompt that spells them out can hide or move faults (Figure 1.2 is one).
`student-x.txt` keeps the original phrase rules for comparison. The local parser holds the reference
readings instead. The schema is never sent to the model, so only the prompt
text matters. The command-schema hash includes `partial-update-v1` or
`full-state-v1`, so runs under each implementation stay distinguishable.

`CLEAR_ACTION_ENABLED` has been removed; `clearFilters` is always available.
The schema fingerprint still records it as on, so hashes match earlier runs
that had it on. Older experiment files that set it are rejected with a message
saying so, and turn records from runs with it off still show "clear action off".

## Context policy — inducing amnesia

`H` is sent to the mediator, and `HISTORY_POLICY` controls how much of it
arrives. It is part of `P`.

| `HISTORY_POLICY` | Behaviour | Seeded fault |
| --- | --- | --- |
| `full` | every prior turn | none (reference condition) |
| `last-k` | last `HISTORY_MAX_TURNS` turns | truncation (§1.2) |
| `none` | history never sent | **display-only history** |

`none` is a seeded fault, not a legacy setting: the transcript renders, the user
infers the system remembers, and nothing is wired. Observationally it is Context
Amnesia at `k = 0`. What distinguishes it from ordinary summarization-induced
amnesia is *cause*, recoverable only from `P.historyPolicy` — which is why the
oracle detects it but only the instrumentation localizes it.

With partial updates, omitted fields survive even without history. A standalone
request such as "under $50" no longer needs the model to repeat the earlier
category. To evaluate conversational interpretation, include references that
actually require history. Removing history is not guaranteed to cause an MR
failure. Historical full-state history-policy measurements are not applicable
to the new baseline without remeasurement.

`LOCAL_TEST_MODE` parses the current utterance alone, emits partial updates,
and ignores history. Use it for plumbing checks, never as evidence of LLM
performance or conversational understanding.

---

## Running it

Requires Node ≥ 20; [`.nvmrc`](.nvmrc) pins 22.21.1.

```bash
nvm use
npm ci
cp .env.example .env     # set LOCAL_TEST_MODE=true to start with no LLM spend
npm run dev              # Vite on :5173, API on :3001
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite + Express. The primary loop. |
| `npm test` | oracle tests (`node:test` via tsx) |
| `npm run gen:surface` | regenerate after editing `control-surface.yaml` |
| `npm run gen:cases` | build a frozen cases file from `Γ_app` (see below) |
| `npm run sweep` | run an experiment headlessly (see below) |
| `npm run report` | print a results table for a sweep |
| `npm run judge` | ask an LLM judge about every turn of a run (costs money; `--yes`) |
| `npm run oracles` | RQ1 table: MR checker vs implicit oracle vs LLM judge, no model calls |
| `npm run dev:cf` | build, then `wrangler dev` in the real Workers runtime |
| `npm run deploy` | build and deploy |
| `npm run d1:migrate[:local]` | apply migrations |

`wrangler dev` serves `dist/` from disk with no HMR, which is why Express + Vite
stays the primary loop.

### Running experiments

There is **one sweep engine** ([`src/utils/sweep.ts`](src/utils/sweep.ts)) and
two front ends:

- the **Experiments page** (`#experiments` in the app): pick or generate a
  test set, choose conditions, copy the experiment JSON, or run it in the browser
  and read the report;
- **`npm run sweep`**: the same engine from Node, calling the API handler
  in-process, writing JSONL files.

The front ends differ only in the transport (browser `fetch` or in-process)
and the sink (memory or files). A condition's P always travels as request
overrides in the JSON request body, and the router merges them over
the server environment, so both front ends resolve P through one code path.
The server applies condition settings directly and rejects any key outside
the whitelist. A parity test
(`scripts/lib/sweep.test.ts`) runs one test set through both transports and
requires identical trial outcomes.

```bash
npm run gen:cases -- --out cases/pilot.jsonl --groups 10 --per-group 2 --seed 1
npm run sweep -- experiments/pilot-gpt-4o-mini-4cond-n10.json --dry-run   # resolved P, planned calls
npm run sweep -- experiments/pilot-gpt-4o-mini-4cond-n10.json             # writes runs/<name>-<time>/
npm run report -- runs/pilot-<time>                 # Markdown table
npm run report -- runs/pilot-<time> --format latex  # booktabs, for \input
npm run report -- runs/pilot-<time> --by case       # one row per case
```

**RQ1: three oracles on the same run.** `npm run oracles -- runs/<dir>` compares,
per configuration and relation, the trials failed by the MR checker (the
recorded verdict; its column equals the report's failures), by the implicit
oracle (a turn errored, was malformed or had a value rejected; no model), and,
once `judge.jsonl` exists, by an LLM judge, with the overlaps (both, MR only,
judge only). The judge reads the recorded turns; the mediator is not run again.

```bash
npm run judge -- runs/<dir> --dry-run                      # turns to judge and the price
npm run judge -- runs/<dir> --config <id> --yes            # one configuration; writes judge.jsonl
npm run oracles -- runs/<dir> --format latex
```

The judge (default `anthropic/claude-sonnet-5.5`, reasoning `low`, at most 2048
output tokens a call; `--model`, `--reasoning`, `--max-tokens` change them) gets
`judge/judge.txt` and, per turn, the user's earlier requests in that trace, the
latest request, and the filters before and after. It is not told the phrase
readings the test set uses. A trial fails the judge when any of its turns does.
Every row of `judge.jsonl` records the judge's model, served model, reasoning,
token cap and prompt hash; a file written by one judge refuses another.
Unreadable replies are recorded as `invalid`, never guessed; failed calls are
retried on the next run.

- **Cases** (`cases/*.jsonl`) are frozen: one fixed instance per line, with a
  `semanticGroup` (rewordings of one situation are clustered, not independent)
  and strata. [docs/case-generation.md](docs/case-generation.md) compares the
  generator with the proposal and justifies its two deviations: a separately
  reported surface-transform family for `MR_CE`, and the `MR_AC` narrowing
  filter. Context amnesia is in the test set by default (`--no-amnesia` drops it). `validateCase` rejects any case whose precondition fails, and
  `<out>.rejected.jsonl` logs filtered candidates. `<out>.manifest.json`
  records the seed, quotas, git commit and SHA-256. An experiment pins its
  test set with `casesSha256`, and the sweep refuses to start or resume when the
  file's hash differs.
- **Trials** run in complete rounds in a seeded shuffled order, and every case
  is repeated N times, including cases that pass first time.
- **Infrastructure failures** (timeouts, provider errors) are retried and,
  if they persist, recorded as `infra`, separate from mediator failures. A
  malformed or schema-invalid command counts as a mediator failure.
- **Output**: `manifest.json` (config, cases hash, git commit, resolved P),
  `trials.jsonl` (one row per trial, with observations and standing flags) and
  `turns.jsonl` (every `TurnRecord`). `--resume runs/<dir>` continues a run.
- **Conditions state P in full.** A condition's overrides are the only source
  of P. Any P key it leaves out is unset on the server, so `.env` never fills
  a gap. An unset key takes its code default, and an unset temperature or
  top_p is not sent, so the provider's default for that model applies. The
  page shows each condition's P as the server resolves it.
- **Providers.** `LLM_PROVIDER` selects `openrouter`, `openai` or `ollama` per
  condition, and `LLM_MODEL` names the model. Ollama runs on the server's
  machine at `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`). The
  page and the chat offer the models in `shared/models.ts`; the page builds one
  condition per configuration block, exactly as written, with no combining.
- **Langfuse** is off during sweeps unless you pass `--langfuse` or tick
  "Trace every call to Langfuse" on the page. Both send the same
  `x-lngui-langfuse` header.
- `experiments/pilot-local-smoke.json` runs everything in `LOCAL_TEST_MODE` with no
  LLM spend. A sweep refuses a local-mode condition unless the condition sets
  `LOCAL_TEST_MODE` explicitly.

### Deploying

```bash
npx wrangler login
npx wrangler d1 create lngui-turns          # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply lngui-turns --remote
npx wrangler secret put OPEN_ROUTER_API_KEY
npx wrangler secret put LANGFUSE_PUBLIC_KEY
npx wrangler secret put LANGFUSE_SECRET_KEY
npm run deploy
```

One Worker serves both the SPA (from `dist/` via the assets binding) and the API.
`run_worker_first: ["/api/*"]` nests inside `assets`; without it the SPA fallback
would swallow `/api/*`.

> ⚠️ Appendix A and Appendix B cite `chat-assisted-ecommerce.vercel.app` as the
> live instance. Update the proposal after deploying, or keep that host aliased.

---

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `OPEN_ROUTER_API_KEY` / `OPENROUTER_API_KEY` | — | presence selects OpenRouter |
| `OPENAI_API_KEY` | — | selects direct OpenAI when no OpenRouter key |
| `LLM_PROVIDER` | — | `openrouter` \| `openai` \| `ollama`. Unset: key-first resolution |
| `LLM_MODEL` | — | model id for the selected provider; wins over the provider-specific keys |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | the chat UI's default OpenRouter model |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://localhost:11434/v1` / `llama3.1:8b` | local models through Ollama |
| `OPENROUTER_MODELS` | — | comma-separated allowlist for the UI dropdown |
| `OPENROUTER_MODEL_ALLOW_ANY` | `false` | permits arbitrary client model ids |
| `LLM_TEMPERATURE` / `LLM_TOP_P` | unset | unset means not sent: the provider's default applies and P records null. Every experiment condition that calls a model must set at least one, except for models that accept neither (`sampling: null` in `shared/models.ts`, e.g. GPT-5 nano and Claude Haiku 5.5). For those, any temperature or top_p is dropped with a warning, and a file whose conditions become the same run is refused. Figure 1.2 was recorded at `0` |
| `LLM_TIMEOUT_MS` | `30000` | |
| `HISTORY_POLICY` | `full` | `full` \| `last-k` \| `none` |
| `HISTORY_MAX_TURNS` | `3` | with `last-k` |
| `SYSTEM_PROMPT` | — | the prompt text. Unset: `prompts/default.txt`. Experiment conditions set it per request |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | — | tracing needs both |
| `LOCAL_TEST_MODE` | `false` | deterministic parser, no network |
| `TURNS_FILE` | `.data/turns.jsonl` | Express dev store |

With `LLM_PROVIDER` set, that provider is used. Otherwise resolution is key-first: OpenRouter key → OpenRouter; else OpenAI key →
direct OpenAI; else HTTP 500.

---

## Langfuse

Langfuse is an LLM tracing service. With `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` set, every `/api/command` call
from the chat UI becomes one trace. The trace holds a generation for the
single attempt. Each generation
records the exact messages sent (system prompt, rendered history, utterance),
the raw reply, token usage and latency. The trace id equals the turn's
`requestId`, which is also the `TurnRecord.id`. The trace panel's "Langfuse
trace ↗" link opens it.

Use it to read what the model actually saw and said for a suspicious turn,
to compare prompt variants side by side, and to watch cost and latency. The
benchmark never depends on it: `turns.jsonl` and D1 hold the same attempt
records, and every verdict comes from `O(σ)`.

Sweeps leave it off by default. Turn it on for a sweep with `--langfuse`, or
the matching checkbox on the Experiments page.

## Records

Two tables, matching the two artifacts Chapter 4 asks for.

**`turns`** — the reproducible replay log of §4.17 step 5. One row per
transition: `u`, `q`, `V` and `D` before and after, `fp`, `W`, the standing
flags, and `P` denormalized into columns.

**`mr_cases`** — legacy. The old panel wrote one row per case under the
`fails/N > ε` rule. Nothing writes it now; sweeps write `trials.jsonl`. The
table and endpoints remain so earlier records stay readable. Its columns: `fails`, `failure_rate`, `verdict`, `epsilon`, `cov_nl`, `cov_mr`,
`first_failure_ms`, `mediator_invocations`, and the evidence set `E` as turn ids.

Scalar columns are denormalized so the §4.15 metrics are plain SQL:

```sql
-- §5.7 cross-mediator comparison
SELECT resolved_model, relation,
       SUM(verdict = 'fail') * 1.0 / COUNT(*) AS fail_rate
FROM mr_cases JOIN turns USING (session_id)
GROUP BY 1, 2;

-- §4.15 stability: spread of the failure rate across replications
SELECT relation, COUNT(*) AS runs, AVG(failure_rate), MIN(failure_rate), MAX(failure_rate)
FROM mr_cases GROUP BY 1;

-- §4.15 cost per reported violation
SELECT relation, SUM(mediator_invocations) AS calls, SUM(total_tokens) AS tokens,
       SUM(verdict = 'fail') AS violations
FROM mr_cases GROUP BY 1;

-- control reachability: which controls no utterance ever moved
SELECT fp, COUNT(*) FROM turns GROUP BY 1 ORDER BY 2 DESC;

-- the amnesia dose-response curve
SELECT history_policy, history_max_turns, COUNT(*),
       SUM(context_intact = 0) AS context_mismatches
FROM turns GROUP BY 1, 2;

-- did P drift mid-study? it must not (§5.7)
SELECT DISTINCT system_prompt_hash, command_schema_hash, temperature, top_p FROM turns;
```

The Express dev server writes JSONL to `.data/` through the same interface, so
the endpoints behave identically in both runtimes.

API: `POST /api/command`, `GET /api/config`, `POST|GET|DELETE /api/runs`,
`GET /api/runs/:id`, `POST|GET /api/mr-cases`.

---

## Not implemented

LLM paraphrase and translation generation for `Para` (§4.10.1), mutation
analysis (§4.19), seeded faults for RQ1 ground truth (§4.11), and the external subjects —
Home Assistant, WebArena, and the Appendix B probes.

### Update strategy

**Application merges changes** (`diff`) and **LLM rebuilds state** (`full`)
come from each prompt's header, which sets `LNGUI_COMMAND_MODE` for every
condition that uses it. The workbench shows each prompt's implementation and
lets you choose it for a custom prompt; the CLI reads it from the file and
refuses a condition whose `LNGUI_COMMAND_MODE` contradicts it. With no prompt
and no mode in the request, the server uses the default prompt's
implementation (`full`). To run the same text under the other implementation,
save it as a separate prompt with the other header.

Full mode requires every filter field and sort; omitted fields are schema
errors, recorded as a failed turn with no retry. Diff mode permits omission. Both use
the same Apply function and explicit reset/clear semantics. Both receive the
same history policy, not an additional current-state snapshot. Full dry runs
reconstruct values from the effective command history; they are deterministic
plumbing checks, not a measure of LLM performance. Diff dry runs parse only the
latest utterance.

The mode is included in condition names, resolved configuration, turn metadata,
trial JSONL, turn CSV, and schema fingerprints. Historical records without a
mode remain unspecified. The default remains diff. Changing the experiment
strategy does not change an existing run or ordinary chat's server configuration.
For server/CLI configuration use `LNGUI_COMMAND_MODE=diff` or `LNGUI_COMMAND_MODE=full`.
