#!/bin/bash
# 日常部署脚本（Y0a-4 T8 v4.2 定稿——本地构建+上传面+零服务器构建）
#   ./deploy.sh         全量部署（铺底 tar → web → api；install/generate/migrate 由 deploy_api→cutover 单点负责）
#   ./deploy.sh web     仅部署前端（本地构建 → 上传 → 原子切换）
#   ./deploy.sh api     仅部署后端（本地构建 → 上传 → 条件 install → cutover 全链：guard→备份→migrate→切换→重启→post）
#   ./deploy.sh api --rollback  快回滚（dist.prev 翻回+重启，30s；跳过 preflight）
#                         前置依赖：远端需先跑过一次 full 部署（workspace 结构/依赖在位）
#
# 注意：deploy.sh 不会覆盖服务器上的 .env 文件，环境变量需在服务器上手动管理。
# 发布门禁（0 号动作 E69①）：full/api 模式部署前本地跑 pnpm verify + int 单源链 + additive + gate-collab，
# 收据 .preflight-<SHA>.ok 同 SHA 幂等复用；任一失败即中止（set -e）。

cd "$(dirname "$0")"   # 相对路径基准固定（Y0a-4 T5）——后续 git rev-parse/tar/scp 一律仓根相对

SERVER="ubuntu@101.42.94.107"
KEY="$HOME/.ssh/flowweb_server"
REMOTE_DIR="/home/ubuntu/flowweb"
MODE="${1:-full}"
FORCE_RESTART=0; ALLOW_LEGACY=0; SKIP_SMOKE=0; SKIP_PREFLIGHT=0; ROLLBACK=0
for arg in "${@:2}"; do
  case "$arg" in
    --force-restart) FORCE_RESTART=1 ;;
    --allow-legacy) ALLOW_LEGACY=1 ;;
    --skip-smoke) SKIP_SMOKE=1 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "未知旗标: $arg（部署脚本禁静默忽略）"; exit 1 ;;
  esac
done
GIT_SHA=$(git rev-parse --short HEAD)

set -eo pipefail   # pipefail：上传管道（tar | ssh tar）tar 侧失败不被末位命令退 0 吞掉

# D3：trap 分阶段——SWITCH_BEGUN=进入切换（dist 可能已 mv 走）；SWITCHED=切换完整落地
SWITCHED=0; SWITCH_BEGUN=0
trap 'rc=$?; if [ $rc -ne 0 ]; then echo ""; echo "=== 部署中止（exit $rc）==="; \
  if [ $SWITCHED == 1 ]; then echo "新构建已上线但 post/冒烟未过——快回滚：./deploy.sh api --rollback（30s；跳过 preflight）；或修复后重新部署"; \
  elif [ $SWITCH_BEGUN == 1 ]; then echo "切换半途失败（dist 可能已 mv 走、dist.next 未就位）——**勿重启 pm2**：跑 ./deploy.sh api --rollback 或人工补 mv dist.next dist"; \
  else echo "旧构建仍在跑（dist 未切换）——修复后重跑即可；若已 drain：60s 自动解除（SV12）可安全重试"; fi; fi' EXIT

