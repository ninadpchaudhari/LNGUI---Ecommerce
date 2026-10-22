# LNGUI benchmark — UML

Diagrams of the benchmark and its experiment harness, as built on
`conform-to-chapter4`. Equation and section numbers refer to Chapter 4 of the
proposal. GitHub renders the Mermaid blocks directly.

The diagrams fall into four groups:

1. **Structure**: components and deployment.
2. **Design (classes)**: the formal state model, commands and records,
   relations and cases, the experiment runner, generation, and the API layer.
3. **Behaviour (sequences)**: one chat turn, the command handler, one sweep trial.
4. **Behaviour (activities and states)**: the sweep loop, the relation check,
   the trial lifecycle, and case generation.

---

## 1. Structure

### 1.1 Components

Every arrow is an import or a call. The `shared/` modules are pure. `M` (the
mediator) is the only impure stage. There is one sweep engine,
`utils/sweep.ts`, and two front ends drive it: the Experiments page in the
browser and `scripts/sweep.ts` in Node.

```mermaid
flowchart LR
  subgraph Browser["Browser SPA (src/)"]
    App["App.tsx<br/>Benchmark | Experiments"]
    Bench["Chat, Filters, Grid, Trace panels"]
    XP["ExperimentsPage<br/>test set, conditions, run, report"]
    Engine["utils/sweep.ts<br/>runSweep, openCondition"]
    Rel["utils/relations.ts<br/>runTrace, runTrial, adhocCases"]
    Med["utils/mediator.ts<br/>M: mediate, runTurn"]
    Cli["utils/api.ts<br/>sendCommand(fetchImpl, headers)"]
  end

  subgraph Shared["shared/ (pure)"]
    Contract["contract.ts<br/>types, O(σ), fp, Cov"]
    Trans["transition.ts<br/>Apply, A, step"]
    SRel["relations.ts<br/>check"]
    Cases["cases.ts<br/>validateCase"]
    Gen["generate.ts<br/>G, selectCases"]
    Rep["report.ts<br/>fail@k, tables"]
    ExpS["experiment.ts<br/>schema"]
    Ovr["overrides.ts<br/>P override whitelist"]
    Surf["surface.generated.ts<br/>Γ_app"]
    DefP["default-prompt.ts<br/>prompt-text.ts"]
  end

  subgraph API["api/ (runtime-agnostic handler)"]
    Router["router.ts<br/>applyOverrides, handleApiRequest"]
    Cmd["command.ts<br/>handleCommandRequest"]
    Cfg["config.ts<br/>P from env"]
  end

  subgraph Scripts["scripts/ (Node)"]
    GenC["gen-cases.ts"]
    Prompts["lib/prompts.ts<br/>load + verify prompt files"]
    Sweep["sweep.ts"]
    Report["report.ts"]
    IP["lib/inprocess.ts<br/>in-process transport"]
    FS["lib/sweep.ts<br/>fileSink, readTrials"]
  end

  YAML[("control-surface.yaml")]
  PFiles[("prompts/*.txt")]
  LLM(["OpenRouter / OpenAI"])

  App --> Bench & XP
  Bench --> Med
  XP --> Engine & Gen & Cases & ExpS & Rep
  Engine --> Rel --> Med --> Cli
  Rel --> SRel
  Med --> Trans
  Cli -- "POST /api/command<br/>JSON body with overrides" --> Router
  Engine -- "GET /api/config" --> Router
  Router --> Ovr
  Router --> Cmd --> Cfg
  Cmd --> LLM
  Trans --> Contract & Surf
  Gen --> Cases & Surf
  YAML --> Surf

  PFiles --> Prompts
  XP --> DefP
  Cfg --> DefP
  GenC --> Gen
  Sweep --> Engine & ExpS & IP & FS & Prompts
  Report --> Rep & FS
  IP -- "in-process call" --> Router
```

### 1.2 Deployment

One router serves three hosts. The engine runs in the browser (through Vite and
Express, or the Worker) or in Node (handler in-process). Either way each
condition reaches the router as request overrides.

