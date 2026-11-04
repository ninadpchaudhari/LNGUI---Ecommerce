# prompt-v1/: the first prompt, which did not say what null does

`default-v1.txt` lists every field as "<value> or null" and asks for every field (`implementation: full`), but never
says what null does. The app reads null as "reset to the default". The models sent null for every field a sentence
did not mention, so each turn erased the filters the earlier turns set. MR_CA and CONTEXT_AMNESIA failed on most
trials for every model but Llama 3.2 3B, which mostly did not answer in JSON.

`configs/` and `results/` are the six configurations run with it (93 cases × 10, prompt hash `fnv1a32:2c40daf0`).
The configurations no longer select it: `app/prompts/default.txt` is now a later prompt. To run
them again, set `SYSTEM_PROMPT` to the text after its header and `LNGUI_COMMAND_MODE=full` in the configuration.

Failures out of 930 (the filters ended up wrong / the app refused the reply), then with the second prompt (`../prompt-v2-diff/`):

| Model | First prompt | Second prompt |
|---|---|---|
| Claude Haiku 5.5 | 114 (114 / 0) | 44 (30 / 14) |
| GPT-4o mini | 297 (289 / 8) | 211 (10 / 201) |
| GPT-5 nano | 394 (394 / 0) | 175 (15 / 160) |
| Qwen3.5 9B, t=0 | 178 (178 / 0) | 97 (30 / 67) |
| Qwen3.5 9B, t=1 | 193 (157 / 36) | 132 (30 / 102) |
| Llama 3.2 3B | 868 (13 / 855) | 855 (27 / 828) |
