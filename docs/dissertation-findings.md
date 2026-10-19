# Findings from instrumenting the benchmark

> **Superseded in part (Oct 2026).** `PROMPT_VARIANT` (`baseline`, `extended`)
> no longer exists. The prompt is now a text file that experiments name and
> pin (see README, "The system prompt is an input to the experiment"). Hand
> measurements made later at N=5 per cell did not reproduce two claims below:
> that the baseline prompt leaks the category on a two-turn refinement
> deterministically, and that removing the "Do NOT invent constraints" line
> matters for Figure 1.2. Rerun them through a sweep before citing §1 to §3.


Working notes from conforming the case-study application to Chapter 4 and
deploying it. Intended for review and discussion, not as dissertation prose.

**Live instance:** https://lngui-ecommerce.ninadpchaudhari.workers.dev
**Code:** branch `conform-to-chapter4`
**Mediator throughout:** `openai/gpt-4o-mini` via OpenRouter, `temperature=0`, `top_p=1`

## How to read the evidence labels

| Label | Means |
| --- | --- |
| `[deterministic]` | reproduced 3/3 or better at temperature 0 — but still one model, one day |
| `[N=1]` | single trial. **Not a confirmed fault.** At ε=0.2 any single failure trivially exceeds the threshold; §4.10's repetition rule exists precisely for this |
| `[structural]` | follows from the code or the formalism, not from measurement |
| `[open]` | a question for you, not a finding |

Nothing here has been run at the `N` the proposal requires. Treat every rate as
provisional and re-run at `N ≥ 10` before it goes in a results table.

---

## 1. A prompt revision silently destroyed the motivating fault

`[deterministic]`

While deploying, the live instance stopped exhibiting Figure 1.2: the lowercase
utterance began setting `minRating = 4`, so the case-invariance violation
disappeared. My first hypothesis was model drift, which §2.3.2 predicts.

It was not drift. Replaying the *original* prompt verbatim against the same
model reproduced the figure exactly. The cause was a prompt revision I had made
for unrelated reasons, and each of the two additions was **individually**
sufficient to destroy it:

| System prompt | lowercase | UPPERCASE | Figure 1.2 |
| --- | --- | --- | --- |
| original | `null` | `4` | reproduces |
| + `clearFilters` field only | `4` | `4` | lost |
| + preserve-context rule only | `4` | `4` | lost |
| + both | `4` | `4` | lost |

**Why it matters.** §2.3.2 argues mediator defects outlast model improvement,
partly because "each model swap, prompt revision, or schema change silently
alters that mapping without producing a code diff that anyone can review." This
is that claim happening to your own benchmark, caught by accident. It is
first-person evidence rather than citation.

**Where it lands.** §2.3.2 as an empirical illustration; §4.17 (procedure) as a
requirement to pin and hash P; §4.18 as a threat to validity for any result not
paired with a prompt hash.

**Methodological consequence.** The repo now pins the baseline prompt character
for character in a test that fails if anyone edits it. I would argue this
belongs in the *method*, not just the engineering: a benchmark whose known
faults are prompt-sensitive needs its prompt under the same change control as
its code.

**`[open]`** Does this warrant widening "silent model drift" to "silent mediator
revision", covering model, prompt, and schema as three sources of the same
regression class?

---

## 2. MR_SE and MR_AC are in tension under one prompt family

`[deterministic]` — the strongest finding here, and I think the most publishable.

The prompt cannot simultaneously *avoid inventing constraints* and *preserve
constraints across turns*.

| Prompt | Case invariance (MR_SE) | Two-turn refinement (MR_AC) |
| --- | --- | --- |
| baseline | **violated** — UPPERCASE invents `minRating=4` | **leaks** — category dropped, D widens 4 → 13 |
| + preserve-context rule | passes — both cases `4` | works — category kept, D narrows 4 → 2 |

The instruction that makes the mediator carry context forward is the same one
that makes it over-apply `minRating`. **Repairing constraint leakage introduces
synonym blindness.**