```mermaid
flowchart TB
  subgraph CF["Cloudflare Worker (production)"]
    W["worker.ts fetch()"] --> R1["handleApiRequest"]
    W --> Assets["ASSETS: dist/ SPA"]
    R1 --> D1[("D1: turns, mr_cases")]
  end

  subgraph Dev["Local development"]
    Vite["Vite :5173"] -- "proxy /api" --> Ex["server.ts (Express) :3001"]
    Ex --> R2["handleApiRequest"]
    R2 --> JL[(".data/turns.jsonl")]
  end

  subgraph Node["Headless sweep (npm run sweep)"]
    SW["sweep.ts + engine"] --> IP["inProcessTransport()"]
    IP --> R3["handleApiRequest<br/>(store: null)"]
    SW --> Out[("runs/ID/<br/>manifest.json<br/>trials.jsonl<br/>turns.jsonl")]
  end

  R1 & R2 & R3 --> LLM(["OpenRouter / OpenAI"])
  Browser(["Browser"]) --> W
  Browser --> Vite
```

---

## 2. Design: classes

### 2.1 Formal state model σ = ⟨V, H, P, D⟩

`O(σ) = ⟨V, D⟩` is the only thing a relation compares. `H` and `P` are
recorded for replay and attribution and never enter a verdict.

```mermaid
classDiagram
  class SystemState {
    +V: Valuation
    +H: History
    +P: PromptConfig
    +D: DataState
  }
  class Observation {
    +V: Valuation
    +D: DataState
  }
  class Valuation {
    +category: Category or null
    +maxPrice: number or null
    +minRating: 3 | 3.5 | 4 | 4.5 or null
    +inStockOnly: boolean or null
    +sort: SortValue or null
    +clearFilters: invoked or null
  }
  class DataState {
    +productIds: number[]  ordered
    +count: number
    +total: number
  }
  class HistoryTurn {
    +u: string
    +q: Command or null
    +V: Valuation
    +D: DataState
  }
  class PromptConfig {
    +requestedModel: string
    +resolvedModel: string or null
    +temperature: number
    +topP: number
    +systemPromptHash: string
    +commandSchemaHash: string
    +historyPolicy: full | last-k | none
    +historyMaxTurns: number or null
    +clearActionEnabled?: boolean  older records only
  }
  class Product {
    +id: number
    +name: string
    +category: Category
    +price: number
    +rating: number
    +inStock: boolean
  }
  class Transition {
    <<module shared/transition.ts>>
    +applyCommand(V, q, opts) ApplyResult
    +renderData(V) DataState
    +step(state, u, q, opts) StepResult
    +resetState(P) SystemState
  }
  class Contract {
    <<module shared/contract.ts>>
    +footprint(before, after) ControlId[]
    +overReach(fp, W) ControlId[]
    +pointUpdate(V, d, w) Valuation
    +observationallyEqual(a, b) boolean
    +dataEqual(a, b) boolean  ordered
    +dataSubset(sub, sup) boolean  set
    +covNL(footprints) number
    +covMR(cases) number
    +verdictFor(fails, n, eps) MrVerdict
    +promptConfigFrom(config, model) PromptConfig
  }

  SystemState *-- Valuation : V
  SystemState *-- "0..*" HistoryTurn : H
  SystemState *-- PromptConfig : P
  SystemState *-- DataState : D
  Observation ..> SystemState : projection O(σ)
  HistoryTurn *-- Valuation
  HistoryTurn *-- DataState
  DataState ..> Product : ids of
  Transition ..> SystemState : produces
  Contract ..> Observation : compares
```

### 2.2 Commands, provenance and records

`q` is the boundary between the mediator and the application. A `TurnRecord`
is the replay unit (§4.17); its `meta` pairs every result with the model and
parameters that produced it.

