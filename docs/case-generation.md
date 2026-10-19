# How the MR cases are generated

This note records how `npm run gen:cases` builds the frozen test set in
`cases/pilot.jsonl`, how that compares with the generator in Chapter 4 of the
proposal ("Generating … Inputs"), and why two deviations are kept. Section
references are to the proposal. The prose avoids semicolons and author names
so it can move into the dissertation with light editing.

## Pipeline

The generator runs three steps. The code is in
[`scripts/lib/generate.ts`](../scripts/lib/generate.ts).

1. **Candidates.** `generateCandidates()` fills the templates, refinement
   clauses, surface transforms and reviewed pairs of `control-surface.yaml`
   (`Γ_app`, §4.10.2) with values from each control's domain.
2. **Admission.** Every candidate passes through `validateCase`
   ([`shared/cases.ts`](../shared/cases.ts)), which checks the relation's
   precondition from generation labels alone (§A.4). The AC narrowing filter
   (Deviation 2) runs here too. Every dropped candidate goes to
   `cases/pilot.rejected.jsonl` with its reason.
3. **Selection.** `selectCases` draws, with a fixed seed, up to 10 semantic
   groups per pool and up to 2 cases per group. A semantic group is one
   control situation, such as `category=books`. Two cases in one group differ
   only in wording or value, so the analysis clusters them.

Seed 1 gives the following test set.

| Pool | Report row | Cases | Utterances per pass | Groups available |
| --- | --- | ---: | ---: | ---: |
| `CEP` | `MR_CE (para)` | 13 | 26 | 17 |
| `CES` | `MR_CE (surface)` | 21 | 42 | 23 |
| `AC` | `MR_AC` | 20 | 40 | 12 |
| `CA` | `MR_CA` | 20 | 80 | 10 |
| `CTX` | `MR_CA (context amnesia)` | 6 | 24 | 3 |
| `REV` | `MR_REV` | 1 | 2 | 1 |
| `COMP` | `MR_COMP` | 19 | 65 | 23 |
| | | **100** | **279** | |

`CEP` and `COMP` fall short of 20 because some groups hold one case only.
`CES` holds 21 because the Figure 1.2 case is pinned on top of the random
quota.

## Comparison with the proposal

| Predicate | Proposal | Implementation | Status |
| --- | --- | --- | --- |
| `Para` (MR_CE) | Two sentence patterns for one control, filled with one value. Candidates from an LLM paraphraser, back-translation and translation, admitted to `Gold_Para` after review. | Template pairs and two phrasings of one value (`ce:para`). The three reviewed pairs already in `Gold_Syn`. Surface transforms in a separate family (`ce:surface`). | Template part matches. LLM, back-translation and translation not built yet. Surface family added (Deviation 1). |
| `Refine` (MR_AC) | Append a clause δ for a constraining control the base does not target. | Same rule, plus a filter on the deterministic result set. | Matches, plus Deviation 2. |
| `Indep` (MR_CA) | Two utterances with disjoint intended write sets, run in both orders. | Same rule. | Matches. |
| `Rev` (MR_REV) | A forward template and a paired inverse for each control in `C_rev`. | Same rule. The YAML pairs one inverse only (`inStockOnly`). | Matches. Coverage limited by the YAML. |
| `Comp` (MR_COMP) | `n ≥ 2` absolute templates as separate turns, joined into one sentence. Idempotence repeats one template. | Two- and three-turn sequences joined into one sentence, and `⟨u, u⟩` against `u`. | Matches. |
| Context amnesia (MR_CA’s context-amnesia extension) | Table 4.3 defines the fault class: `u₁` sets a control, a later turn with `W(u₂) ∩ fp(u₁) = ∅` must leave it alone. | `u₁` from a constraining template, then two sort turns. Included by default and reported as `MR_CA (context amnesia)`. | Follows Table 4.3. The proposal gives no separate generator. |

## Deviation 1: a surface-transform family for MR_CE

**What the generator does.** It applies fixed functions to one utterance and
pairs the result with the original. The functions are uppercasing, replacing
"show" with "display", appending " in a table", and moving a trailing sort
clause to the front. The generator applies them to single-control template
utterances and to five multi-control utterances in the shape of Figure 1.2.

**Why the precondition holds.** Each function leaves the requested control
values unchanged. Both utterances share one target, so `Para` holds by
construction and needs no reviewer (§4.10.1).

**Why the family belongs in the study.** The Interpretations section lists
"a surface change, such as writing in all capital letters" as a cause of
phrasing sensitivity. Figure 1.2 is exactly that failure. The template-pair
generator never produces it, because both of its utterances share one surface
form apart from the template words. METAL and LLMorph use fixed perturbation
functions in the same role~\cite{hyun2024metal,cho2025metamorphic}.

**How the study keeps it apart.** The family has its own selection pool, its
own quota and its own report row, `MR_CE (surface)`. The `MR_CE (para)` row
alone answers for the proposal's generator. Each case keeps its
`transform:<id>` tag, so results can also split by function.

**Figure 1.2 is pinned.** The uppercase pair for "show electronics under $100
sorted by rating" enters every test set, whatever the seed. A pilot that cannot
reproduce the motivating failure cannot test it.

**Known limits.** Moving the sort clause produces less natural sentences,
such as "sorted by name show clothing under $100". The suffix " in a table"
asks for a presentation the application has no control for, so the expected
outcome is that no control changes.

## Deviation 2: AC cases must narrow the result set

**What the generator does.** For each candidate it computes the intended
result sets with the application logic `A`: `D_ub` for the base and `D_ur`
for the refined request. It drops the candidate when `D_ur` is empty or no
smaller than `D_ub`.

**Why.** The MR_AC postcondition has two clauses, `V_ur = V_ub[d ↦ w]` and
`D_ur ⊆ D_ub`. When the refinement leaves the result set unchanged, the
containment clause holds for any mediator behaviour that keeps the base
results. An empty refined set satisfies containment against every base. Such
a case tests the valuation clause only.

**Why the filter does not bias the comparison.** The filter reads the
deterministic application and the intended values from the templates. It
never calls the mediator, so no mediator outcome influences which cases enter
the test set.

**Effect.** The filter drops 57 of 223 AC candidates. 53 do not narrow the
result set and 4 empty it. `cases/pilot.rejected.jsonl` lists each one, for
example "show electronics items under $200".

**Known limit.** The dropped value combinations still occur in real use. On
those combinations the valuation clause goes untested by this test set.

## Gaps against the proposal

- **LLM paraphrase, back-translation and translation for `Para`.** The
  proposal names these generators. They need a paraphrasing model and a
  review step that admits pairs to `Gold_Para`. They are not built yet.
- **Inverse templates for MR_REV.** Only `inStockOnly` has one. Inverse
  templates for `category`, `maxPrice`, `minRating` and `sort` would give five
  semantic groups.
- **Context amnesia depth.** The generator has three groups (`category`,
  `maxPrice`, `minRating`), each followed by two sort turns. Longer gaps and
  other filler controls would widen it.

## Reproducing the test set

```bash
npm run gen:cases -- --out cases/pilot.jsonl --groups 10 --per-group 2 --seed 1
```

The command prints the file's SHA-256. The sweep records that hash and
refuses to resume a run against a changed cases file. Pass `--no-amnesia` to
leave context amnesia out.
