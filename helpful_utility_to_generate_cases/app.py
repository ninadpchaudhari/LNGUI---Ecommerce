"""
What every helpful_utility_to_generate_cases/<relation>/make.py shares: the sentences of sentences.toml, and saving cases.
"""
import tomllib
from pathlib import Path

import tomlkit  # writes TOML (Python's standard library only reads it): pip install -r helpful_utility_to_generate_cases/requirements.txt

HERE = Path(__file__).parent


def fill(template, phrase):
    return template.replace("{v}", phrase)


def load_sentences():
    """
    sentences.toml, with every template filled with its control's first phrase. Returns (controls, figure):
      controls  {control: {"value", "phrases", "templates", "undo", "sentences", "first", "delta"}}, in file order:
                "sentences" are the filled templates, "first" is the first of them, "delta" is None if it has none
      figure    Figure 1.2's sentence, filled with the same phrases
    """
    data = tomllib.load(open(HERE / "sentences.toml", "rb"))
    figure = data.pop("figure")
    controls = {}
    for control, c in data.items():
        phrase = c["phrases"][0]
        sentences = [fill(t, phrase) for t in c["templates"]]
        controls[control] = {**c, "sentences": sentences, "first": sentences[0],
                             "delta": fill(c["delta"], phrase) if "delta" in c else None}
        figure = figure.replace("{" + control + "}", phrase)
    return controls, figure


def constraint_pairs(controls):
    """Every control with a δ (the constraining ones) as the base, with each other one's δ: [(base, d)], 4 × 3 = 12."""
    constraining = [c for c in controls if controls[c]["delta"]]
    return [(base, d) for base in constraining for d in constraining if d != base]


def save(path, relation, cases):
    """Write the cases in the same format as cases/<relation>.toml, so the harness reads them as is."""
    numbered = []
    for number, case in enumerate(cases, start=1):
        case = {"id": f"{relation}-{number:03d}", **case}  # MR_CE-001, then the case's own keys
        if "refine" in case:
            refine = tomlkit.inline_table()
            refine.update(case["refine"])
            case["refine"] = refine
        case["writes"] = case.pop("writes")  # [case.writes] is a table, so it must come last
        numbered.append(case)
    with open(path, "w", encoding="utf-8") as f:
        tomlkit.dump({"relation": relation, "case": numbered}, f)
    print(path.name, len(cases), "cases")
