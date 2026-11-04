# prompt-v2-diff/: the second prompt, which asked for changes only

`default-v2-diff.txt` says what a left-out field and null do, and asks for changes only (`implementation: diff`):
a field left out keeps its value, null resets it. `results/` is the six configurations in `configs/` run with it
(93 cases × 10, prompt hash `fnv1a32:cc1c7b3a`).

The app's diff format makes `"sort"` optional but requires `"filters"` (`app/api/prompt.ts`). After earlier turns,
"sort by rating" gets replies such as `{"sort":"rating_desc","explanation":"…"}`: a right answer under the
prompt's rules, which the app rejects. Most failures with this prompt are that rejection, including nearly every
CONTEXT_AMNESIA failure; the history was sent, and the earlier filters were kept.

To run it again, set `SYSTEM_PROMPT` to the text after its header and `LNGUI_COMMAND_MODE=diff` in a configuration.
