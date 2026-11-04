# helpful_utility_to_generate_cases/: a small help to write `cases/`

The tester reads the model, `shop.toml`, and writes the test cases. Each control is one test
requirement, and every relation must cover every control it admits. This folder only saves typing.

`make.py` holds the sentences we wrote by hand for each control (one value other than its start value; a sentence that sets
it, a rewording, an undo, and a phrase that adds it to another sentence). Set `CONTROL` at its top, or pass the
control, and it prints that control's cases for every relation, each rule applied to its sentences. Paste each block
into the file it names; each block starts with a `# ── C = <control>` line, so the cases of one control stay together.

```bash
python3 helpful_utility_to_generate_cases/make.py maxPrice    # prints maxPrice's cases, to paste into cases/
python3 harness/run.py --check                                 # checks every case, and prints each relation's coverage
```

A case that pairs two controls (MR_CA, MR_COMP's "a and b") is printed under the first of them in `shop.toml`, so
each pair appears once.
