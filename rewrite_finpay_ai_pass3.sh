#!/usr/bin/env bash
# 3rd pass: retry the 4 still-missing FinPay AI articles, up to 3 attempts each.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode-go/gpt-5.6-luna"
TASKDIR="/root/java-guru/tasks_finpay_ai2"

declare -A SLUG
SLUG["02"]="llm-transaction-explainer-rag"
SLUG["03"]="smart-notifications-llm"
SLUG["06"]="kyc-document-intake-llm"
SLUG["08"]="platform-ai-core-library"

for N in 02 03 06 08; do
  SLUG_N="${SLUG[$N]}"
  TASK=$(ls "$TASKDIR"/fp2_${N}_${SLUG_N}.txt 2>/dev/null | head -1)
  [ -z "$TASK" ] && { echo "no task for $N"; continue; }
  done_this=0
  for attempt in 1 2 3; do
    TMP="/tmp/fp3_${N}_${SLUG_N}_a${attempt}"
    rm -rf "$TMP"; mkdir -p "$TMP"
    echo "=== $SLUG_N attempt $attempt ==="
    timeout 900 opencode run -m "$MODEL" "$(cat "$TASK")" --dir "$TMP" --auto 2>&1 | tail -1
    EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1); VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
    if [ -n "$EN" ] && [ -n "$VI" ]; then
      cp "$EN" "src/data/blog/en/ai/$SLUG_N.md"
      cp "$VI" "src/data/blog/vi/ai/$SLUG_N.md"
      echo "REWROTE ai/$SLUG_N (attempt $attempt)"
      done_this=1
      break
    else
      echo "attempt $attempt empty, retry..."
    fi
  done
  if [ "$done_this" -eq 1 ]; then
    git add -A
    git commit -q -m "rewrite(finpay-ai): $SLUG_N (retry pass)" 2>&1 | tail -1
    git push origin main 2>&1 | tail -1
    echo "--- pushed $SLUG_N ---"
  else
    echo "GAVE UP on ai/$SLUG_N after 3 attempts"
  fi
done
echo "FINPAY AI 3RD PASS DONE"
