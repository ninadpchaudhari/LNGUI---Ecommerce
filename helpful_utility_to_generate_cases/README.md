# helpful_utility_to_generate_cases/: boilerplate to generate `cases/`

*The Problem*: We need a way to automate the generation of these test cases, by rules a methodology can state.

*As a tester*, this is a generator utility that turns the app's templates into test cases. Nothing is picked by hand
or at random: every case follows from three choices, stated once, and one rule per relation.

### Mode of operation

- `sentences.toml` holds every sentence the cases use: one value per control, and the app's templates filled with it
- One folder per relation, whose `make.py` combines those sentences by its rule into `<relation>.out.toml`
- We then copy that into `cases/` (as `<relation>.toml`).

## Run

TLDR: Install the requirements, then run `make.py` in each relation folder, then copy the output into `cases/`.

```bash
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

# Check the value set (prints every value set that satisfies the rule)
python helpful_utility_to_generate_cases/values.py

# Generate cases for every relation.
for m in helpful_utility_to_generate_cases/*/make.py helpful_utility_to_generate_cases/*/*/make.py; do
	.venv/bin/python "$m"
done

# Review, then copy the output into cases/
for f in helpful_utility_to_generate_cases/*/*.out.toml helpful_utility_to_generate_cases/*/*/*.out.toml; do
	cp "$f" "cases/$(basename "$f" .out.toml).toml"
done
```

## How the cases are made

### Three choices, stated once (`sentences.toml`)

1. **One value per control**, kept only if every pair of the four filters, together, still narrows the products shown
   and leaves some. That makes every constraint δ that MR_AC adds remove products without removing all of them.
   `values.py` checks this against the catalog: 7 value sets pass. We use one: **electronics, $100, 4 stars, in stock,
   sort by rating**. Filled in, "show {category} under {maxPrice} sorted by {sort}" is Figure 1.2's sentence.
2. **The sentences** are the app's templates (`app/control-surface.yaml`), each filled with that value: 8 sentences.

   | Control | Sentences | δ (MR_AC, MR_COMP) | Undo (MR_REV) |
   |---|---|---|---|
   | category | "show electronics items", "filter to electronics only" | "in electronics" | "show all categories" |
   | maxPrice | "show items under $100", "show items cheaper than $100" | "under $100" | "remove the price limit" |
   | minRating | "show items rated 4 stars and up" | "rated 4 stars and up" | "remove the rating filter" |
   | inStockOnly | "hide out-of-stock items" | "that are in stock" | "show out-of-stock items again" |
   | sort | "sort by rating", "order the results by rating" | (none: it does not narrow) | "use the default order" |

   "First sentence" below means the first in each row. The undo sentences of category, maxPrice, minRating and sort
   are new; the app's templates had one only for inStockOnly.
3. **Clear Filters is left out**: said from σ0 it changes nothing, and it cannot be undone.

### One rule per relation

| Relation | Rule | Cases |
|---|---|---|
| MR_CE | every pair of templates of one control (3); every template with the value's other phrase, "rating" / "best rated first" (2); the 3 reviewed pairs of the app's Gold_Syn; every macro on every sentence it fits, of the 8 and Figure 1.2's (24) | 32 |
| MR_AC | every constraining control's first sentence as the base, with the δ of each other constraining control (4 × 3) | 12 |
| MR_CA | every pair of the 5 controls, by their first sentences, in both orders | 10 |
| MR_COMP | every first sentence said twice (5); MR_AC's 12 pairs as two turns, the base then δ alone (12); the same with "sort by rating" as a third turn (12) | 29 |
| MR_REV | every control's first sentence, then its undo | 5 |
| CONTEXT_AMNESIA | every control's first sentence, then the other four controls' first sentences | 5 |
| | | **93** |

**To have more cases:** add a second value set that `values.py` passes (for example sports, $50, 4 stars). Every rule
then repeats on those values, about 93 more cases. Nothing else changes.

`writes` (the controls a sentence changes) comes from the same place: a sentence changes the control it is the
template of; a δ changes its control; a joined sentence changes what all its parts change.

## How each relation's cases are built

### MR_CE (32): same command, said another way

- `make.py`: the template pairs and phrase pairs come from `sentences.toml`
- `reviewed.toml`: the app's Gold_Syn, three paraphrases a person accepted on review (one is Figure 1.2's sentence,
  "list the tech products below $100, best rated first"). They keep their own values ("show books")
- `control-agnostic.toml`: 4 macros: uppercase, "show …" → "display …", "… in a table", the sort clause first. A
  macro is skipped on a sentence it does not fit ("display" needs a sentence that starts with "show"; the sort clause
  only Figure 1.2's sentence has). That gives uppercase 9, table 9, display 5, sort clause first 1
- Figure 1.2's uppercase form is the proposal's motivating failure

### MR_AC (12): a base command vs the same with a constraint added

- case = u vs "u δ"; `refine` is δ's control and value. "show electronics items" vs "show electronics items that are
  in stock"

### MR_CA (10): two independent commands, either order

- case = a, b vs b, a

### MR_COMP (29): commands in turn vs one sentence

- `control-agnostic.toml`: how turns are joined: "{a} {b}", "{a} {b} sorted by {c}"
- a δ said alone as a later turn ("under $100") adds to what the conversation already asked for

### MR_REV (5): do, then undo

- case = nothing said (σ0) vs u, then its undo

### CONTEXT_AMNESIA (5): MR_CA over more turns

- case = u1 vs u1, then the four others; what u1 set must stay

## Code

- `sentences.toml`: the value set and the templates; `values.py`: checks the value set against the catalog
- `app.py`: `load_sentences()` fills the templates; `constraint_pairs()` gives MR_AC's and MR_COMP's 12 pairs;
  `save()` writes the cases (tomlkit)
- `make.py`: one small function per kind of case, then a few lines that apply the rule

The pilot set the paper's earlier runs used (100 cases, a seeded pick by the earlier generator) is in
`z_extra/validation/pilot-cases/`.
