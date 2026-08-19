#!/usr/bin/env bash
# REFACTOR all 53 articles: 1 opencode worker each (EN+VI), per editorial spec.
# Uses pre-built task files in tasks_refactor/. Resumes from article 2 (rt_01 done).
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode-go/gpt-5.6-luna"
TASKDIR="/root/java-guru/tasks_refactor"

total=53
done=1   # rt_01 already done
batch=0

for t in $(ls "$TASKDIR" | sort); do
  # skip rt_01 (already refactored)
  [[ "$t" == rt_01_* ]] && { echo "skip $t (already done)"; continue; }
  SLUG=$(echo "$t" | sed -E 's/^rt_[0-9]+_[a-z-]+_([a-z0-9-]+)\.txt$/\1/')
  CAT=$(echo "$t" | sed -E 's/^rt_[0-9]+_([a-z-]+)_[a-z0-9-]+\.txt$/\1/')
  IDX=$(echo "$t" | sed -E 's/^rt_([0-9]+)_.*/\1/')
  TMP="/tmp/rt_${IDX}_${SLUG}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  timeout 600 opencode run -m "$MODEL" "$(cat "$TASKDIR/$t")" --dir "$TMP" --auto 2>&1 | tail -1
  EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1); VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
  if [ -n "$EN" ] && [ -n "$VI" ]; then
    cp "$EN" "src/data/blog/en/$CAT/$SLUG.md"
    cp "$VI" "src/data/blog/vi/$CAT/$SLUG.md"
    echo "REFACTORED $CAT/$SLUG"
  else
    echo "WARN: $CAT/$SLUG missing - skip (will re-run later)"
  fi
  done=$((done+1)); batch=$((batch+1))
  if [ "$batch" -ge 4 ]; then
    git add -A
    git commit -q -m "refactor: batch up to $CAT/$SLUG ($done/$total)" 2>&1 | tail -1
    git push origin main 2>&1 | tail -1
    batch=0
    echo "--- pushed at $done/$total ---"
  fi
done

git add -A
git commit -q -m "refactor: final batch ($done/$total)" 2>&1 | tail -1
git push origin main 2>&1 | tail -1
echo "REFACTOR DONE: $done/$total articles"