# 发布前置（D1/P20+P32+P36③）：git 断言→verify→int 单源链→本地 migrate+additive；收据同 SHA 幂等复用。
# 需本地基础设施在位（PG/Redis/MinIO——gate 自拉 API + playwright）。gate-collab 不进收据（有状态——每次都跑）。
preflight() {
  cd "$(dirname "$0")"
  local SHA; SHA=$(git rev-parse HEAD)
  # git 两条断言移出收据分支（毫秒级幂等；产物来自工作树——同 SHA 脏树禁部署）
  echo "=== 发布前置：git 状态断言 ==="
  git diff --quiet && git diff --cached --quiet || { echo "工作树不干净——先 commit"; exit 1; }
  git fetch -q origin master || echo "WARNING: git fetch 失败——ancestor 判定用本地 origin/master（可能陈旧）"
  git merge-base --is-ancestor HEAD origin/master \
    || { echo "HEAD 未在 origin/master 上（未经 CI 的提交禁部署）"; exit 1; }

  if [[ -f ".preflight-${SHA}.ok" && "$SKIP_PREFLIGHT" != "1" ]]; then
    echo "=== 复用预检收据 .preflight-${SHA}.ok（同 SHA 幂等步骤〔verify/int/migrate/additive〕不重跑） ==="
  elif [[ "$SKIP_PREFLIGHT" == "1" ]]; then
    echo "=== --skip-preflight：本次部署不构成判据（强制声明，留部署记录） ==="
  else
    echo "=== 发布前置：pnpm verify（含 check-ecosystem+node --test scripts/） ==="
    pnpm verify

    echo "=== 发布前置：int 真库套件单源链（P32——裸 test:int 在 DATABASE_URL 缺失时全 skip 退出码 0=假绿） ==="
    node scripts/deploy-preflight-int.mjs
    echo "=== 提示：跑 int 前确认本地 dev API 已停（int 操作 CollabLease 单行——会把 dev 实例 fenced） ==="

    echo "=== 发布前置：本地 prisma migrate deploy（防御）+迁移 additive 检查 ==="
    (cd apps/api && npx prisma migrate deploy)
    node scripts/check-migration-additive.mjs
    touch ".preflight-${SHA}.ok"   # 收据（gitignored）
  fi
  [[ "$SKIP_PREFLIGHT" == "1" ]] || node scripts/gate-collab.mjs
}