**Why it matters.** Table 4.1 and Table 4.3 present the four relations and five
fault classes as independent — each relation paired with the defect class it
detects. This observation says they are not independent with respect to `P`:
there may be no single prompt that satisfies all four simultaneously, so a
mediator's fault profile is a point on a trade-off surface rather than a list of
defects to be fixed one by one.

If that generalizes, it changes what a passing test set means. "All relations pass"
might be unreachable by construction for some control surfaces, and the useful
report becomes *which* relations a given `P` trades against which.

**Where it lands.** A new subsection after §4.8 (fault model), or an extension
to §4.9 (Interpretations), which currently lists per-class causes but not
interactions. Also §4.18, and §4.15 — it implies every metric must be reported
per prompt condition, not pooled.

**`[open]`** Is this a property of this prompt family, this model, or of
NL mediation generally? Testing it needs (a) more than one phrasing of the
preserve rule, (b) more than one model, (c) ideally a second control surface.
That is a well-scoped experiment and a strong candidate for Paper 0 or Paper 1.

**`[open]`** Does the framework want a notion of *relation compatibility* — a
set of MRs being jointly satisfiable under some `P`?

---

## 3. `Q`'s design decides whether constraint leakage is even possible

`[structural]`

Every command carries every field, and a returned `null` means "no constraint
from this field", which resolves to `V₀(c)`. Therefore **every command fully
determines `V`**: any control the mediator does not mention is reset.

Two consequences:

- `Apply(V, q)` barely depends on `V` at all (only `clearFilters` reads prior
  state). Essentially all context-dependence lives in `M`. That is convenient
  for fault localization but worth stating, because Eq. 4.7 presents `Apply` as
  a state transformer.
- Under baseline, MR_AC **cannot** pass. Constraint leakage is the default
  behaviour of a total-command `Q`, not an occasional defect.

A patch-style `Q` — where the mediator emits only the controls it intends to
change — would make leakage a genuine mediator fault rather than a structural
inevitability, and would make `fp ⊆ W` far sharper.

**Where it lands.** §4.5, where `Q` is introduced as "the command language
exposed by the subject". The choice between total and patch commands is
currently invisible in the formalism but determines which faults are reachable.

**`[open]`** Worth a paragraph contrasting the two `Q` styles? It is a design
axis for anyone applying the framework to a new subject, and it may be a cleaner
explanation of some KAYAK observations in Appendix B than "read-only mediator".

---

## 4. `Cov_NL` is a function of `P`, not only of the test set

`[structural]`

Eq. 4.19 defines `Cov_NL(U) = |⋃ fp(u,σ₀)| / |C|` — dependent on `U` alone. But
whether a control is reachable at all depends on `P`: under the baseline prompt,
`clearFilters` is absent from `Q`, so **no** utterance can move `c₆` and
`Cov_NL` caps at 5/6 by construction.

§4.11 already distinguishes two causes of a coverage gap — the control is
unreachable through language (implementation failure) versus the generator never
produced a phrasing (inadequate test set). This is a third: the control is
unreachable *under this prompt/schema*, and would be reachable under another.

Suggests writing it `Cov_NL(U, P)`, or stating that `P` is held fixed and the
metric is relative to it.

**Where it lands.** §4.11, and the `Cov_NL` definition in §4.19.

---

## 5. Action controls need a value domain for coverage to work

`[structural]`

§4.3 puts "menu actions" in `C`, and §A.1 lists Clear Filters as `c₆`. But
`Val(C)` assumes each control has a value domain, and §A.7's worked example
treats `c₆` as coverable ("never reached by language under this test set").

An action has no persistent value, so a literal reading makes `c₆` permanently
outside every footprint and `Cov_NL` structurally sub-1 for any subject with an
action control.

The implementation resolves this by giving `c₆` the domain `{⊥, "invoked"}` as a
**sticky flag**, reset only by `ResetApp`. The alternatives are worse:

- an invocation *counter* would make two semantically equal states differ by
  count, leaking `H` into `O` and breaking the `O = ⟨V,D⟩` separation;
- leaving it `⊥` forever makes `Cov_NL` unreachable.

Sticky also gives the right `MR_REV` behaviour for free: a trace containing a
clear cannot return to `σ₀`, which is exactly why `c₆ ∉ C_rev`.

