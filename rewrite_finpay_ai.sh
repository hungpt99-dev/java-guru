#!/usr/bin/env bash
# Rewrite FinPay AI blog series: 1 opencode worker per article (EN+VI), problem-driven style.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"
TASKDIR="/root/java-guru/tasks_finpay_ai"

declare -A SLUG
SLUG["01"]="ledger-anomaly-detection"
SLUG["02"]="llm-transaction-explainer-rag"
SLUG["03"]="smart-notifications-llm"
SLUG["04"]="ai-ops-incident-triage"
SLUG["05"]="trace-summarization-llm"
SLUG["06"]="kyc-document-intake-llm"
SLUG["07"]="gateway-ai-guardrail"
SLUG["08"]="platform-ai-core-library"

batch=0
for N in 01 02 03 04 05 06 07 08; do
  SLUG_N="${SLUG[$N]}"
  TASK=$(ls "$TASKDIR"/fp_${N}_${SLUG_N}.txt 2>/dev/null | head -1)
  [ -z "$TASK" ] && { echo "no task for $N"; continue; }
  TMP="/tmp/fp_${N}_${SLUG_N}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  timeout 800 opencode run -m "$MODEL" "$(cat "$TASK")" --dir "$TMP" --auto 2>&1 | tail -1
  EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1); VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
  if [ -n "$EN" ] && [ -n "$VI" ]; then
    cp "$EN" "src/data/blog/en/ai/$SLUG_N.md"
    cp "$VI" "src/data/blog/vi/ai/$SLUG_N.md"
    echo "REWROTE ai/$SLUG_N"
  else
    echo "WARN: ai/$SLUG_N missing - skip (re-run later)"
  fi
  batch=$((batch+1))
  if [ "$batch" -ge 2 ]; then
    git add -A
    git commit -q -m "rewrite(finpay-ai): $SLUG_N + prior (problem-driven style)" 2>&1 | tail -1
    git push origin main 2>&1 | tail -1
    batch=0
    echo "--- pushed ---"
  fi
done
git add -A
git commit -q -m "rewrite(finpay-ai): final batch" 2>&1 | tail -1
git push origin main 2>&1 | tail -1
echo "FINPAY AI REWRITE DONE"
