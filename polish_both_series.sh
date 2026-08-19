#!/usr/bin/env bash
# Polish BOTH series with OpenCode Go GPT 5.6 Luna.
# opencode writes to /tmp/polish_<slug>/ (it ignores our prefix), we copy from there.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"

AI_SL="llm-transaction-explainer-rag smart-notifications-llm ledger-anomaly-detection ai-ops-incident-triage trace-summarization-llm kyc-document-intake-llm gateway-ai-guardrail platform-ai-core-library"
IV_SL=$(ls src/data/blog/en/interview/ 2>/dev/null | sed 's/\.md$//')

polish_one() {
  local CAT="$1"; local SLUG="$2"; local TMP="/tmp/polish_${SLUG}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  local PROMPT="You are a senior technical editor. Rewrite these two files for NATURAL, CORRECT English and Vietnamese wording/grammar ONLY. They ALREADY EXIST at $TMP/$SLUG.en.md and $TMP/$SLUG.vi.md - read them, then OVERWRITE both with the polished version (same filenames, same location). RULES: (1) Fix grammar, awkward phrasing, missing articles, subject-verb agreement, readability. (2) DO NOT change any code fences - byte-for-byte. (3) DO NOT change frontmatter keys/values except fix grammar inside the description string. (4) DO NOT remove/alter any repo link https://github.com/finpay-lab/... (keep top+bottom). (5) Keep structure, headings, technical meaning. (6) vi = faithful natural Vietnamese. Only improve wording/grammar."
  # seed the temp dir with current content so opencode has something to rewrite
  cp "src/data/blog/en/$CAT/$SLUG.md" "$TMP/$SLUG.en.md"
  cp "src/data/blog/vi/$CAT/$SLUG.md" "$TMP/$SLUG.vi.md"
  timeout 420 opencode run -m "$MODEL" "$PROMPT" --dir "$TMP" --auto 2>&1 | tail -2
  if [ -f "$TMP/$SLUG.en.md" ] && [ -f "$TMP/$SLUG.vi.md" ]; then
    cp "$TMP/$SLUG.en.md" "src/data/blog/en/$CAT/$SLUG.md"
    cp "$TMP/$SLUG.vi.md" "src/data/blog/vi/$CAT/$SLUG.md"
    echo "polished $CAT/$SLUG"
  else
    echo "WARN: $CAT/$SLUG empty - keep original"
  fi
}

echo "===== AI SERIES ====="
for s in $AI_SL; do echo "--- $s ---"; polish_one ai "$s"; done
echo "===== INTERVIEW SERIES ====="
for s in $IV_SL; do echo "--- $s ---"; polish_one interview "$s"; done

echo "=== commit + push main ==="
git add -A
git commit -m "docs: polish wording/grammar of AI + Interview series (en+vi) via GPT 5.6 Luna" 2>&1 | tail -2
git push origin main 2>&1 | tail -2
echo "POLISH BOTH SERIES DONE"