# cutover_api（P43 改名——v4.2 全链：⓪fetch 门→①guard→②备份→③additive+migrate→③.5 spool 树外迁移
# →④dist 原子切换→⑤重启→⑥post+冒烟）。进程定义唯一源=ecosystem.config.cjs（冻结契约 9）。
# GIT_COMMIT_HASH 从产物 build-info.json 派生（P46——rollback 后自动说实话）；B25：--update-env 记录
# 当前 shell 全量 env——部署会话禁 export 其他变量（cutover/rollback 体内 export 白名单锚）。
cutover_api() {
  echo "=== ⓪前置（Node≥18 fetch+Node≥22 WebSocket 双门——deploy-guard 用 fetch；collab-smoke 的 provider 用原生 WebSocket（Node 20 无——Y0a-4 实测冒烟挂 WebSocket is not defined 后服务器已升 22） ==="
  ssh -i "$KEY" "$SERVER" 'node -e "process.exit(typeof fetch===\"function\"?0:1)" && node -e "process.exit(typeof WebSocket===\"function\"?0:1)" || { echo "服务器 Node 不满足（需 ≥18 fetch/≥22 WebSocket）——runbook §0 前置条件"; exit 1; }'

  echo "=== ①部署拒重启三步（guard 写 .deploy-guard-state.json——epoch 经状态文件交接+全退出路径含 degraded+放行点基线收口） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs $([[ $FORCE_RESTART == 1 ]] && echo --force) $([[ $ALLOW_LEGACY == 1 ]] && echo --allow-legacy)"

  echo "=== ②迁移前备份（D6：migrate=链上唯一不可逆操作。pg_dump 走 libpq——DSN 去引号+剥 Prisma 参数；保留 5 份） ==="
  ssh -i "$KEY" "$SERVER" 'DSN=$(grep -m1 "^DATABASE_URL=" '"$REMOTE_DIR"'/apps/api/.env | cut -d= -f2- | tr -d "\"" | sed "s/?.*$//"); mkdir -p ~/backups && pg_dump -Fc "$DSN" -f ~/backups/pre-migrate-$(date +%Y%m%d%H%M%S).dump && ls -t ~/backups/pre-migrate-*.dump | tail -n +6 | xargs -r rm'

  echo "=== ③additive 双检+迁移（drain 只冻结 collab 写路径，HTTP 面继续打库——安全性由 additive 锚承担非由顺序承担） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && node scripts/check-migration-additive.mjs && cd apps/api && npx prisma migrate deploy"

  echo "=== ③.5 spool 账本条件迁移（P47——guard 后/切换前秒级窗口；目标=树外 flowweb-data；幂等可重跑） ==="
  ssh -i "$KEY" "$SERVER" 'OLD_DIR=$(sudo readlink /proc/$(pm2 pid flowweb-api)/cwd)/.data/collab-spool; NEW_DIR=/home/ubuntu/flowweb-data/collab-spool; if [ "$OLD_DIR" = "$NEW_DIR" ]; then echo "旧目录=新目录（$NEW_DIR）——无需迁移"; exit 0; fi; OLD_N=$(find "$OLD_DIR" -type f 2>/dev/null | wc -l); if [ "$OLD_N" = 0 ]; then echo "旧目录 $OLD_DIR 空或不存在——无需迁移（仅建新目录）"; mkdir -p "$NEW_DIR"; exit 0; fi; echo "迁移 $OLD_DIR → $NEW_DIR（$OLD_N 个文件）"; (command -v rsync >/dev/null && rsync -a "$OLD_DIR"/ "$NEW_DIR"/) || cp -a "$OLD_DIR"/. "$NEW_DIR"/; NEW_N=$(find "$NEW_DIR" -type f | wc -l); echo "迁移后：old=$OLD_N new=$NEW_N"; [ "$OLD_N" -le "$NEW_N" ] || { echo "计数不等——中止部署（人工核对）"; exit 1; }'

  echo "=== ④dist 原子切换（guard 拒→dist 未动=旧构建继续跑；全链 && 禁 ; 吞错+test -f+sha256 先验后换〔P49②〕+shared 同窗切换〔P49③〕+删 SWITCH_BEGUN 失败复位〔C6〕） ==="
  SWITCH_BEGUN=1
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && test -f dist.next/main.js && echo '$MAIN_SHA  dist.next/main.js' | sha256sum -c - && rm -rf dist.prev && { [ ! -d dist ] || mv dist dist.prev; } && mv dist.next dist && test -f dist/main.js" \
    && ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist.prev && { [ ! -d dist ] || mv dist dist.prev; } && mv dist.next dist" \
    && SWITCHED=1 || { echo "切换失败——dist 可能已 mv 走/半切换：**勿重启 pm2**，跑 ./deploy.sh api --rollback 或人工补 mv dist.next dist"; exit 1; }

  echo "=== ⑤重启（startOrReload+GIT_COMMIT_HASH 从产物派生〔P46——rollback 后自动说实话〕） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=\$(node -e \"console.log(require('./apps/api/dist/build-info.json').git)\") && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"

  echo "=== ⑥post-deploy：ready 轮询（读 body 非 -f 状态码）+上传面三件+3001 监听+post 段+冒烟+NODE_ENV 姿态 ==="
  ssh -i "$KEY" "$SERVER" 'i=0; ok=""; body=""; while [ $i -lt 60 ]; do i=$((i+1)); body=$(curl -s http://127.0.0.1:3000/api/ready 2>/dev/null); if echo "$body" | grep -q "\"ready\":true"; then ok=1; break; fi; sleep 1; done; if [ -z "$ok" ]; then echo "ready 60s 未达（最后响应: $body）"; exit 1; fi; echo "ready barrier after ${i}s（RTO 见 guard post JSON elapsedMs）"'
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && test -f ecosystem.config.cjs && test -d scripts && test -d apps/api/scripts || { echo '上传面三件缺失（ecosystem/scripts/apps-api-scripts）'; exit 1; }"
  ssh -i "$KEY" "$SERVER" 'node -e "require(\"net\").connect(3001,\"127.0.0.1\").on(\"connect\",()=>{console.log(\"3001 listening\");process.exit(0)}).on(\"error\",()=>{console.error(\"3001 未监听\");process.exit(1)})"'
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs --post-restart"
  if [[ $SKIP_SMOKE == 1 ]]; then
    echo "=== 冒烟已跳过（--skip-smoke）——本次部署不构成完整判据 ==="
  else
    ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm --filter @flowweb/api exec node scripts/collab-smoke.mjs"
  fi
  ssh -i "$KEY" "$SERVER" 'grep -q "^NODE_ENV=.\+" '"$REMOTE_DIR"'/apps/api/.env || echo "WARNING: 服务器 NODE_ENV 未设/空——语义不一致，Y0.5/E58 审计"'
}