**Where it lands.** §4.3 (a sentence on `Dom` for action controls), §4.4, §A.1.

**`[open]`** Is "sticky flag" the general recommendation for action controls, or
should the framework exclude actions from the `Cov_NL` denominator and report
action coverage separately?

---

## 6. Display-only history is a context-management fault

`[deterministic]` for the mechanism; `[N=1]` for the rates.

The benchmark previously sent **no** dialogue history to the mediator. The UI
accumulated and rendered a transcript, but `/api/command` was stateless, so the
model saw one isolated turn while the screen showed a conversation.

Observationally this is **Context Amnesia at `k = 0`**: the §4.8 signature fires
on every multi-turn trace. So it is not a sixth fault class — §4.8 defines
classes by observable behaviour, and this behaviour is already spoken for. What
differs is *cause*, and cause is recoverable only from `P`.

`HISTORY_POLICY` now makes it a dial: `full` | `last-k` | `none`, with `none`
being the seeded fault. Measured back-to-back, identical except for the policy,
the only relation whose verdict changed was context amnesia (`pass` → `fail`).

**Why it matters.** §2.5 already lists "the context-management policy" as a
mediator fault location, so the vocabulary exists. Two points follow:

- It is a realistic, common developer error — the transcript renders, the user
  infers memory, nothing is wired — and it is *independently preventable*,
  unlike summarization-induced amnesia.
- It extends §4.5's localization claim one stage left. `q`, `V′`, `D′` separate
  mediator from application; `P` separates model behaviour from
  context-management policy. An MR_CA violation alone cannot tell you whether
  the model forgot or was never told.

**Where it lands.** §1.2 alongside the five classes (as a cause, not a class);
§4.8; §4.19.1, where "discard information established by an earlier turn" is
already a listed mutation operator — the dial is that operator at four
severities, available without mutation infrastructure; §5.4 for the
dose-response sweep.

**`[open]`** Name it as a distinct class, or keep it as a cause of Context
Amnesia? Against: §4.8 is behaviour-defined. For: it is common, preventable, and
now localizable.

---

## 7. An inflated `W` silently suppresses over-reach reports

`[structural]` — a bug I introduced and then had to fix.

`W(u)` is the denominator of the `fp(u,σ) ⊆ W(u)` standing check. Any control
wrongly included in `W` makes a genuine over-reach look legitimate.

Concretely: the heuristic that derives `W` for a hand-typed utterance treated the
bare word "rating" as implying `minRating`. So for "show electronics under $100
sorted by rating" it produced `W = {category, maxPrice, minRating, sort}` — and
the spurious `minRating = 4`, i.e. **the Figure 1.2 fault itself**, fell inside
`W` and was never reported.

**Why it matters.** §4.6 already says "an utterance whose intended write set is
ambiguous is not admitted". This is empirical support for reading that strictly:
`W` must come from the generation template, and any fallback heuristic must err
*small*. The asymmetry is the point — an under-sized `W` produces false
over-reach reports you will notice, an over-sized one produces silence.

**Where it lands.** §4.6, as a sentence on why `W` is read off the template and
fixed before execution rather than inferred.

---

## 8. `O(σ) = ⟨V,D⟩` forces binary verdicts — is that what you want?

`[open]` — a design question, not a finding.

The previous implementation had a third verdict, `WEAK_PASS`: the product sets
matched but the filter values differed. Under `O(σ) = ⟨V,D⟩` that is simply a
violation, and the new implementation removed it.

But the temptation was real, and worth addressing explicitly: a user only ever
*sees* `D`. A mediator that reaches the right result set through different
control values has arguably served the user correctly while getting the mapping
wrong. `MR_AC` already treats `V` and `D` asymmetrically (point-update on `V`,
containment on `D`), so the machinery for graded observation exists.

Options:
- keep it binary and argue the control mapping *is* the thing under test (the
  current thesis position, and defensible);
- define a weaker companion relation on `D` alone and report both, which would
  separate "wrong controls" from "wrong results".

A concrete case: `maxPrice` 500 vs 400 excludes nothing in this catalog, so `D`
is identical and `V` differs. That is a violation today. Is it a fault?

