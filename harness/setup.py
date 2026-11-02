"""
Starts the app's server for one configuration, in the background, and checks it is the shop the harness expects.
Safe to run again: a server already answering on the configuration's port is only checked.

    python harness/setup.py <config>        (configs/<config>.env; stop it: kill the pid it prints)

    1. settings   configs/<config>.env: the model and its settings, and the port. A setting the file leaves out is unset:
                  app/.env (which holds only the API keys) never fills it. PROMPT=<file> sends app/prompts/<file>
                  instead of the server's default prompt (app/prompts/default.txt)
    2. start      npx tsx server.ts (in app/) with those settings; its log goes to servers/<config>.log
    3. check      the server's controls and start values are exactly shop.toml's, and its model settings are the file's
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request

from shop import ROOT, load_shop, settings

# The settings that decide what the mediator is (app/shared/overrides.ts). Each one a config file leaves out is set to
# empty, which the server reads as unset, so a key left in app/.env cannot change the configuration.
MODEL_SETTINGS = ["LLM_PROVIDER", "LLM_MODEL", "OPENROUTER_MODEL", "OPENAI_MODEL", "OLLAMA_MODEL", "SYSTEM_PROMPT",
                  "LNGUI_COMMAND_MODE", "LLM_TEMPERATURE", "LLM_TOP_P", "LLM_REASONING_EFFORT", "HISTORY_POLICY",
                  "HISTORY_MAX_TURNS", "LOCAL_TEST_MODE"]

if len(sys.argv) != 2 or not (ROOT / "configs" / f"{sys.argv[1]}.env").exists():
    raise SystemExit("which configuration? python harness/setup.py <config>, one of configs/*.env")
CONFIG = sys.argv[1]
SETTINGS = settings(CONFIG)

# PROMPT=<file>: the server gets that file's text as SYSTEM_PROMPT, and the reply format its header names ("---",
# "implementation: diff" or "full", "---") as LNGUI_COMMAND_MODE. The header itself is never sent to the model.
if "PROMPT" in SETTINGS:
    raw = (ROOT / "app" / "prompts" / SETTINGS.pop("PROMPT")).read_text(encoding="utf-8")
    header = re.match(r"---\nimplementation: (diff|full)\n---\n", raw)
    if not header:
        raise SystemExit("the prompt file must start with ---, implementation: diff or full, ---")
    SETTINGS["LNGUI_COMMAND_MODE"], SETTINGS["SYSTEM_PROMPT"] = header[1], raw[header.end():]
URL = f"http://localhost:{SETTINGS['PORT']}"


def get(path):
    try:
        with urllib.request.urlopen(URL + path, timeout=5) as r:
            return json.load(r)
    except OSError:
        return None


# ── 1, 2. settings, start ─────────────────────────────────────────────────────

if get("/api/config") is None:
    env = {**os.environ, **{k: "" for k in MODEL_SETTINGS}, **SETTINGS}
    (ROOT / "servers").mkdir(exist_ok=True)
    log = open(ROOT / "servers" / f"{CONFIG}.log", "w", encoding="utf-8")
    server = subprocess.Popen(["npx", "tsx", "server.ts"], cwd=ROOT / "app", env=env, stdout=log, stderr=subprocess.STDOUT,
                              start_new_session=True)  # keeps running after this script ends
    for _ in range(120):
        if get("/api/config") is not None or server.poll() is not None:
            break
        time.sleep(0.25)
    if get("/api/config") is None:
        raise SystemExit(f"the server did not start; see servers/{CONFIG}.log")
    print(f"{CONFIG}: started at {URL} (pid {server.pid}; stop it: kill {server.pid}). Log: servers/{CONFIG}.log")
else:
    print(f"{CONFIG}: already running at {URL}")


# ── 3. check ──────────────────────────────────────────────────────────────────

app = get("/api/config")
problems = []
controls = load_shop()
if set(app["controls"]) != set(controls):
    problems.append(f"the app's controls are {sorted(app['controls'])}, shop.toml's {sorted(controls)}")
for name, c in controls.items():
    if name not in app["controls"]:
        continue
    domain = app["controls"][name]["domain"]
    values = [v["value"] for v in domain.get("values", [])] or ([True, False] if domain["kind"] == "boolean" else None)
    if domain["kind"] == "action":
        values = ["invoked"]
    if app["v0"][name] != c.start:
        problems.append(f"{name} starts at {app['v0'][name]!r} in the app, {c.start!r} in shop.toml")
    if values != c.values or domain.get("min") != c.min or domain.get("max") != c.max:
        problems.append(f"{name}'s values differ between the app and shop.toml")
if problems:
    raise SystemExit("this is not the shop in shop.toml (is the server on this port another app?):\n  " + "\n  ".join(problems))

model = "the rule-based parser (no model)" if app["mode"] == "local-test" else f"{app['provider']} {app['defaultModel']}"
print(f"  mediator: {model}; temperature {app['temperature']}, top_p {app['topP']}, reasoning {app['reasoningEffort']}, "
      f"history {app['historyPolicy']}, prompt {app['systemPromptHash']} ({app['commandMode']})")
print(f"  ready: python harness/run.py {CONFIG}")
