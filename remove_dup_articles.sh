#!/usr/bin/env bash
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1

BASE="src/data/blog"

VI_FILES=(
 "$BASE/vi/system-design/i-dont-like-microservices-heres-why.md"
 "$BASE/vi/career/ai-wont-take-your-job.md"
 "$BASE/vi/spring-boot/hundreds-of-orders-vanished-in-3-minutes.md"
 "$BASE/vi/system-design/can-than-khi-retry-dung-tu-ddos-chinh-he-thong.md"
 "$BASE/vi/system-design/saga-pattern-when-theory-meets-reality.md"
 "$BASE/vi/system-design/understanding-saga-pattern-in-5-minutes.md"
 "$BASE/vi/system-design/understanding-zero-trust-in-5-minutes.md"
 "$BASE/vi/system-design/twilio-segment-goodbye-microservices.md"
 "$BASE/vi/system-design/security-considerations-software-development.md"
 "$BASE/vi/system-design/kafka-lessons-only-production-can-teach-you.md"
 "$BASE/vi/java-core/java-hoat-dong-nhu-the-nao.md"
 "$BASE/vi/java-core/how-java-works-internally.md"
)

EN_FILES=(
 "$BASE/en/system-design/i-dont-like-microservices-heres-why.md"
 "$BASE/en/career/ai-wont-take-your-job.md"
 "$BASE/en/spring-boot/hundreds-of-orders-vanished-in-3-minutes.md"
 "$BASE/en/system-design/be-careful-with-retry-ddos-your-own-system.md"
 "$BASE/en/system-design/saga-pattern-when-theory-meets-reality.md"
 "$BASE/en/system-design/understanding-saga-pattern-in-5-minutes.md"
 "$BASE/en/system-design/understanding-zero-trust-in-5-minutes.md"
 "$BASE/en/system-design/twilio-segment-goodbye-microservices.md"
 "$BASE/en/system-design/security-considerations-software-development.md"
 "$BASE/en/system-design/kafka-lessons-only-production-can-teach-you.md"
 "$BASE/en/java-core/how-java-works-internally.md"
)

for f in "${VI_FILES[@]}" "${EN_FILES[@]}"; do
  if [ -f "$f" ]; then
    git rm -q "$f" 2>/dev/null || rm -f "$f"
    echo "REMOVED $f"
  else
    echo "ABSENT (skip) $f"
  fi
done

git add -A
git commit -q -m "cleanup: remove duplicate VI+EN articles (microservices, saga, zero-trust, twilio, security, kafka, retry, java-internals, ai-career, spring-boot)" 2>&1 | tail -1
git push origin main 2>&1 | tail -1
echo "=== done ==="
git status -sb | head -1