```mermaid
classDiagram
  class Command {
    +filters: CommandFilters
    +sort: SortValue or null
    +clearFilters: boolean or null  optional
    +explanation: string
  }
  class CommandFilters {
    +category: Category or null
    +maxPrice: number or null
    +minRating: number or null
    +inStockOnly: boolean or null
  }
  class ApplyResult {
    +V: Valuation
    +applied: ControlId[]
    +rejected: RejectedAssignment[]
  }
  class RejectedAssignment {
    +control: ControlId
    +value: unknown
    +reason: out-of-domain | unknown-control | action-disabled (older records)
  }
  class TurnRecord {
    +id: string
    +sessionId: string
    +turnIndex: number
    +kind: chat | mr
    +relation: string or null
    +role: source | followup or null
    +trial: number or null
    +u: string
    +q: Command or null
    +vBefore, vAfter: Valuation
    +dBefore, dAfter: DataState
    +fp: ControlId[]
    +writeSet: ControlId[] or null
    +ok: boolean
    +error: string or null
  }
  class StandingFlags {
    +commandOverReach: boolean
    +overReachControls: ControlId[]
    +contextIntact: boolean
  }
  class CommandMeta {
    +requestId: string
    +mode: llm | local-test
    +provider: LlmProvider
    +P: PromptConfig
    +repaired: boolean
    +totalLatencyMs: number
    +usageTotal: TokenUsage or null
    +historyTurnsEffective: number
    +historyTurnsDisplayed: number
    +error: code, message or null
  }
  class AttemptRecord {
    +attempt: number
    +name: initial | repair
    +requestedModel: string
    +resolvedModel: string or null
    +providerName: string or null
    +userPrompt: string
    +rawText: string or null
    +usage: TokenUsage or null
    +outcome: parsed | schema-invalid | json-invalid | llm-error
  }
  class TokenUsage {
    +promptTokens: number or null
    +completionTokens: number or null
    +totalTokens: number or null
    +costUsd: number or null
  }
  class MrCaseRecord {
    +relation: RelationName
    +predicate: string
    +sourceTrace: string[]
    +followupTrace: string[]
    +n: number
    +epsilon: number
    +fails: number
    +verdict: pass | fail | skipped
    +covNL, covMR: number
    +evidenceTurnIds: string[]
  }

  Command *-- CommandFilters
  ApplyResult *-- "0..*" RejectedAssignment
  TurnRecord *-- StandingFlags : flags
  TurnRecord o-- CommandMeta : meta
  TurnRecord o-- Command : q
  CommandMeta *-- "1..2" AttemptRecord : attempts
  AttemptRecord *-- TokenUsage
  CommandMeta *-- TokenUsage : usageTotal
  MrCaseRecord ..> TurnRecord : evidenceTurnIds
```

### 2.3 Relations and frozen cases

`MrInstance` is what `check` needs. `MrCase` adds what the analysis needs: a
stable id, a semantic group for clustering, strata and provenance. Every
`MrCase` is usable wherever an `MrInstance` is.

```mermaid
classDiagram
  class RelationName {
    <<enumeration>>
    MR_CE
    MR_AC
    MR_CA
    MR_REV
    MR_COMP
    CONTEXT_AMNESIA
  }
  class MrInstance {
    +relation: RelationName
    +predicate: string
    +legacyName: string or null
    +description: string
    +sourceTrace: string[]
    +followupTrace: string[]
    +writeSets: source ControlId[][], followup ControlId[][]
    +refinement: control, value  optional, MR_AC only
  }
  class MrCase {
    +id: string
    +semanticGroup: string
    +strata: string[]
    +provenance: Provenance
  }
  class Provenance {
    +generator: template | transform | goldSyn | manual
    +sources: string[]
  }
  class TraceResult {
    +state: SystemState
    +records: TurnRecord[]
  }
  class CheckResult {
    +holds: boolean
    +reason: string
    +infra: boolean
  }
  class TrialResult {
    +source: TraceResult
    +followup: TraceResult
    +outcome: CheckResult
  }
  class SharedRelations {
    <<module shared/relations.ts>>
    +check(instance, source, followup) CheckResult
    +isInfraFailure(record) boolean
  }
  class SharedCases {
    <<module shared/cases.ts>>
    +caseSchema: zod schema
    +validateCase(c) string[]
    +parseCasesJsonl(text) ParsedCases
    +toJsonl(cases) string
  }
  class ClientRelations {
    <<module src/utils/relations.ts>>
    +runTrace(P, utterances, W, opts) TraceResult
    +runTrial(P, instance, opts) TrialResult
    +adhocCases(base) MrCase[]
  }

  MrInstance <|-- MrCase
  MrInstance --> RelationName
  MrCase *-- Provenance
  TrialResult *-- "2" TraceResult
  TrialResult *-- CheckResult
  SharedRelations ..> MrInstance
  SharedRelations ..> CheckResult : returns
  SharedCases ..> MrCase : validates
  ClientRelations ..> SharedRelations : calls check
  ClientRelations ..> TrialResult : returns
```