# rollback_api（P37 快回滚：dist.prev 翻回+重启——30 秒；分派层跳过 preflight）+post 段带 GIT_SHA
# （P39 同 SHA 复用基线）；GIT_COMMIT_HASH 从 dist.prev 的 build-info 派生（P46；早于 P46 的构建缺失时 unknown 兜底）。
rollback_api() {
  echo "=== 快回滚（P37：dist.prev 翻回+重启——30 秒；分派层跳过 preflight）+post 段带 GIT_SHA（P39 同 SHA 复用基线）；GIT_COMMIT_HASH 从 dist.prev 的 build-info 派生（P46） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && [ -d dist.prev ] || { echo '无 dist.prev——回滚走 git revert+重新部署'; exit 1; } && rm -rf dist.next && mv dist dist.next && mv dist.prev dist && test -f dist/main.js"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=\$(node -e \"console.log(require('./apps/api/dist/build-info.json').git)\" 2>/dev/null || echo unknown) && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs --post-restart"
  echo "=== 回滚完成（上一代 dist 已上线，pm2_env.GIT_COMMIT_HASH=上一代构建 SHA）——回滚不构成判据；修复后正式部署仍需完整链 ==="
}

# P48：provision_tarball=原 full tar 铺底段改造（清单含 ecosystem.config.cjs；exclude 补三标记文件——
# 被上传=服务器"看起来像已预检"语义污染）；install/generate/migrate 不在此（唯一所有者=deploy_api/cutover）。
provision_tarball() {
  echo "=== 铺底：上传源码树（服务器只作部署树，不构建——零构建锚） ==="
  tar czf - \
    --exclude='node_modules' --exclude='dist' --exclude='.turbo' \
    --exclude='backups' --exclude='.data' --exclude='.worktrees' \
    --exclude='.claude' --exclude='.git' --exclude='.env' \
    --exclude='.deploy-guard-state.json' --exclude='.preflight-*.ok' --exclude='.installed-lock-sha' \
    apps/ packages/ scripts/ ecosystem.config.cjs package.json pnpm-workspace.yaml pnpm-lock.yaml \
    turbo.json tsconfig.base.json .eslintrc.base.json .gitignore \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && tar xzf -"
}

deploy_web() {
  echo "=== 本地构建前端（子 shell——cd 不污染后续相对路径；version.json 与 api build-info 同构〔P46〕） ==="
  ( cd "$(dirname "$0")/apps/web" && rm -rf dist && npx vite build && printf '{"git":"%s","builtAt":"%s"}\n' "$GIT_SHA" "$(date -u +%FT%TZ)" > dist/version.json )

  echo "=== 上传+原子切换（dist.next→mv——对齐 api 侧形态；dist.prev 保留一代） ==="
  tar czf - -C apps/web/dist . | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web && rm -rf dist.next && mkdir -p dist.next && cd dist.next && tar xzf - && cd .. && rm -rf dist.prev && { [ ! -d dist ] || mv dist dist.prev; } && mv dist.next dist"

  echo "=== 完成（后端无需重启；version.json 可验：curl -s https://www.flow123.com/version.json） ==="
}

deploy_api() {
  if [[ $ROLLBACK == 1 ]]; then rollback_api; return; fi
  echo "=== 磁盘水位前置（pg_dump 与 dist tar 需空间——>85% 拒；USED 空串/非数 fail-closed） ==="
  USED=$(ssh -i "$KEY" "$SERVER" "df --output=pcent / | tail -1 | tr -dc '0-9'")
  [[ "$USED" =~ ^[0-9]+$ ]] || { echo "磁盘水位探测失败（USED='${USED}'）——fail-closed 拒部署"; exit 1; }
  [[ "$USED" -le 85 ]] || { echo "服务器磁盘 ${USED}%>85%——先清理再部署（pg_dump/dist tar 可能半途失败）"; exit 1; }

  echo "=== 本地构建（构建前清 dist——nest-cli 无 deleteOutDir，不清=旧 .js 残留随 tar 上传=幽灵代码搬层） ==="
  node -e "require('node:fs').rmSync('apps/api/dist',{recursive:true,force:true});require('node:fs').rmSync('packages/shared/dist',{recursive:true,force:true})"
  pnpm --filter @flowweb/shared build && pnpm --filter @flowweb/api build
  node scripts/check-no-testutils-in-dist.mjs   # J7：检查对象=即将上传的 dist（verify 链里那次的产物已被 rmSync 丢弃）
  test ! -e apps/api/dist/tsconfig.drill.tsbuildinfo && test ! -d apps/api/dist/scripts || { echo "dist 新鲜度锚红：drill 产物残留（rmSync 未生效或构建混入）"; exit 1; }
  printf '{"git":"%s","builtAt":"%s"}\n' "$GIT_SHA" "$(date -u +%FT%TZ)" > apps/api/dist/build-info.json   # P46：溯源随产物
  MAIN_SHA=$(sha256sum apps/api/dist/main.js | cut -d' ' -f1)   # P44②：cutover ④ 远端等值断言用（先验后换）

  echo "=== 上传（dist.next+prisma/scripts×2/ecosystem/manifests——src 不再上传；shared dist 解 dist.next 不先 rm 远端〔P49③〕） ==="
  scp -i "$KEY" ecosystem.config.cjs "$SERVER:$REMOTE_DIR/"
  tar czf - -C apps/api/dist . | ssh -i "$KEY" "$SERVER" "rm -rf $REMOTE_DIR/apps/api/dist.next && mkdir -p $REMOTE_DIR/apps/api/dist.next && cd $REMOTE_DIR/apps/api/dist.next && tar xzf -"
  scp -i "$KEY" apps/api/package.json "$SERVER:$REMOTE_DIR/apps/api/package.json"
  scp -i "$KEY" apps/web/package.json "$SERVER:$REMOTE_DIR/apps/web/package.json"
  scp -i "$KEY" packages/shared/package.json "$SERVER:$REMOTE_DIR/packages/shared/package.json"
  scp -i "$KEY" pnpm-lock.yaml package.json "$SERVER:$REMOTE_DIR/"
  tar czf - -C packages/shared/dist . | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist.next && mkdir dist.next && cd dist.next && tar xzf -"
  tar czf - -C apps/api/prisma . | ssh -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/apps/api/prisma && cd $REMOTE_DIR/apps/api/prisma && tar xzf -"
  tar czf - -C scripts . | ssh -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/scripts && cd $REMOTE_DIR/scripts && tar xzf -"
  tar czf - -C apps/api/scripts . | ssh -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/apps/api/scripts && cd $REMOTE_DIR/apps/api/scripts && tar xzf -"

  echo "=== 服务器：generate+标记文件条件 install（比较对象=.installed-lock-sha；默认 install 装 prod+dev——prisma CLI 是 devDep 却被部署链 load-bearing，行为断言承载） ==="
  LOCK_LOCAL=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
  LOCK_DONE=$(ssh -i "$KEY" "$SERVER" "cat $REMOTE_DIR/.installed-lock-sha 2>/dev/null || true")
  if [[ -n "$LOCK_DONE" && "$LOCK_LOCAL" == "$LOCK_DONE" ]]; then
    echo "lockfile 未变（.installed-lock-sha 命中）——跳过 pnpm install"
    ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma generate"
  else
    ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm install --frozen-lockfile && cd apps/api && npx prisma generate && test -x node_modules/.bin/prisma || { echo 'devDependency prisma 缺失——install 裁掉了部署链 load-bearing 的 CLI（A3 行为断言）'; exit 1; }" \
      && ssh -i "$KEY" "$SERVER" "sha256sum $REMOTE_DIR/pnpm-lock.yaml | cut -d' ' -f1 > $REMOTE_DIR/.installed-lock-sha"
  fi

  cutover_api
}

# P48：三行顺次——每行独立语句=errexit 逐条生效（B28：fn1 && fn2; 非末位失败被吞+未定义函数被 AND-OR 吞）
deploy_full() {   # 首次铺底专用：tar 铺底 → web → api（install/generate/migrate 由 deploy_api→cutover 单点负责）
  provision_tarball
  deploy_web
  deploy_api
}

case "$MODE" in
  full) [[ $ROLLBACK == 1 ]] && { echo "--rollback 仅支持 api 模式（web 无回滚点/full=铺底）"; exit 1; }; preflight; deploy_full ;;
  web)  deploy_web ;;
  api)  if [[ $ROLLBACK == 1 ]]; then echo "=== 快回滚：跳过 preflight/verify/int（事故路径——runbook §5） ==="; deploy_api; else preflight; deploy_api; fi ;;
  *)
    echo "用法: ./deploy.sh [full|web|api] [--force-restart|--allow-legacy|--skip-smoke|--skip-preflight|--rollback]"
    exit 1
    ;;
esac

echo ""
echo "=== 部署完成 === https://www.flow123.com"
