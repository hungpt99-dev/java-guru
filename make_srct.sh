#!/usr/bin/env bash
# Generate 10 source-verified system-design articles (en+vi) via opencode-go/gpt-5.6-luna.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"

make_one() {
  local N="$1"; local SLUG="$2"; local TASK="$3"; local TMP="/tmp/srct_${N}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  timeout 700 opencode run -m "$MODEL" "$(cat "$TASK")" --dir "$TMP" --auto 2>&1 | tail -2
  local EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1)
  local VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
  if [ -n "$EN" ] && [ -n "$VI" ]; then
    cp "$EN" "src/data/blog/en/system-design/$SLUG.md"
    cp "$VI" "src/data/blog/vi/system-design/$SLUG.md"
    echo "MADE $SLUG"
  else
    echo "WARN: $SLUG missing - /tmp/srct_${N} had: $(ls "$TMP" 2>/dev/null | tr '\n' ' ')"
  fi
}

make_one 01 discord-billions-messages      /root/java-guru/tasks_srct/srct_01_discord-billions-messages.txt
make_one 02 stripe-idempotent-apis        /root/java-guru/tasks_srct/srct_02_stripe-idempotent-apis.txt
make_one 03 stripe-online-migrations       /root/java-guru/tasks_srct/srct_03_stripe-online-migrations.txt
make_one 04 google-spanner                /root/java-guru/tasks_srct/srct_04_google-spanner.txt
make_one 05 google-data-integrity         /root/java-guru/tasks_srct/srct_05_google-data-integrity.txt
make_one 06 google-monitoring-golden-signals /root/java-guru/tasks_srct/srct_06_google-monitoring-golden-signals.txt
make_one 07 cloudflare-1111-dns           /root/java-guru/tasks_srct/srct_07_cloudflare-1111-dns.txt
make_one 08 dropbox-magic-pocket          /root/java-guru/tasks_srct/srct_08_dropbox-magic-pocket.txt
make_one 09 google-tail-at-scale          /root/java-guru/tasks_srct/srct_09_google-tail-at-scale.txt
make_one 10 aws-architecture-patterns     /root/java-guru/tasks_srct/srct_10_aws-architecture-patterns.txt

echo "=== commit + push main ==="
git add -A
git commit -m "docs(system-design): add 10 source-verified Big Tech system-design articles (en+vi)" 2>&1 | tail -2
git push origin main 2>&1 | tail -2
echo "SRCT BATCH DONE"