The precondition each relation enforces in `validateCase`:

| Relation | Source trace | Follow-up trace | Label check |
| --- | --- | --- | --- |
| `MR_CE` | `[u₁]` | `[u₂]` | `W(u₁) = W(u₂)`, `u₁ ≠ u₂` |
| `MR_AC` | `[u_b]` | `[u_b ⊕ δ]` | `d ∈ C_con`, `d ∉ W(u_b)`, `w ∈ Dom(d)`, follow-up `W = W(u_b) ∪ {d}` |
| `MR_CA` | `[u₁, u₂]` | `[u₂, u₁]` | `W(u₁) ∩ W(u₂) = ∅`, both non-empty |
| `MR_REV` | `[]` (σ₀) | `[u_f, u_i]` | `W(u_f) ⊆ C_rev`, `W(u_i) = W(u_f)` |
| `MR_COMP` | `[u₁ … uₙ]`, n ≥ 2 | `[u_s]` | `W(u_s) = ⋃ W(uᵢ)` |
| `CONTEXT_AMNESIA` | `[u₁]` | `[u₁, f₁ … fₖ]` | `W(u₁) ∩ ⋃ W(fᵢ) = ∅` |

### 2.4 Experiment runner and report

One engine. A front end supplies a `Transport` and a `TrialSink`. A
condition's P travels as `Overrides`.

```mermaid
classDiagram
  class Condition {
    +id: string
    +env: Overrides
  }
  class Overrides {
    <<shared/overrides.ts>>
    LLM_PROVIDER, LLM_MODEL
    OPENROUTER_MODEL, OPENAI_MODEL, OLLAMA_MODEL
    SYSTEM_PROMPT  text, from the condition's prompt file
    LLM_TEMPERATURE, LLM_TOP_P
    HISTORY_POLICY, HISTORY_MAX_TURNS
    LNGUI_COMMAND_MODE
    LOCAL_TEST_MODE
  }
  class Transport {
    <<interface>>
    +fetchImpl: FetchLike  optional
    +headers: map  optional
    +drain() Promise  optional
  }
  class TrialSink {
    <<interface>>
    +turns(records) Promise
    +trial(row) Promise
    +flush() Promise  optional
  }
  class ConditionRuntime {
    +condition: Condition
    +config: AppConfig
    +P: PromptConfig
    +model: string
    +transport: Transport
  }
  class Experiment {
    <<shared/experiment.ts>>
    +name: string
    +cases: path
    +casesSha256: string
    +n: number
    +seed: number
    +concurrency: number
    +maxInfraRetries: number
    +conditions: id, prompt (file, sha256), env
  }
  class TrialRow {
    <<shared/trials.ts>>
    +runId, conditionId, caseId
    +relation, semanticGroup, strata
    +trial: number  round 1..N
    +attempt: number
    +status: pass | fail | infra
    +reason: string
    +invocations, tokens, latencyMs
    +overReach, contextIntact
    +observations: source, followup
    +turnIds: string[]
  }
  class Engine {
    <<module src/utils/sweep.ts>>
    +openCondition(condition, transport) ConditionRuntime
    +runSweep(opts) TrialRow[]
    +memorySink() TrialSink
    +plannedInvocations(cases, conditions, n) number
  }
  class BrowserFrontEnd {
    <<ExperimentsPage.tsx>>
    transport: global fetch + Langfuse switch
    sink: memory, optional /api/runs
  }
  class CliFrontEnd {
    <<scripts/sweep.ts>>
    transport: inProcessTransport(Langfuse switch)
    sink: fileSink(trials, turns)
  }
  class CasesManifest {
    <<cases/name.manifest.json>>
    +sha256: string
    +generator: seed, groups, perGroup, amnesia
    +git: commit, dirty
    +counts: per report row
  }
  class ReportLib {
    <<module shared/report.ts>>
    +failAtK(n, c, k) number or null
    +reportGroup(row) string
    +caseStats(rows) CaseStat[]
    +summaryTable(rows, ks, title) Table
    +caseTable(rows, ks, title) Table
    +render(table, md | latex | csv) string
  }

  Experiment *-- "1..*" Condition
  Condition --> Overrides
  ConditionRuntime --> Condition
  ConditionRuntime --> Transport
  Engine ..> ConditionRuntime : opens
  Engine ..> TrialSink : writes to
  Engine ..> TrialRow : produces
  BrowserFrontEnd ..> Engine
  CliFrontEnd ..> Engine
  BrowserFrontEnd ..|> Transport : fetch
  CliFrontEnd ..|> TrialSink : files
  Experiment ..> CasesManifest : casesSha256
  ReportLib ..> TrialRow : reads
```