**Where it lands.** §4.4 or §4.7. Probably deserves an explicit sentence
rejecting the graded option, so a reader who has the same instinct sees it
addressed.

---

## 9. The (N, ε) grid is coarser than it looks, and this subject cannot calibrate it

`[structural]` for the arithmetic, `[open]` for what to do about it.

### 9a. ε only takes effect at multiples of 1/N

Because failure counts are integers, `fails/N > ε` is equivalent to

```
fails ≥ floor(ε·N) + 1
```

so the rule is really "fail if at least *k* of *N* trials fail", and every ε in
`[k/N, (k+1)/N)` behaves identically. The `(N, ε)` space is far smaller than it
appears:

| N | distinguishable ε settings | ε = 0.2 means |
| --- | --- | --- |
| 1 | 1 — **ε is inert** | any failure is a fault |
| 3 | 3 | **any failure is a fault** (`floor(0.6) + 1 = 1`) |
| 5 | 5 | ≥ 2 of 5 |
| 10 | 10 | ≥ 3 of 10 — the §4.19.3 example |
| 20 | 20 | ≥ 5 of 20 |

Two consequences:

- **§5.4's calibration sweep is mostly measuring `N`, not ε.** It proposes
  recalculating "from the first 1, 3, 5, and 10 runs using the candidate
  thresholds", but at N=1 there is one distinguishable threshold and at N=3 there
  are three. ε only becomes a real dial at the larger N.
- **Some (N, ε) pairs give no tolerance at all.** N=3 with ε=0.2 reports a fault
  on a single failing trial — the same rule as ε=0. If a table pairs a small `N`
  with a nonzero ε, a reader may believe noise was tolerated when it was not.

Recommendation: report the pair as `(N, k)` alongside ε, since `k` is what
actually varies. The repo now shows the effective `k` next to the N and ε inputs
so the operative rule is visible rather than implicit.

### 9b. A temperature-0 subject has almost no variance to calibrate against

`(N, ε)` exists to absorb stochastic variation (§4.18, "Stochasticity of LLMs").
But this benchmark pins `temperature = 0` and `top_p = 1`, and every repeated
probe returned identical output (3/3 on each of several utterances). That sample
is far too small to claim determinism — and providers do not guarantee
bit-determinism at temperature 0 regardless — but it does mean the observed
variance is **small and unmeasured**, so failure rates here will cluster at 0
and 1.

Calibrating a noise threshold on a subject with near-zero variance fits ε to
conditions that do not resemble where it will be applied.

**This also affects the mutation plan.** §4.19.5 offers the seeded mutants as the
known-faulty cases for calibrating `(N, ε)` under H2. But a mutation operator
rewrites the emitted command *deterministically*, and the only stochastic stage
is `M`. So at temperature 0 both `r_P(t)` and `r_m(t)` are near 0 or near 1, and
the calibration set contains no noise to tune against either.

Sources of the variance ε is meant to absorb, in rough order of cost:

1. **OpenRouter routing** — already instrumented. If the same request is served
   by different upstream providers, output can differ at temperature 0. The
   `resolved_model` and `provider_name` columns exist precisely to catch this, so
   this is free realistic variance if it occurs; worth checking whether it does
   before assuming it does not.
2. **`temperature > 0` as a declared condition.** `LLM_TEMPERATURE` is already an
   env var and part of `P`, so a sweep over temperature is a config change, and
   `systemPromptHash` plus the temperature column keep the conditions separable.
   This is the controllable option, and it makes "tolerate noise" measurable
   against a known ground truth.
3. **The deployed subjects.** Appendix B.2 documents exactly the phenomenon —
   the same Apartments.com request returning *Miami* in one session and *Chicago*
   in another. Realistic variance, but no ground truth, so it can validate a
   rule rather than calibrate one.

**`[open]`** Should H2's calibration run at `temperature > 0` on the controlled
benchmark, with the fixed `(N, ε)` then applied at temperature 0 and to the
deployed subjects? That would give a calibration set that has both noise and
known truth, which neither of the other two options provides alone.

---

