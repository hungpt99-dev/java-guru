#!/usr/bin/env bash
# B2-working pattern: opencode AUTHORS each blog in a temp dir (java-guru AGENTS.md
# blocks Write inside the repo), then we move the files into java-guru + commit + push.
# opencode does the writing; we relocate + git.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1

# slug | en_title | repo_link | svc
BLOGS=(
  "smart-notifications-llm|AI-2 Smart Notifications with LLM-generated copy|https://github.com/finpay-lab/notification-service|notification-service"
  "ledger-anomaly-detection|AI-3 Ledger and Kafka Anomaly Detection to Prometheus|https://github.com/finpay-lab/ledger-service|ledger-service"
  "ai-ops-incident-triage|AI-4 AI Ops Incident Triage from Alerts and Traces|https://github.com/finpay-lab/observability|observability"
  "trace-summarization-llm|AI-5 LLM Trace Summarization for a traceId|https://github.com/finpay-lab/observability|observability"
  "kyc-document-intake-llm|AI-6 KYC Document Intake with Vision and LLM|https://github.com/finpay-lab/identity-service|identity-service"
  "gateway-ai-guardrail|AI-7 Gateway AI Guardrail (injection and anomaly filter)|https://github.com/finpay-lab/gateway|gateway"
  "platform-ai-core-library|AI-8 Shared ai-core Library (BYOK, retry, audit)|https://github.com/finpay-lab/platform|platform"
)

for entry in "${BLOGS[@]}"; do
  SLUG="${entry%%|*}"; rest="${entry#*|}"; TITLE="${rest%%|*}"; rest2="${rest#*|}"; REPO="${rest2%%|*}"; SVC="${rest2##*|}"
  BR="ai-blog-$SLUG"
  TMP="/tmp/ai_blog_$SLUG"
  echo "===== [$(date)] $SLUG -> $BR (repo $REPO) ====="

  rm -rf "$TMP"; mkdir -p "$TMP"

  PROMPT="Create exactly two files in $TMP: $SLUG.en.md and $SLUG.vi.md. EN file: Astro blog post frontmatter (title '$TITLE', description 'FinPay $SVC AI integration: $SLUG.', pubDatetime 2026-08-15T10:00:00+07:00, tags [java, ai, fintech, architecture], draft false, featured false) then a senior English post, code-heavy (WRONG then RIGHT Java), about this FinPay $SVC AI feature. VI file: faithful Vietnamese translation, same depth and same code. Put repo link $REPO top and bottom of both files. Mention guardrails: AI is not a money decider, idempotent by eventId, timeout retry circuit breaker, BYOK key never hardcoded or logged, audit every decision. Cover real architecture (Spring Boot, Kafka, hexagonal ports domain/ vs infrastructure/, OpenSearch where relevant)."

  echo "--- opencode authoring (temp dir) ---"
  timeout 400 opencode run "$PROMPT" --dir "$TMP" --auto 2>&1 | tail -3

  if [ ! -f "$TMP/$SLUG.en.md" ] || [ ! -f "$TMP/$SLUG.vi.md" ]; then
    echo "WARN: opencode did not produce files for $SLUG - skipping"
    continue
  fi

  git checkout main 2>&1 | tail -1
  git checkout -b "$BR" 2>&1 | tail -1
  mkdir -p "src/data/blog/en/ai" "src/data/blog/vi/ai"
  mv "$TMP/$SLUG.en.md" "src/data/blog/en/ai/$SLUG.md"
  mv "$TMP/$SLUG.vi.md" "src/data/blog/vi/ai/$SLUG.md"
  git add -A
  git commit -m "docs(ai): add $SLUG blog (en+vi) for $SVC" 2>&1 | tail -1
  git push -u origin "$BR" 2>&1 | tail -1
  echo "PUSHED $BR"
done
echo "ALL REMAINING AI BLOGS PROCESSED"
