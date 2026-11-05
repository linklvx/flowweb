#!/bin/bash
# T34 重认证 runner：逐条跑 steps.list，幂等（ok/ marker 跳过），失败续跑收集全貌。
# exit code 教训：禁管道吞码——cmd > log 2>&1; rc=$?。
cd /d/flowweb || exit 9
BASE=output/t34-recert
mkdir -p "$BASE/ok" "$BASE/logs"
export DATABASE_URL=$(sed -n 's/^DATABASE_URL="\{0,1\}\([^"]*\)"\{0,1\}\r\{0,1\}$/\1/p' apps/api/.env | head -1)
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL 提取失败"; exit 9; }
FAIL=0; RAN=0; SKIP=0
while IFS='|' read -r name cmd; do
  case "$name" in ''|'#'*) continue;; esac
  if [ -f "$BASE/ok/$name.ok" ]; then SKIP=$((SKIP+1)); continue; fi
  echo "── RUN $name: $cmd"
  bash -c "$cmd" > "$BASE/logs/$name.log" 2>&1
  rc=$?
  RAN=$((RAN+1))
  tail -3 "$BASE/logs/$name.log" | sed 's/^/    /'
  if [ $rc -eq 0 ]; then touch "$BASE/ok/$name.ok"; echo "    EXIT=0 OK";
  else FAIL=$((FAIL+1)); echo "    EXIT=$rc FAIL($name)"; fi
done < "$1"
echo "== runner done: ran=$RAN skip=$SKIP fail=$FAIL =="
exit $FAIL
