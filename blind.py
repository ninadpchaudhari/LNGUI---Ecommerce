"""
Makes the test cases from the design: design/<relation>.toml → cases/<relation>.toml.

    python blind.py

The design gives every utterance its target: the controls it sets, and to what. The test cases keep the utterances and
only the controls (W(u), [case.writes]): the values are removed, because an MR test needs only which controls each
utterance changes. The design stays as the answer key; no oracle reads it.

Each follow-up in the design becomes one case with its own id, so results recorded against cases/ still match.
Derived on the way: `devices` (the devices of the controls, when controls are <device>.<control>), and for MR_AC,
`refine` (the one control, and its value, that the follow-up adds to the source).
"""
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROOT = ROOT.parent if ROOT.name == "scripts" else ROOT  # scripts/blind.py (Home Assistant) or blind.py (shop)


def q(v):
    """A TOML value: JSON's strings, numbers, booleans and lists are TOML's too."""
    return json.dumps(v, ensure_ascii=False)


def side(trace):
    """One utterance is written as a string, several (or none) as a list, as in the cases so far."""
    said = [t["u"] for t in trace]
    return q(said[0]) if len(said) == 1 else q(said)


def case(relation, source, followup):
    writes = {}
    for t in source + followup["trace"]:
        writes.setdefault(t["u"], list(t["target"]))
    lines = ["[[case]]", f'id = "{followup["id"]}"']
    controls = [c for w in writes.values() for c in w]
    if all("." in c for c in controls):
        lines.append(f"devices = {q(sorted({c.split('.')[0] for c in controls}))}")
    lines += [f"source = {side(source)}", f"followup = {side(followup['trace'])}"]
    if followup.get("needsHistory"):
        lines.append("needsHistory = true")
    if relation == "MR_AC":
        base = {c: v for t in source for c, v in t["target"].items()}
        added = {c: v for t in followup["trace"] for c, v in t["target"].items() if c not in base}
        if len(added) == 1:
            (control, value), = added.items()
            lines.append(f"refine = {{control = {q(control)}, value = {q(value)}}}")
    lines += ["", "[case.writes]"] + [f"{q(u)} = {q(w)}" for u, w in writes.items()]
    return "\n".join(lines)


def blind(path):
    design = tomllib.load(open(path, "rb"))
    relation = design["relation"]
    cases = [case(relation, c["source"], f) for c in design["case"] for f in c["followup"]]
    out = ROOT / "cases" / path.name
    header = f"# Made by blind.py from design/{path.name}: do not edit here, edit the design and run blind.py again.\n"
    out.write_text(header + f'relation = "{relation}"\n\n' + "\n\n".join(cases) + "\n")
    print(f"cases/{path.name}: {len(cases)} cases")


if __name__ == "__main__":
    for path in sorted((ROOT / "design").glob("*.toml")):
        blind(path)
