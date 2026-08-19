#!/usr/bin/env bash
# Author remaining 7 system-design articles (en+vi) via opencode-go/gpt-5.6-luna.
# Slug-agnostic: copy the first *.en.md / *.vi.md found in each temp dir.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"

make_one() {
  local N="$1"; local SLUG="$2"; local TASK="$3"; local TMP="/tmp/sysd_${N}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  timeout 600 opencode run -m "$MODEL" "$(cat "$TASK")" --dir "$TMP" --auto 2>&1 | tail -2
  local EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1)
  local VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
  if [ -n "$EN" ] && [ -n "$VI" ]; then
    cp "$EN" "src/data/blog/en/system-design/$SLUG.md"
    cp "$VI" "src/data/blog/vi/system-design/$SLUG.md"
    echo "MADE $SLUG (from $(basename "$EN"))"
  else
    echo "WARN: $SLUG missing - /tmp/sysd_${N} had: $(ls "$TMP" 2>/dev/null | tr '\n' ' ')"
  fi
}

make_one 02 url-shortener              /root/java-guru/tasks_sysd/sysd_02_url-shortener.txt
make_one 05 realtime-chat             /root/java-guru/tasks_sysd/sysd_05_realtime-chat.txt
make_one 06 news-feed                 /root/java-guru/tasks_sysd/sysd_06_news-feed.txt
make_one 07 payment-system            /root/java-guru/tasks_sysd/sysd_07_payment-system.txt
make_one 08 file-storage              /root/java-guru/tasks_sysd/sysd_08_file-storage.txt
make_one 09 search-autocomplete       /root/java-guru/tasks_sysd/sysd_09_search-autocomplete.txt
make_one 10 video-processing-streaming /root/java-guru/tasks_sysd/sysd_10_video-processing-streaming.txt

echo "=== commit + push main ==="
git add -A
git commit -m "docs(system-design): add 7 more bilingual system-design articles (en+vi)" 2>&1 | tail -2
git push origin main 2>&1 | tail -2
echo "SYSD REMAINING DONE"
