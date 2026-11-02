"""
The shop (shop.toml), and how the harness talks to one configuration's running app.

    reset()     back to σ0: every control at its start value, an empty conversation; check it took
    say(u)      one sentence, as if typed into the app's ask bar: the mediator turns it into a command, the app applies it
    read()      V: the value of every control, and D: the products shown, in order

The app's server (started by setup.py) keeps one conversation for the harness (app/api/session.ts). It runs each
sentence through the same code the page runs: the model behind POST /api/command, then the app's own filter logic.
"""

import json
import tomllib
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ── The shop: shop.toml ───────────────────────────────────────────────────────


@dataclass
class Control:
    name: str  # e.g. category: the names the cases use
    start: object  # its value in σ0; None when it starts unset (⊥)
    values: list | None  # a choice: its values. None for a number
    min: int | None  # a number: its range
    max: int | None
    constraining: bool  # narrows the products shown
    reversible: bool  # a sentence can set it back

    def allows(self, value):
        if self.values is not None:
            return any(value == v and isinstance(value, bool) == isinstance(v, bool) for v in self.values)  # True is not 1
        return isinstance(value, (int, float)) and not isinstance(value, bool) and self.min <= value <= self.max


def load_shop():
    """Every control in shop.toml, by name, in file order."""
    shop = tomllib.loads((ROOT / "shop.toml").read_text(encoding="utf-8"))
    return {name: Control(name, c.get("start"), c.get("values"), c.get("min"), c.get("max"), c["constraining"], c["reversible"])
            for name, c in shop["control"].items()}


# ── Where a configuration is ──────────────────────────────────────────────────


def settings(config):
    """configs/<config>.env: the settings the app's server runs with (KEY=VALUE lines; # starts a comment)."""
    path = ROOT / "configs" / f"{config}.env"
    if not path.exists():
        raise SystemExit(f"no configs/{config}.env")
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return dict(line.split("=", 1) for line in lines if line and not line.startswith("#"))


# ── Talking to the app ────────────────────────────────────────────────────────


class InfraError(Exception):
    """The plumbing failed (the server down, the model provider failing, a timeout), not the system under test."""


# The app's error codes for a turn whose model call never produced an answer: the request was refused, there is no key,
# the provider returned an error (4xx: out of credits, rate limit; 5xx), or the server failed. None: no answer at all.
# Any other failed turn (invalid_json, schema_invalid: the model answered something that is not a valid command) is
# the system under test failing.
INFRA_CODES = {None, "bad_request", "model_not_allowed", "missing_api_key", "llm_error", "internal"}


class Shop:
    def __init__(self, config):
        self.url = f"http://localhost:{settings(config)['PORT']}/api/session"
        self.controls = load_shop()

    def call(self, method, path, body=None, timeout=120):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.url + path, data, {"content-type": "application/json"}, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as r:
                return json.load(r)
        except OSError as e:  # refused, a timeout, or an HTTP error
            raise InfraError(f"the app's server at {self.url} failed: {e}")

    # ── Observe ─────────────────────────────────────────────────────────────────

    def read(self):
        """(V, D): every control's value, and the ids of the products shown, in order."""
        state = self.call("GET", "/state")
        return state["V"], state["D"]

    # ── Reset ───────────────────────────────────────────────────────────────────

    def reset(self):
        """σ0: every control back at its start value and a new, empty conversation. Returns (V, D)."""
        state = self.call("POST", "/reset")
        not_reset = [c.name for c in self.controls.values() if state["V"].get(c.name) != c.start]
        if not_reset:
            raise InfraError(f"reset did not take for {', '.join(not_reset)}")
        return state["V"], state["D"]

    # ── Say one sentence ────────────────────────────────────────────────────────

    def say(self, u):
        """
        One turn, in the current conversation (reset starts a new one). Returns None, or what went wrong when the
        model's answer was not a command the app could apply. A model call that never got an answer is an InfraError.
        """
        turn = self.call("POST", "/say", {"u": u})
        if turn["error"] is None:
            return None
        if turn["code"] in INFRA_CODES:
            raise InfraError(f'no answer to "{u}": {turn["error"]}')
        return turn["error"]
