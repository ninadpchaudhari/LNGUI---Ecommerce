#!/bin/sh
# Runs a whole study: every configuration in studies/<study>/configs/ except local, all at once (each has its own
# port), N trials per case, then writes the study's summary.csv and table.csv. Meant to run unattended.
#
#     caffeinate -i ./run_study.sh studies/<study> [N]        N defaults to 10; caffeinate keeps the Mac awake
#
# Per configuration: studies/<study>/results/<config>.csv, and in studies/<study>/logs/ the server's log
# (<config>.log) and the harness's progress (<config>.run.log). A configuration whose results CSV already has every
# trial is skipped, so running it again after a crash only redoes what is missing.
set -u
[ $# -ge 1 ] || { sed -n '2,9p' "$0"; exit 1; }
cd "$(dirname "$0")"
study=${1%/}
n=${2:-10}
mkdir -p "$study/logs"
trials=$(python3 run.py --check | head -1 | cut -d' ' -f1)   # number of cases

run_one() {
  config=$1
  name=$(basename "$config" .env)
  port=$(grep '^PORT=' "$config" | cut -d= -f2)
  csv="$study/results/$name.csv"
  if [ -f "$csv" ] && [ "$(($(wc -l < "$csv") - 1))" -ge "$((trials * n))" ] && ! grep -q ',infra,' "$csv"; then
    echo "$name: already complete, skipped"; return
  fi
  lsof -ti "tcp:$port" >/dev/null && { echo "$name: port $port is busy, skipped"; return; }
  ./serve.sh "$study" "$name" >/dev/null
  i=0; until curl -s -o /dev/null "localhost:$port" || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
  echo "$name: started $(date '+%H:%M')"
  python3 run.py "$study" "$name" "$n" > "$study/logs/$name.run.log" 2>&1
  kill $(lsof -ti "tcp:$port") 2>/dev/null
  echo "$name: done $(date '+%H:%M'), $(cut -d, -f5 "$csv" | tail -n +2 | sort | uniq -c | tr -s ' \n' ' ')"
}

echo "$study: $trials cases x $n trials per configuration, started $(date '+%Y-%m-%d %H:%M')"
for config in "$study"/configs/*.env; do
  [ "$(basename "$config")" = local.env ] && continue
  run_one "$config" &
done
wait

py=python3; [ -x .venv/bin/python ] && py=.venv/bin/python
$py summary.py "$study" && echo "$study: summary.csv and table.csv written, finished $(date '+%H:%M')"
grep -l ',infra,' "$study"/results/*.csv 2>/dev/null | sed 's/^/has infra rows (run this script again to redo): /'
