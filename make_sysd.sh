#!/usr/bin/env bash
# Author 10 system-design articles (en+vi) via opencode-go/gpt-5.6-luna into java-guru.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"

make_one() {
  local N="$1"; local SLUG="$2"; local TASK="$3"; local TMP="/tmp/sysd_${N}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  # the prompt references /tmp/sysd_{N}/{slug}.en.md — seed empty placeholders so opencode has paths? No: instruct to CREATE them.
  timeout 600 opencode run -m "$MODEL" "$(cat "$TASK")" --dir "$TMP" --auto 2>&1 | tail -3
  if [ -f "$TMP/$SLUG.en.md" ] && [ -f "$TMP/$SLUG.vi.md" ]; then
    cp "$TMP/$SLUG.en.md" "src/data/blog/en/system-design/$SLUG.md"
    cp "$TMP/$SLUG.vi.md" "src/data/blog/vi/system-design/$SLUG.md"
    echo "MADE $SLUG"
  else
    echo "WARN: $SLUG missing - check /tmp/sysd_${N}"
  fi
}

make_one 01 notification-system          /root/java-guru/tasks_sysd/sysd_01_notification-system.txt
make_one 02 url-shortener               /root/java-guru/tasks_sysd/sysd_02_url-shortener.txt
make_one 03 rate-limiter                /root/java-guru/tasks_sysd/sysd_03_rate-limiter.txt
make_one 04 distributed-job-scheduler   /root/java-guru/tasks_sysd/sysd_04_distributed-job-scheduler.txt
make_one 05 realtime-chat               /root/java-guru/tasks_sysd/sysd_05_realtime-chat.txt
make_one 06 news-feed                   /root/java-guru/tasks_sysd/sysd_06_news-feed.txt
make_one 07 payment-system              /root/java-guru/tasks_sysd/sysd_07_payment-system.txt
make_one 08 file-storage                /root/java-guru/tasks_sysd/sysd_08_file-storage.txt
make_one 09 search-autocomplete         /root/java-guru/tasks_sysd/sysd_09_search-autocomplete.txt
make_one 10 video-processing-streaming  /root/java-guru/tasks_sysd/sysd_10_video-processing-streaming.txt

echo "=== commit + push main ==="
git add -A
git commit -m "docs(system-design): add 10 bilingual system-design articles (en+vi)" 2>&1 | tail -2
git push origin main 2>&1 | tail -2
echo "SYSD BATCH DONE"
