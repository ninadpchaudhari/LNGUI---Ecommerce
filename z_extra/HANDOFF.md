# Handoff: bring lngui-ecommerce in line with what lngui-homeassistant became (2026-10-25)

Ninad reworked `../lngui-homeassistant` on 2026-10-25 for **readability for a human reviewer**: fewer moving parts,
plain names, files that say what they do, and data a person can write by hand. These are the same moves for this repo.
Each is a proposal: **show Ninad the result before replacing anything**, and keep the checks listed under each.

**Ground rules** (from `../CLAUDE.md`, with Ninad's later decisions):
- This repo is evidence. Verdict logic and record formats change only with Ninad's explicit OK. **Compatibility with
  lngui-homeassistant is no longer required** ("that's changing too"), and neither is the old record shape, but every
  change must be shown to leave verdicts identical (see "How to check", below).
- Commit small. Never push unless Ninad asks.
- Plain English first; user-facing words come from `../docs/GLOSSARY.md`. When a record field or format changes,
  update `../docs/FORMATS.md` and add a line to `../docs/REVIEW-NOTES.md`.
- What Ninad pushed back on, so don't propose it: rule strings or a mini expression language for relations ("vocab
  growth is bad"), Pkl ("too complicated"), `@name` groups in case files, generated or anchored config files,
  timestamps in run folder names, "smart" merge/combine tooling, long READMEs.

## 1. Cases: hand-kept TOML, one file per relation

**Now:** `cases/pilot.jsonl` (100 cases, one JSON line each) is produced by `shared/generate.ts` (573 lines) and
`scripts/gen-cases.ts`, plus `pilot.manifest.json` and `pilot.rejected.jsonl`. No one can read or write a case by hand.

**Proposal** (as `../lngui-homeassistant/cases/*.toml`):
```toml
# MR_AC: … what the relation checks …
# Precondition (checked when the file is read): Refine(u_ref, u_base, δ): …

relation = "MR_AC"

# ── in-stock restriction ─────────────────────────
# Rule: a "show <category>" sentence, then the same with "that are in stock" added.

[[case]]
id = "AC-001"
description = "filter to electronics, then only in stock"
source = "filter to electronics only"                         # one utterance can be a plain string
followup = "filter to electronics only that are in stock"
[case.writes]                                                 # must come last in a case (TOML)
"filter to electronics only"                     = ["category"]
"filter to electronics only that are in stock"   = ["category", "inStockOnly"]
```
- The rule that produced a group is a **comment** above it; hand-written cases need no header.
- Drop fields nothing reads: in HA these were `predicate`, `semanticGroup`, `strata` (kept only the one flag the
  report uses, as a boolean), `legacyName`, `provenance`, `agentHint`. **Check first** which ones this repo's report,
  judge and `scripts/oracles.ts` actually read (`grep`); `MR_AC` here needs its `refinement {control, value}` — keep
  it as fields in the TOML case.
- A loader (`smol-toml`, local npm) builds the internal case and runs each relation's precondition; a bad case stops
  the sweep. Each run stores the cases it used as `cases.jsonl` inside the run folder.
- **Before deleting the generator:** convert, then prove the loaded cases equal `pilot.jsonl` field by field (deep
  comparison; in HA a shallow JSON.stringify with a key list silently skipped nested fields). Then delete
  `generate.ts`, `gen-cases.ts`, `pilot.*` and the template sections of `control-surface.yaml`.
- The paper's method then says the pilot set was made by stated rules, written next to their cases, and is reviewed
  by hand. Ninad agreed: "the generator can be a human … an algorithm a human can trace".

## 2. Relations: one file per relation, written as its row of Table 4.2

**Now:** `shared/relations.ts` has one `check()` switch for all relations, preconditions live elsewhere
(`shared/cases.ts`), and nothing reads like the proposal.

**Proposal** (as `../lngui-homeassistant/src/relations/`):
- `relations/predicates.ts`: `Para`, `Indep`, `Rev`, `Comp`, `Refine`, each citing its equation (4.17–4.21) and saying
  **exactly what is checked** from a case file (HA can only check W(u), not target(u); here templates may give target
  values — say which).
- `relations/MR_CE.ts` … one per relation, each opening with
  ```ts
  // MR_CE: Control Equivalence (Table 4.2). Exposes phrasing sensitivity.
  //   Precondition   Para(u1, u2)
  //   Postcondition  O(σ –u1→ σ′) = O(σ –u2→ σ″)
  ```
  and holding `precondition(source, followup)` (named requirements: `["Para(u1, u2)", Para(u1, u2)]`),
  `postcondition(source, followup, case)` (named checks whose name is the failure reason), and `noEffect`.
- Reasons in records become the name of the failed check (e.g. "δ was ignored: …"). Verdicts must not change.
- Vocabulary types in one `model/types.ts` (no functions); helpers on state in `model/state.ts`.

## 3. MR_AC: make sure the base can actually run (lesson from HA)

In HA, every MR_AC case was **invalid by construction**: `u_base` ("turn on all the lights") was a command neither HA
nor the model could carry out (both asked "which room?"), so every trial failed as leakage when nothing had been
compared. Fix there: `u_base` became a command the app supports ("turn on the ground floor lights") and
`u_ref = u_base ⊕ "in the <room>"`. Result: HA's own matcher ignores the room (real constraint leakage).

**For this repo:** check from recorded runs that every MR_AC `u_base` actually changes V on the deterministic /
local-test condition. If a base never runs, the case tests nothing; rewrite it. This repo's MR_AC matches the
proposal (V_ref = V_base[d ↦ w] ∧ D_ref ⊆ D_base), which HA could not (no constraining controls; there V shrinks and
there is no D). Ninad's framing for both: the refined state is the base state with exactly δ's effect.

## 4. "Vacuous" → "passed with no effect"

HA renamed the flag `vacuous` → `noEffect`, shown as "Passed with no effect" (glossary updated). If this repo records
or reports a vacuous flag (`grep vacuous`), rename it the same way.

## 5. Results a person can read: `runs/<run>/results.toml`

One line per case per condition, next to the JSONL (which stays the complete record):
```toml
[condition."gpt-4o-mini-default".cases]
"AC-002" = { trials = "○○●○○○○○○○", fails = 9, first = "V is not the expected point update — an earlier constraint moved" }
"CE-004" = { trials = "●●●●●●●●●●", fails = 0 }
```
● pass · ○ fail · ◌ passed with no effect · ! infra. See `../lngui-homeassistant/src/report/results-toml.ts`.

## 6. Running: fewer files, fixed names

HA moved from experiment files + timestamped run folders to: `config.yml` (cases folder, N, seed) and the conditions
that are up; runs go to `runs/n<N>/`, re-running replaces, no cases pin. Here conditions are env blocks in
`experiments/*.json`, which already reads well; **ask Ninad** before changing that. If runs here use timestamped
folders, propose fixed names the same way.

## How to check a change leaves verdicts identical

The judge is pure, so check it **statically**, no live run needed (`../lngui-homeassistant` did this):
1. Put the last commit beside the new code: `git worktree add --detach <scratch>/old HEAD` (symlink `node_modules`).
2. Compare old and new on (a) every real case's precondition, (b) a few thousand randomly broken cases,
   (c) ~200,000 random traces built on real cases' write sets, (d) every recorded trace in `results/`/`runs/`, and
   (e) the recorded verdicts. Require zero differences in pass/fail and the no-effect flag. Reasons may change.
3. Only plumbing changes (the sweep, the server) need a live before/after run.

## Pointers

- HA after the change: `../lngui-homeassistant/README.md`, `src/relations/`, `cases/*.toml`, `src/report/results-toml.ts`.
- Its log of these steps: `../lngui-homeassistant/docs/verification-log.md` (entries dated 2026-10-25).
- Shared format notes: `../docs/FORMATS.md`, `../docs/REVIEW-NOTES.md` §8–9.
