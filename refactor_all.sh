#!/usr/bin/env bash
# REFACTOR: 1 opencode worker per article (rewrites EN+VI pair) per editorial spec.
# Runs the queue in /root/java-guru/refactor_queue.json, commits in batches.
set -uo pipefail
cd /root/java-guru
git checkout main 2>&1 | tail -1
MODEL="opencode/deepseek-v4-flash-free"

# Editorial spec (condensed) — injected per article.
read -r -d '' SPEC <<'SPEC'
You are a senior technical editor + software engineer. REWRITE the given article pair (EN + VI) to sound like a real senior engineer, not an AI.
RULES:
- Preserve ALL factual/technical correctness. Do NOT invent facts, numbers, benchmarks, company architecture, citations, or URLs.
- If the article cites a company/system, only keep the claim if it is plausible/generic; do NOT fabricate a specific Big Tech attribution. Remove unsupported specific claims or rewrite as a labeled assumption/proposal.
- Clearly separate: [SOURCE FACT] / [ANALYSIS] / [PROPOSED DESIGN] where relevant.
- Remove AI filler ("this transforms how we think...", "observability is the eyes...", "engineering discipline becomes critical"), drama ("thiêng liêng", "phòng tiền", "kẻ giám sát", "chìa khóa", "thảm họa"), and unnecessary metaphors.
- Use precise engineering terms; prefer standard English terms (timeout, retry, fallback, circuit breaker, async, consumer, producer, idempotency, backpressure, connection pool, row lock) with Vietnamese explanation once.
- Do NOT overdramatize. Use "không nên gọi LLM synchronously trong transaction vì latency..." not "AI không bao giờ được cầm chìa khóa phòng tiền".
- Keep code blocks minimal, correct, consistent. Remove code that only looks technical.
- Every number must be a source fact or explicitly labeled assumption ("giả định minh họa").
- Natural intro: what problem, why hard, what covered.
- Keep bilingual EN+VI parity: same depth, same code/diagrams, faithful VI translation.
- Keep frontmatter (title, description, pubDatetime, tags, draft, featured) — IMPROVE title to be straightforward (no AI-generated hype).
- Do NOT reformat unrelated files. Only modify the two given files.
- Produce TWO files at the given temp paths.
SPEC

# read queue
python3 - <<'PY'
import json,os
q=json.load(open("/root/java-guru/refactor_queue.json"))
out=[]
for i,(cat,slug) in enumerate(q,1):
    out.append(f"{i}|{cat}|{slug}")
open("/root/java-guru/refactor_queue_lines.txt","w").write("\n".join(out))
PY

done=0
batch=0
while IFS='|' read -r IDX CAT SLUG; do
  [ -z "$SLUG" ] && continue
  TMP="/tmp/refactor_${IDX}_${SLUG}"
  rm -rf "$TMP"; mkdir -p "$TMP"
  EN_SRC="src/data/blog/en/$CAT/$SLUG.md"
  VI_SRC="src/data/blog/vi/$CAT/$SLUG.md"
  # read current content to give context
  EN_C=$(cat "$EN_SRC" 2>/dev/null)
  VI_C=$(cat "$VI_SRC" 2>/dev/null)
  PROMPT="$SPEC

ARTICLE #$IDX: $CAT/$SLUG
CURRENT EN FILE PATH (write rewritten to $TMP/$SLUG.en.md):
--- EN CURRENT (first 6000 chars) ---
${EN_C:0:6000}
--- VI CURRENT (first 6000 chars) ---
${VI_C:0:6000}
Rewrite both, writing:
  $TMP/$SLUG.en.md
  $TMP/$SLUG.vi.md
Keep the same technical content, just rewrite language/clarity/structure per rules."
  timeout 600 opencode run -m "$MODEL" "$PROMPT" --dir "$TMP" --auto 2>&1 | tail -1
  EN=$(ls "$TMP"/*.en.md 2>/dev/null | head -1); VI=$(ls "$TMP"/*.vi.md 2>/dev/null | head -1)
  if [ -n "$EN" ] && [ -n "$VI" ]; then
    cp "$EN" "$EN_SRC"; cp "$VI" "$VI_SRC"
    echo "REFACTORED $CAT/$SLUG"
  else
    echo "WARN: $CAT/$SLUG missing - skip"
  fi
  done=$((done+1)); batch=$((batch+1))
  if [ "$batch" -ge 4 ]; then
    git add -A
    git commit -q -m "refactor: rewrite batch (system-design/ai priority) up to $CAT/$SLUG" 2>&1 | tail -1
    git push origin main 2>&1 | tail -1
    batch=0
    echo "--- pushed batch at $done/$TOTAL ---"
  fi
done < /root/java-guru/refactor_queue_lines.txt

# final push
git add -A
git commit -q -m "refactor: final batch of article rewrites" 2>&1 | tail -1
git push origin main 2>&1 | tail -1
echo "REFACTOR DONE: $done articles"