## 10. Preliminary relation results — do not cite yet

`[N=1]` — indicative only, listed so the numbers are not lost. Note from §9a that
at N=1 ε is inert, so these carry no noise tolerance whatsoever.

Baseline prompt, real mediator, one trial per case:

| Relation | Instance | Verdict |
| --- | --- | --- |
| MR_SE | uppercase | **fail** (Figure 1.2) |
| MR_SE | synonym prefix, format suffix | pass |
| MR_SE | clause reorder within one utterance | **fail** |
| MR_AC | refinement | **fail** under baseline (see §3 above — structural) |
| MR_CA | two independent utterances, both orders | **fail** |
| MR_REV | forward + inverse from σ₀ | pass |
| Context amnesia | `full` / `none` | pass / **fail** |

Two are worth chasing at proper `N`:

- **clause reorder** — "sorted by rating" moved to the front changes the result,
  from a single starting state. This is MR_SE, not MR_CA, and it is a *new*
  instance beyond the uppercase one.
- **MR_CA** — failed even with full history, so order sensitivity on independent
  utterances is not merely an artifact of missing context.

`Cov_MR = 100%` (all four relations have a valid instance). `Cov_NL = 83%` in the
MR sweep, because `minRating` appears in the base utterance's `W` and so the
`minRating` refinement clause is filtered out — the metric flagging a gap in the
generated test set, which is the §4.11 behaviour working as intended.

---

## 11. Appendix A and B need edits

`[structural]`

- **A.1 documents `q` as flat** (`{"category": …, "sort": …}`); the
  implementation nests filter fields under `filters`. The appendix is out of step
  with the code, not the reverse.
- **A.1's worked example** (3 products, ids 1–3) holds under the **baseline**
  prompt. Under `extended` the same utterance yields 2, because the spurious
  `minRating=4` excludes the 3.5-star USB-C Hub. If the appendix keeps that
  example, it should name the prompt condition.
- **A.7's `Cov_NL = 3/6`** example is consistent with the implementation.
- **Live URL**: A.1 footnote and Appendix B cite
  `chat-assisted-ecommerce.vercel.app`; the instance is now on Workers.
- **A.3** renders the transition as `u --M--> V′` (two-stage) while §4.5 has the
  three-stage `u --M--> q --Apply--> V′`. The three-stage form is the one the
  code implements and the one that localizes faults.

---

## 12. Measurement caveats to keep in view

- **`LOCAL_TEST_MODE` is stateless by construction.** It parses the current
  utterance alone and ignores `H`, so it behaves like `HISTORY_POLICY=none`
  whatever the policy says. It cannot be used to measure amnesia, MR_AC, MR_CA or
  MR_REV — only to check that a relation *runs*.
- **Call accounting is not 2N per case.** MR_CA and the amnesia case run
  multi-utterance traces; §4.18's "2N (4N for MR_CA)" should be stated as a
  function of trace length. The panel computes it per instance.
- **One model, one day.** Everything above is `gpt-4o-mini`. §5.7's
  cross-mediator study is what would separate mediator-specific from shared
  faults, and the model picker plus `resolved_model` column exist for it.
- **`resolvedModel` is recorded separately from `requestedModel`** because
  OpenRouter may serve something else. No divergence observed yet, but the column
  is the guard §4.17 asks for.

---

## Reproducing any of this

```bash
nvm use && npm ci
npm test                      # 58 tests; includes the pinned baseline prompt

# Figure 1.2, against the live instance
curl -s -X POST https://lngui-ecommerce.ninadpchaudhari.workers.dev/api/command \
  -H 'content-type: application/json' \
  -d '{"prompt":"show electronics under $100 sorted by rating","history":[]}' | jq '.filters.minRating'
# -> null ; the same utterance uppercased -> 4

# the amnesia dial
HISTORY_POLICY=none  npm run dev     # then a two-turn refinement in the UI
HISTORY_POLICY=full  npm run dev
```

The prompt trade-off in §2 is reproduced by flipping `PROMPT_VARIANT` between
`baseline` and `extended` and re-running the MR panel; `systemPromptHash` in each
record identifies which condition produced it.
