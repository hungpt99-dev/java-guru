#!/usr/bin/env bash
# Explicit-path rewrite of the 4 still-missing FinPay AI articles.
# opencode writes to exact paths we name; proven to work.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"
TASKDIR="/root/java-guru/tasks_finpay_explicit"

declare -A SLUG
SLUG["02"]="llm-transaction-explainer-rag"
SLUG["03"]="smart-notifications-llm"
SLUG["06"]="kyc-document-intake-llm"
SLUG["08"]="platform-ai-core-library"

for N in 02 03 06 08; do
  SLUG_N="${SLUG[$N]}"
  TASK=$(ls "$TASKDIR"/fpx_${SLUG_N}.txt 2>/dev/null | head -1)
  [ -z "$TASK" ] && { echo "no task for $N"; continue; }
  done_this=0
  for attempt in 1 2; do
    rm -rf "/tmp/fpx_${SLUG_N}"; mkdir -p "/tmp/fpx_${SLUG_N}"
    echo "=== $SLUG_N attempt $attempt ==="
    timeout 800 opencode run -m "$MODEL" "$(cat "$TASK")" --dir "/tmp/fpx_${SLUG_N}" --title "fpx-$SLUG_N" --auto 2>&1 | tail -1
    EN="/tmp/fpx_${SLUG_N}/${SLUG_N}.en.md"; VI="/tmp/fpx_${SLUG_N}/${SLUG_N}.vi.md"
    if [ -s "$EN" ] && [ -s "$VI" ]; then
      cp "$EN" "src/data/blog/en/ai/$SLUG_N.md"
      cp "$VI" "src/data/blog/vi/ai/$SLUG_N.md"
      echo "REWROTE ai/$SLUG_N"
      done_this=1
      break
    else
      echo "attempt $attempt empty"
    fi
  done
  if [ "$done_this" -eq 1 ]; then
    git add -A
    git commit -q -m "rewrite(finpay-ai): $SLUG_N (explicit-path)" 2>&1 | tail -1
    git push origin main 2>&1 | tail -1
    echo "--- pushed $SLUG_N ---"
  else
    echo "STILL MISSING: ai/$SLUG_N"
  fi
done
echo "FINPAY AI EXPLICIT-PASS DONE"
