# Chat-Assisted Ecommerce — LNGUI benchmark

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
| [`src/utils/relations.ts`](src/utils/relations.ts) | Table 4.1 and Algorithm 1 |
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
reached by language under this suite".

Because clearing cannot be undone in one utterance, `c₆ ∉ C_rev` and it generates
no `MR_REV` case. Setting `CLEAR_ACTION_ENABLED=false` removes it from both `Q`
and the system prompt — so `P` genuinely differs between the two configurations
and `Cov_NL` 6/6 vs 5/6 is a controlled comparison rather than a confound.

---

## Relations

| Relation | Precondition | Postcondition | Fault exposed |
| --- | --- | --- | --- |
| `MR_SE` | `Syn(u₁,u₂)` | `O(σ′) = O(σ″)` | synonym blindness |
| `MR_AC` | `Refine(u_r,u_b,δ)` | `V_ur = V_ub[d↦w]` ∧ `D_ur ⊆ D_ub` | constraint leakage |
| `MR_CA` | `Indep(u₁,u₂)` | `O(σ_f) = O(σ′_f)` | order sensitivity |
| `MR_REV` | `Rev(u_f,u_i)` | `O(σ_f) = O(σ₀)` | irreversibility |
| Context amnesia | multi-turn `MR_CA` | earlier constraints survive | context amnesia |

A verdict is a property of `N` trials, not one run: `violation ⟺ fails/N > ε`
(Eq. 4.18). Defaults are `N = 10`, `ε = 0.2`, matching the §4.19.3 example.

**There is no `WEAK_PASS`.** Under `O(σ) = ⟨V,D⟩`, a `V` difference is a
violation even when the product set matches. `skipped` means the precondition did
not hold, which is a different thing and is excluded from `Cov_MR`.

The earlier five-relation set was not conformant. Case Invariance, Synonym
Prefix, Format Suffix and the old "Commutativity" (which reordered clauses
*within one utterance*, from a single starting state) are all `MR_SE` instances;
Idempotency is the §5.4 repeated-input diagnostic, not an MR. Their labels are
kept in `mr_cases.legacy_name` so older exports can still be joined.

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

`meta` carries `P`, per-attempt records (initial and the JSON repair), token
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

Sweeping the dial gives a dose-response curve for §5.4. Measured on
`gpt-4o-mini`, "show electronics" then "only the ones under $50":

```
full:  q keeps category=electronics, adds maxPrice=50
       fp=[maxPrice],            D 4 -> 2    correct refinement
none:  q emits category=null
       fp=[category,maxPrice],   D 4 -> 13   three signatures at once
       - MR_AC:          D_ur ⊆ D_ub violated — the result set widened
       - Context amnesia: category ∈ fp(u1) changed while W(u2)={maxPrice}
       - Over-reach:      fp ⊄ W
```

> **`LOCAL_TEST_MODE` is stateless by construction.** It parses the current
> utterance alone and ignores `H`, so it behaves like `HISTORY_POLICY=none`
> whatever the policy says. Use it for UI and plumbing work and to check that a
> relation *runs* — never to measure a mediator.

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
| `npm run dev:cf` | build, then `wrangler dev` in the real Workers runtime |
| `npm run deploy` | build and deploy |
| `npm run d1:migrate[:local]` | apply migrations |

`wrangler dev` serves `dist/` from disk with no HMR, which is why Express + Vite
stays the primary loop.

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

> ⚠️ Set `RUNS_WRITE_TOKEN` before sharing a deployed URL, or `POST /api/runs` is
> a public write.

> ⚠️ Appendix A and Appendix B cite `chat-assisted-ecommerce.vercel.app` as the
> live instance. Update the proposal after deploying, or keep that host aliased.

---

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `OPEN_ROUTER_API_KEY` / `OPENROUTER_API_KEY` | — | presence selects OpenRouter |
| `OPENAI_API_KEY` | — | selects direct OpenAI when no OpenRouter key |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | the default model; **experiments repeat by leaving this alone** |
| `OPENROUTER_MODELS` | — | comma-separated allowlist for the UI dropdown |
| `OPENROUTER_MODEL_ALLOW_ANY` | `false` | permits arbitrary client model ids |
| `LLM_TEMPERATURE` / `LLM_TOP_P` | `0` / `1` | pinned deterministic, so a difference between runs is attributable to the mediator |
| `LLM_TIMEOUT_MS` | `30000` | |
| `HISTORY_POLICY` | `full` | `full` \| `last-k` \| `none` |
| `HISTORY_MAX_TURNS` | `3` | with `last-k` |
| `CLEAR_ACTION_ENABLED` | `true` | `false` removes `c₆` from `Q` and the prompt |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | — | tracing needs both |
| `LOCAL_TEST_MODE` | `false` | deterministic parser, no network |
| `RUNS_WRITE_TOKEN` / `RUNS_READ_TOKEN` | — | shared-secret gates, off by default |
| `TURNS_FILE` | `.data/turns.jsonl` | Express dev store |

Provider resolution is key-first: OpenRouter key → OpenRouter; else OpenAI key →
direct OpenAI; else HTTP 500.

---

## Records

Two tables, matching the two artifacts Chapter 4 asks for.

**`turns`** — the reproducible replay log of §4.17 step 5. One row per
transition: `u`, `q`, `V` and `D` before and after, `fp`, `W`, the standing
flags, and `P` denormalized into columns.

**`mr_cases`** — the test report `T` of Algorithm 1. One row per case over `N`
trials: `fails`, `failure_rate`, `verdict`, `epsilon`, `cov_nl`, `cov_mr`,
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

Template-driven generation `G` beyond the `Γ_app` data (§4.10.1), mutation
analysis (§4.19), the LLM-as-judge baseline (§5.3), and the external subjects —
Home Assistant, WebArena, and the Appendix B probes.