### 2.5 Generation from Γ_app

`control-surface.yaml` is compiled into `surface.generated.ts`. The generator
fills templates and clauses from it, validates every candidate, and selects a
seeded, stratified test set. [case-generation.md](case-generation.md) compares it
with the proposal and justifies its two deviations.

```mermaid
classDiagram
  class ControlSpec {
    +id: ControlId
    +label: string
    +domain: ControlDomain
    +reset: ControlValue
    +constraining: boolean  in C_con
    +reversible: boolean  in C_rev
  }
  class ControlDomain {
    <<union>>
    enum: values with phrases
    number: min, max
    boolean
    action
  }
  class TemplateSpec {
    +id: string
    +text: string
    +slot: ControlId  optional
    +writes: ControlId[]
    +predicates: syn | indep | refineBase | rev
    +inverse: string  optional
  }
  class RefinementClauseSpec {
    +id: string
    +text: string
    +slot: ControlId  optional
    +target: ControlId
    +value: fixed value  optional
  }
  class SurfaceTransformSpec {
    <<union>>
    uppercase
    replacePrefix: from, to
    append: text
    moveSortClauseFirst
  }
  class GoldSynPair {
    +source: string
    +variant: string
    +writes: ControlId[]
  }
  class Candidate {
    <<MrCase without id>>
  }
  class Rejection {
    +relation: RelationName
    +description: string
    +reason: string
  }
  class SelectOptions {
    +seed: number
    +groups: number
    +perGroup: number
    +relations: RelationName[]  optional
  }
  class Selection {
    +cases: MrCase[]
    +shortfalls: pool, available, requested
  }
  class GenerateLib {
    <<module scripts/lib/generate.ts>>
    +slotValues(control) SlotValue[]
    +generateCandidates() Candidates
    +selectCases(candidates, opts) Selection
    +poolOf(candidate) string
  }

  ControlSpec *-- ControlDomain
  TemplateSpec ..> ControlSpec : slot, writes
  RefinementClauseSpec ..> ControlSpec : target
  GenerateLib ..> TemplateSpec
  GenerateLib ..> RefinementClauseSpec
  GenerateLib ..> SurfaceTransformSpec
  GenerateLib ..> GoldSynPair
  GenerateLib ..> Candidate : produces
  GenerateLib ..> Rejection : logs
  GenerateLib ..> SelectOptions
  GenerateLib ..> Selection : returns
  Selection o-- "0..*" Candidate : as MrCase
```

### 2.6 API layer

