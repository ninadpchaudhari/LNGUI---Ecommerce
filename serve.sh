#!/bin/sh
# Starts the app's server for one configuration of a study, in the background.
#
#     ./serve.sh studies/<study> <config>
#
# The configuration's settings come from studies/<study>/configs/<config>.env. If the study has a prompt.txt,
# the server uses it instead of app/prompts/default.txt (same format: an "implementation: full|diff" header
# between --- lines, then the prompt). The server's log goes to studies/<study>/logs/<config>.log, and the
# turn records it keeps go to studies/<study>/logs/<config>.turns.jsonl.
# Stop it with: kill $(lsof -ti tcp:<PORT>)
set -e
[ $# -eq 2 ] || { sed -n '2,9p' "$0"; exit 1; }
study=$(cd "$1" && pwd)
name=$(basename "$2" .env)
config="$study/configs/$name.env"
[ -f "$config" ] || { echo "no $config"; exit 1; }
mkdir -p "$study/logs"
cd "$(dirname "$0")/app"
(
  set -a
  . "$config"
  TURNS_FILE="$study/logs/$name.turns.jsonl"
  if [ -f "$study/prompt.txt" ]; then
    LNGUI_COMMAND_MODE=$(awk '/^---$/{n++; next} n==1 && /^implementation:/{print $2}' "$study/prompt.txt")
    SYSTEM_PROMPT=$(awk 'n>=2{print; next} /^---$/{n++}' "$study/prompt.txt")
  fi
  exec npx tsx server.ts
) > "$study/logs/$name.log" 2>&1 &
echo "$name: server started on port $(grep '^PORT=' "$config" | cut -d= -f2), log in $study/logs/$name.log"
