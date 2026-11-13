"""
Makes the design from the lexicon: lexicon.toml → design/<relation>.toml.

    python make_design.py

The lexicon holds what the tester writes by hand: a base utterance and its target for each control, plus the gold
inputs (rewordings, pronoun splits, undo utterances, area commands, pairs, sequences). This script applies each
relation's transformations to it and computes every follow-up's target from its source's, with the override ▷:
a later target overwrites an earlier one on the controls it names.

  MR_CE            Paraphrase (gold): u vs each rewording.   Edit (mechanical): u vs each edit of u.   Same target.
  MR_CA            Swap: a, b vs b, a, for each pair.                                    Each keeps its target.
  MR_COMP          Repeat: u, u vs u.   Conjoin: a, b vs "a and b" (t_a ▷ t_b).   Pronoun split (gold).
  MR_REV           Undo: nothing vs u, back; back sets u's controls to their start values.
  MR_AC            Restrict: an area command vs it restricted to one room (Home Assistant); u vs u plus another
                   control's narrow phrase, t_u ▷ t_δ (shop).
  CONTEXT_AMNESIA  Append: u vs u then three others, for each sequence.

A case keeps its id from the current design/ when it has the same relation, source and follow-up; a new one gets the
next number. Then run blind.py to make cases/ from the design.
"""
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROOT = ROOT.parent if ROOT.name == "scripts" else ROOT  # scripts/make_design.py (Home Assistant) or make_design.py (shop)
LEX = tomllib.load(open(ROOT / "lexicon.toml", "rb"))
SPEC = ROOT / ("home.toml" if (ROOT / "home.toml").exists() else "shop.toml")
ORDER = ["MR_CE", "MR_CA", "MR_COMP", "MR_REV", "MR_AC", "CONTEXT_AMNESIA"]


def start_values():
    spec = tomllib.load(open(SPEC, "rb"))
    if "device" in spec:
        return {f"{d}.{k}": x["start"] for d, v in spec["device"].items() for k, x in v.items() if isinstance(x, dict)}
    return {c: x.get("start", "unset") for c, x in spec["control"].items()}


START = start_values()


def controls(table=LEX, path=()):
    """The [control] or [device.control] blocks of the lexicon, in order: {name: block}."""
    out = {}
    for k, v in table.items():
        if isinstance(v, dict):
            if "u" in v and "target" in v:
                out[".".join(path + (k,))] = v
            elif k != "area_command":
                out |= controls(v, path + (k,))
    return out


C = controls()


def said(u, target):
    return {"u": u, "target": dict(target)}


def base(c):
    return said(C[c]["u"], C[c]["target"])


def override(*targets):
    """t_1 ▷ t_2 ▷ ...: later targets overwrite earlier ones on the controls they name."""
    out = {}
    for t in targets:
        out |= t
    return out


def edit(template, u):
    return u.upper() if template == "{u|upper}" else template.replace("{u}", u)


def cases():
    """Every case of every relation: (relation, source trace, follow-up trace, extra fields)."""
    out = []
    for c, blk in C.items():
        u = base(c)
        for w in blk.get("reword", []) + [edit(e, u["u"]) for e in LEX["edits"]]:
            out.append(("MR_CE", [u], [said(w, u["target"])], {}))
    for a, b in LEX["pairs"]:
        out.append(("MR_CA", [base(a), base(b)], [base(b), base(a)], {}))
    for c in C:
        out.append(("MR_COMP", [base(c), base(c)], [base(c)], {}))
    for a, b in LEX["pairs"]:
        joined = LEX["join"].replace("{a}", C[a]["u"]).replace("{b}", C[b]["u"])
        out.append(("MR_COMP", [base(a), base(b)], [said(joined, override(C[a]["target"], C[b]["target"]))], {}))
    for c, blk in C.items():
        if "pronoun" in blk:
            first, second = blk["pronoun"]
            t = list(blk["target"].items())
            out.append(("MR_COMP", [said(first, t[:1]), said(second, t[1:])], [base(c)], {"needsHistory": True}))
    for c, blk in C.items():
        if "undo" in blk:
            set_ = said(blk["undo"].get("u", blk["u"]), blk["undo"].get("target", blk["target"]))
            back = said(blk["undo"]["back"], {k: START[k] for k in set_["target"]})
            out.append(("MR_REV", [], [set_, back], {}))
    for area in LEX.get("area_command", []):
        whole = said(area["u"], override(*area["rooms"].values()))
        for template in LEX["restrict"]:
            for room, t in area["rooms"].items():
                out.append(("MR_AC", [whole], [said(template.replace("{u}", area["u"]).replace("{area}", room), t)], {}))
    for c, blk in C.items():
        if "narrow" in blk:
            for d, other in C.items():
                if d != c and "narrow" in other:
                    u = base(c)
                    out.append(("MR_AC", [u], [said(f"{u['u']} {other['narrow']}", override(u["target"], other["target"]))], {}))
    for first, *later in LEX["sequences"]:
        out.append(("CONTEXT_AMNESIA", [base(first)], [base(x) for x in [first, *later]], {}))
    return out


def trace_key(trace):
    return json.dumps([t["u"] for t in trace])


def current_ids():
    """{(relation, source, follow-up): id} from the design files there now."""
    ids = {}
    for f in (ROOT / "design").glob("*.toml"):
        d = tomllib.load(open(f, "rb"))
        for c in d["case"]:
            for fo in c["followup"]:
                ids[(d["relation"], trace_key(c["source"]), trace_key(fo["trace"]))] = fo["id"]
    return ids


def toml_value(v):
    return json.dumps(v, ensure_ascii=False)


def toml_key(k):
    return k if k.replace("_", "").isalnum() else json.dumps(k)


def utterance(t):
    inner = ", ".join(f"{toml_key(c)} = {toml_value(v)}" for c, v in t["target"].items())
    return f"  {{ u = {toml_value(t['u'])}, target = {{ {inner} }} }},"


HEADER = """# {rel}: the design of the {rel} cases, made by make_design.py from lexicon.toml: do not edit here.
# Each utterance has its target: the controls it sets, and to what. Cases that share a source list it once.
# blind.py makes cases/{rel}.toml from this file, the same cases without the values. No oracle reads the values;
# judge/truth.py uses them to grade the oracles.
"""


def write(relation, found, ids):
    used = [int(i.rsplit("-", 1)[1]) for i in ids.values() if i.startswith(relation + "-")]
    last = max(used, default=0)
    groups = {}
    for _, source, followup, extra in found:
        key = (relation, trace_key(source), trace_key(followup))
        if key not in ids:
            last += 1
            ids[key] = f"{relation}-{last:03d}"
        groups.setdefault(json.dumps(source), (source, []))[1].append((ids[key], followup, extra))
    lines = [HEADER.format(rel=relation), f'relation = "{relation}"']
    for source, followups in groups.values():
        lines += ["", "[[case]]", "source = ["] + [utterance(t) for t in source] + ["]"]
        for id_, followup, extra in sorted(followups, key=lambda f: f[0]):
            lines += ["", "[[case.followup]]", f'id = "{id_}"']
            lines += [f"{k} = {toml_value(v)}" for k, v in extra.items()]
            lines += ["trace = ["] + [utterance(t) for t in followup] + ["]"]
    (ROOT / "design" / f"{relation}.toml").write_text("\n".join(lines) + "\n")
    print(f"design/{relation}.toml: {len(found)} cases")


if __name__ == "__main__":
    ids = current_ids()
    everything = cases()
    (ROOT / "design").mkdir(exist_ok=True)
    for relation in ORDER:
        write(relation, [c for c in everything if c[0] == relation], ids)