```mermaid
classDiagram
  class TurnStore {
    <<interface>>
    +kind: d1 | file
    +putTurn(record) Promise
    +listTurns(query) Page~TurnRecord~
    +getTurn(id) TurnRecord or null
    +putMrCase(record) Promise
    +listMrCases(query) Page~MrCaseRecord~
    +clear(sessionId) Promise
  }
  class D1TurnStore {
    +createD1TurnStore(db) TurnStore
  }
  class FileTurnStore {
    +createFileTurnStore(path) TurnStore
  }
  class ApiDeps {
    +store: TurnStore or null
    +waitUntil(p)
  }
  class Router {
    <<module api/router.ts>>
    +applyOverrides(request, env) env or error
    +handleApiRequest(request, env, deps) Response or null
  }
  class CommandHandler {
    <<module api/command.ts>>
    +handleCommandRequest(request, env, deps) Response
    -callLLM(client, model, messages, llm)
    -buildLocalTestCommand(prompt) Command
    -extractJSON(raw) string
  }
  class Config {
    <<module api/config.ts>>
    +resolveLLMConfig(env) LLMConfig
    +resolveModelPolicy(env) ModelPolicy
    +selectModel(env, requested) ModelSelection
    +resolveHistoryConfig(env) HistoryConfig
    +resolveSystemPrompt(env) string  override text, else default
    +getEnvVar(env, key) string  falls back to process.env
  }
  class LLMConfig {
    +provider: openrouter | openai | ollama | none
    +model: string
    +baseURL: string
    +temperature: number or null  null = not sent
    +topP: number or null
    +timeoutMs: number
  }
  class PromptModule {
    <<module api/prompt.ts>>
    +buildCommandSchema(mode) zod schema
    +promptHashes(systemPrompt, mode)
  }

  TurnStore <|.. D1TurnStore
  TurnStore <|.. FileTurnStore
  ApiDeps o-- TurnStore
  Router ..> ApiDeps
  Router ..> CommandHandler : /api/command
  Router ..> TurnStore : /api/runs, /api/mr-cases
  CommandHandler ..> Config
  CommandHandler ..> PromptModule
  Config ..> LLMConfig
```

---

## 3. Behaviour: sequences

### 3.1 One chat turn in the browser (Eq. 4.7)

`u --M--> q --Apply--> V′ --A--> D′`. Everything after `q` is deterministic.

```mermaid
sequenceDiagram
  actor User
  participant App as App.tsx
  participant Med as mediator.ts
  participant Api as api.ts
  participant H as handleApiRequest
  participant LLM as OpenRouter
  participant T as transition.ts

  User->>App: types u
  App->>Med: runTurn(σ, u, W from inferWriteSet)
  Med->>Api: sendCommand(u, history = σ.H)
  Api->>H: POST /api/command
  H->>LLM: system prompt + effective H + u
  LLM-->>H: JSON text
  H-->>Api: q + meta (P, attempts, usage)
  Api-->>Med: q, meta
  Med->>T: step(σ, u, q)
  T->>T: applyCommand(V, q) gives V′
  T->>T: renderData(V′) gives D′
  T-->>Med: σ′ with H ⊕ turn
  Med->>Med: fp = footprint(V, V′), flags = standingFlags
  Med-->>App: σ′ and TurnRecord
  App->>App: setState(σ′)
  App-)H: POST /api/runs (saveTurn, fire and forget)
```

### 3.2 Command handler: attempts and repair

The handler records one or two attempts. A repair retries once without
history when the first reply is not valid JSON or fails the schema.

