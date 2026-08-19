#!/usr/bin/env bash
# B: opencode grammar/wording polish pass for the 8 AI blogs already on main.
# opencode rewrites each en+vi file in a temp dir (java-guru AGENTS.md blocks
# in-repo writes), keeping code blocks + frontmatter + repo links UNCHANGED.
# We then replace the files on main + commit + push.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1

SLUGS="llm-transaction-explainer-rag smart-notifications-llm ledger-anomaly-detection ai-ops-incident-triage trace-summarization-llm kyc-document-intake-llm gateway-ai-guardrail platform-ai-core-library"

for SLUG in $SLUGS; do
  TMP="/tmp/polish_$SLUG"; rm -rf "$TMP"; mkdir -p "$TMP"
  echo "===== [$(date)] polish $SLUG ====="

  PROMPT="You are a senior technical editor. Rewrite these two files for NATURAL, CORRECT English and Vietnamese wording/grammar ONLY. FILES: /tmp/polish_$SLUG/$SLUG.en.md and /tmp/polish_$SLUG/$SLUG.vi.md (read them first). RULES: (1) Fix grammar, awkward phrasing, missing articles, subject-verb agreement, and readability. (2) DO NOT change any code fences (java/json/etc) - keep them byte-for-byte. (3) DO NOT change frontmatter keys/values except fix grammar inside the description string. (4) DO NOT remove or alter the repo link https://github.com/finpay-lab/... - keep it top and bottom. (5) Keep the same structure, headings, and technical meaning. (6) vi file = faithful natural Vietnamese, same fixes. Only improve wording/grammar, nothing else."

  timeout 420 opencode run "$PROMPT" --dir "$TMP" --auto 2>&1 | tail -3

  if [ ! -f "$TMP/$SLUG.en.md" ] || [ ! -f "$TMP/$SLUG.vi.md" ]; then
    echo "WARN: polish did not produce $SLUG - keep original"
    continue
  fi
  cp "$TMP/$SLUG.en.md" "src/data/blog/en/ai/$SLUG.md"
  cp "$TMP/$SLUG.vi.md" "src/data/blog/vi/ai/$SLUG.md"
  echo "replaced $SLUG"
done

echo "=== commit + push main ==="
git add -A
git commit -m "docs(ai): polish wording/grammar of 8 AI blogs (en+vi)" 2>&1 | tail -2
git push origin main 2>&1 | tail -2
echo "POLISH DONE"
