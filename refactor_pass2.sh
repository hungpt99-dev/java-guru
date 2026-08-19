#!/usr/bin/env bash
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"
TASKDIR="/root/java-guru/tasks_refactor"

# map slug -> task file
declare -A TASKS
TASKS["system-design/be-careful-with-retry-ddos-your-own-system"]="/root/java-guru/tasks_refactor/rt_02_system-design_be-careful-with-retry-ddos-your-own-system.txt"
TASKS["system-design/distributed-job-scheduler"]="/root/java-guru/tasks_refactor/rt_05_system-design_distributed-job-scheduler.txt"

for key in "${!TASKS[@]}"; do
  t="${TASKS[$key]}"
  [ -z "$t" ] && { echo "no task for $key"; continue; }
  SLUG=$(echo "$key" | sed "s#.*/##")
  CAT=$(echo "$key" | sed "s#/.*##")
  IDX=$(basename "$t" | sed -E "s/^rt_([0-9]+)_.*/\1/")
  TMP="/tmp/rt_${IDX}_${SLUG}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  echo "=== retry $key (timeout 1100) ==="
  timeout 1100 opencode run -m "$MODEL" "$(cat "$t")" --dir "$TMP" --auto 2>&1 | tail -1
  EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1); VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
  if [ -n "$EN" ] && [ -n "$VI" ]; then
    cp "$EN" "src/data/blog/en/$CAT/$SLUG.md"
    cp "$VI" "src/data/blog/vi/$CAT/$SLUG.md"
    echo "REFACTORED $key"
  else
    echo "STILL MISSING: $key"
  fi
done
git add -A
git commit -q -m "refactor: second pass (2 missing articles)" 2>&1 | tail -1
git push origin main 2>&1 | tail -1
echo "SECOND PASS DONE"