```mermaid
sequenceDiagram
  participant C as Caller
  participant H as handleCommandRequest
  participant Cfg as config.ts
  participant P as prompt.ts
  participant L as LLM

  C->>H: POST prompt, history, model
  H->>Cfg: resolveSystemPrompt, resolveHistoryConfig, selectModel
  H->>P: buildCommandSchema, promptHashes
  alt model not allowed
    H-->>C: 400 model_not_allowed + meta
  else LOCAL_TEST_MODE
    H->>H: buildLocalTestCommand(prompt), ignores H
    H-->>C: 200 q + meta
  else no API key
    H-->>C: 500 missing_api_key + meta
  else LLM mode
    H->>L: attempt 1 "initial": system, effective H, u
    alt call throws
      H-->>C: 502 llm_error + meta
    else parsed and schema-valid
      H-->>C: 200 q + meta
    else json-invalid or schema-invalid
      H->>L: attempt 2 "repair": system, repair prompt
      alt parsed
        H-->>C: 200 q + meta (repaired = true)
      else still invalid
        H-->>C: 422 invalid_json or schema_invalid + meta
      end
    end
  end
```

### 3.3 One sweep trial, in-process

The same sequence runs from both front ends. Only the transport `F` differs:
browser `fetch` over HTTP, or the handler called in-process. The router
applies the condition's overrides before any handler resolves P.

```mermaid
sequenceDiagram
  participant S as runSweep
  participant RT as runTrial
  participant TR as runTrace
  participant M as runTurn / mediate
  participant F as Transport
  participant R as Router
  participant H as handleCommandRequest
  participant LLM as LLM
  participant CK as check
  participant K as TrialSink

  S->>RT: runTrial(P_condition, case, trial r)
  loop source trace, then follow-up trace
    RT->>TR: runTrace(P, utterances, W)
    TR->>TR: σ = resetState(P)
    loop each utterance u
      TR->>M: runTurn(σ, u, writeSet, headers)
      M->>F: POST /api/command, JSON body with overrides
      F->>R: Request
      R->>R: applyOverrides (400 if invalid)
      R->>H: env merged with overrides
      H->>LLM: chat completion
      LLM-->>H: reply
      H-->>M: q + meta
      M->>M: step(σ, u, q), footprint, flags
      M-->>TR: σ′, TurnRecord
    end
    TR-->>RT: TraceResult
  end
  RT->>CK: check(case, source, followup)
  CK-->>RT: holds, reason, infra
  RT-->>S: TrialResult
  S->>K: turns(records)
  alt infra and attempt <= maxInfraRetries
    S->>S: wait 2^attempt s, rerun trial
  else
    S->>K: trial(row)
  end
```

---

## 4. Behaviour: activities and states

### 4.1 The sweep loop

Shown for the CLI. The Experiments page runs the same checks before it starts
and the same loop afterwards.

```mermaid
flowchart TD
  A([experiment.json]) --> B[Validate with experimentSchema, parse cases.jsonl]
  B --> C{cases valid?}
  C -- no --> X1([exit: list problems])
  C -- yes --> D{casesSha256 matches the file?}
  D -- no --> X2([exit: wrong test set])
  D -- yes --> E[openCondition for each condition<br/>GET /api/config with overrides]
  E --> F{local-test without explicit flag,<br/>or no API key?}
  F -- yes --> X3([exit: misconfigured condition])
  F -- no --> G[Print resolved P and planned calls]
  G --> H{--dry-run?}
  H -- yes --> X4([exit 0])
  H -- no --> I[Write manifest.json<br/>read trials.jsonl, done = pass or fail keys]
  I --> J[round r = 1]
  J --> K[Shuffle all condition × case pairs with seeded rng<br/>drop keys already done]
  K --> L[Worker pool of size concurrency<br/>runOne for each pair, until stopped]
  L --> M[Await workers, drain transport]
  M --> N{r < N?}
  N -- yes --> O[r = r + 1] --> K
  N -- no --> P[Stamp finishedAt in manifest]
  P --> Q([report: npm run report, or the page])
```

### 4.2 The relation check

