#!/usr/bin/env bash
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1

# VI files to remove (12)
VI_FILES=(
 "vi/system-design/i-dont-like-microservices-heres-why.md"
 "vi/career/ai-wont-take-your-job.md"
 "vi/spring-boot/hundreds-of-orders-vanished-in-3-minutes.md"
 "vi/system-design/can-than-khi-retry-dung-tu-ddos-chinh-he-thong.md"
 "vi/system-design/saga-pattern-when-theory-meets-reality.md"
 "vi/system-design/understanding-saga-pattern-in-5-minutes.md"
 "vi/system-design/understanding-zero-trust-in-5-minutes.md"
 "vi/system-design/twilio-segment-goodbye-microservices.md"
 "vi/system-design/security-considerations-software-development.md"
 "vi/system-design/kafka-lessons-only-production-can-teach-you.md"
 "vi/java-core/java-hoat-dong-nhu-the-nao.md"
 "vi/java-core/how-java-works-internally.md"
)

# EN files to remove (retry uses different slug; the two Java articles share how-java-works-internally.md)
EN_FILES=(
 "en/system-design/i-dont-like-microservices-heres-why.md"
 "en/career/ai-wont-take-your-job.md"
 "en/spring-boot/hundreds-of-orders-vanished-in-3-minutes.md"
 "en/system-design/be-careful-with-retry-ddos-your-own-system.md"
 "en/system-design/saga-pattern-when-theory-meets-reality.md"
 "en/system-design/understanding-saga-pattern-in-5-minutes.md"
 "en/system-design/understanding-zero-trust-in-5-minutes.md"
 "en/system-design/twilio-segment-goodbye-microservices.md"
 "en/system-design/security-considerations-software-development.md"
 "en/system-design/kafka-lessons-only-production-can-teach-you.md"
 "en/java-core/how-java-works-internally.md"
)

for f in "${VI_FILES[@]}" "${EN_FILES[@]}"; do
  if [ -f "$f" ]; then
    git rm "$f" 2>/dev/null || rm -f "$f"
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
