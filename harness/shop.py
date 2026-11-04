"""
Talks to one running shop server (app/api/session.ts), which keeps one conversation for the harness:

    reset()     back to the start: every control at its start value, an empty conversation. Returns {"V", "D"}
    say(u)      one sentence, as if typed into the app's ask bar. Returns {"V", "D", "error"}

Each sentence goes through the same code the page runs: the model behind POST /api/command, then the app's own filter
logic. V is every control's value (D, the products shown, is not used).
"""

import json
import urllib.request

# The app's error codes for a turn whose model call never got an answer (no key, the provider failing, the server
# failing; None: no answer at all). That is the plumbing failing, not the system under test. Any other failed turn
# (invalid_json, schema_invalid: the model answered something that is not a valid command) is the system failing.
INFRA_CODES = {None, "bad_request", "model_not_allowed", "missing_api_key", "llm_error", "internal"}


class InfraError(Exception):
    pass


class Shop:
    def __init__(self, port):
        self.url = f"http://localhost:{port}/api/session"

    def post(self, path, body):
        request = urllib.request.Request(self.url + path, json.dumps(body).encode(), {"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as r:
                return json.load(r)
        except OSError as e:  # refused, a timeout, or an HTTP error
            raise InfraError(f"the server at {self.url} failed: {e}")

    def reset(self):
        return self.post("/reset", {})

    def say(self, u):
        turn = self.post("/say", {"u": u})
        if turn["error"] and turn["code"] in INFRA_CODES:
            raise InfraError(f'no answer to "{u}": {turn["error"]}')
        return turn