```mermaid
flowchart TD
  S([check instance, source, followup]) --> A{any turn not ok?}
  A -- yes --> B{meta null or code in<br/>bad_request, model_not_allowed,<br/>missing_api_key, llm_error, internal?}
  B -- yes --> R1([holds = false, infra = true])
  B -- no --> R2([holds = false, mediator error])
  A -- no --> C{relation}
  C -- "MR_CE, MR_CA, MR_REV, MR_COMP" --> D{"O(σ′) = O(σ″)?<br/>V equal and D equal in order"}
  D -- yes --> P1([holds])
  D -- no --> F1(["fails: V differs, D differs, or both"])
  C -- MR_AC --> E{"V_ur = V_ub[d ↦ w]?"}
  E --> E2{"D_ur ⊆ D_ub?"}
  E2 -- both --> P2([holds])
  E2 -- otherwise --> F2(["fails: constraint leaked or D not contained"])
  C -- CONTEXT_AMNESIA --> G{"every control in fp(u₁) not rewritten later<br/>keeps its value?"}
  G -- yes --> P3([holds])
  G -- no --> F3(["fails: silently lost controls"])
```

### 4.3 Trial lifecycle

```mermaid
stateDiagram-v2
  [*] --> Pending: pair scheduled in round r
  Pending --> Skipped: key already done (resume)
  Pending --> Skipped: run stopped
  Pending --> Running: worker picks it up
  Running --> Checking: both traces finished
  Checking --> Passed: holds
  Checking --> Failed: not holds, mediator
  Checking --> InfraError: not holds, infra
  InfraError --> Backoff: attempt <= maxInfraRetries
  Backoff --> Running: after 2^attempt s
  InfraError --> RecordedInfra: retries exhausted
  Passed --> [*]: row written
  Failed --> [*]: row written
  RecordedInfra --> [*]: row written, rerun on resume
  Skipped --> [*]
```

### 4.4 Case generation

```mermaid
flowchart TD
  Y[(control-surface.yaml)] --> GS[npm run gen:surface]
  GS --> SG[surface.generated.ts<br/>CONTROLS, TEMPLATES, REFINEMENT_CLAUSES,<br/>SURFACE_TRANSFORMS, GOLD_SYN, C_CON, C_REV]
  SG --> GC[generateCandidates]
  GC --> CE[MR_CE ce:para: template pairs, phrase pairs, Gold_Syn<br/>MR_CE ce:surface: transforms, Figure 1.2 composites]
  GC --> AC[MR_AC: refineBase template + clause on another C_con control]
  GC --> CA[MR_CA: two single-control templates, disjoint W, both orders]
  GC --> RV[MR_REV: rev template + its inverse]
  GC --> CP[MR_COMP: 2- and 3-turn sequences vs joined utterance,<br/>idempotence u,u vs u]
  GC --> CX[CONTEXT_AMNESIA: u₁ then two sort turns,<br/>on by default]
  AC --> N{refined D non-empty<br/>and strictly smaller?}
  N -- no --> RJ[(rejected.jsonl)]
  N -- yes --> DD
  CE & CA & RV & CP & CX --> DD[Dedupe on relation + traces]
  DD --> V{validateCase passes?}
  V -- no --> RJ
  V -- yes --> POOL[Candidate pool]
  POOL --> SEL[selectCases with seed, per pool<br/>CEP, CES, AC, CA, CTX, REV, COMP:<br/>pinned cases first, then shuffle groups, take G,<br/>then up to R cases per group]
  SEL --> SF{fewer groups than G?}
  SF -- yes --> WARN[warn: shortfall]
  SEL --> OUT[(cases/pilot.jsonl + sha256)]
```

### 4.5 End-to-end experiment pipeline

```mermaid
flowchart LR
  Y[(control-surface.yaml)] -->|gen:surface| S[surface.generated.ts]
  S -->|gen:cases| C[(cases/*.jsonl<br/>frozen, hashed)]
  PF[(prompts/*.txt<br/>pinned by sha256)] --> E
  E[(experiments/*.json<br/>conditions × N)] --> SW
  C --> SW[sweep]
  ENV[(.env API key)] --> SW
  SW --> M[(manifest.json)]
  SW --> T[(trials.jsonl)]
  SW --> U[(turns.jsonl)]
  T --> R[report]
  M --> R
  R -->|--format md| MD[Markdown table]
  R -->|--format latex| TX[booktabs table]
  R -->|--format csv| CS[CSV]
```
