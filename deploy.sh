#!/bin/bash
# 日常部署脚本
#   ./deploy.sh         全量部署（上传源码 + 依赖 + prisma + 构建 + 重启后端）
#   ./deploy.sh web     仅部署前端（本地构建 → 上传 dist）
#   ./deploy.sh api     仅部署后端（上传源码 + shared/tsconfig → prisma → 构建 → 重启）
#                         前置依赖：远端需先跑过一次 full 部署（workspace 结构/pnpm install/prisma/scripts 在位）
#
# 注意：deploy.sh 不会覆盖服务器上的 .env 文件，环境变量需在服务器上手动管理。
# 发布门禁（0 号动作 E69①）：full/api 模式部署前本地跑 pnpm verify + gate-collab，
# 远端 prisma generate 后跑 migrate deploy（幂等），任一失败即中止（set -e）。

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

set -e

# 发布前置：verify（doc-gate+verify-indexes+全量 typecheck/test/lint）+ collab e2e gate。
# 需本地基础设施在位（PG/Redis/MinIO——gate 自拉 API + playwright）。
preflight() {
  echo "=== 发布前置：pnpm verify ==="
  cd "$(dirname "$0")" && pnpm verify

  echo "=== 发布前置：gate-collab ==="
  node scripts/gate-collab.mjs
}

# cutover_api（P43 改名——函数含 guard/重启，T8 扩为 guard→备份→migrate→切换→重启→post 全链）。
# 进程定义唯一源=ecosystem.config.cjs（冻结契约 9）。startOrReload 重读文件且幂等（B1′）。
# GIT_COMMIT_HASH 从产物 build-info.json 派生（P46——rollback 后自动说实话）；B25：--update-env 记录
# 当前 shell 全量 env——部署会话禁 export 其他变量（cutover/rollback 体内 export 白名单锚）。
cutover_api() {
  echo "=== 部署拒重启三步（Y0a-4：drain→own 四零→放行；guard 自读服务器 apps/api/.env） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA node scripts/deploy-guard.mjs $([[ $FORCE_RESTART == 1 ]] && echo --force) $([[ $ALLOW_LEGACY == 1 ]] && echo --allow-legacy)"

  echo "=== 重启后端（startOrReload——kill_timeout 45000 由 ecosystem 承载） ==="
  # T5 骨架过渡：GIT_COMMIT_HASH 暂注入当前 HEAD；T8 Step 2 定稿改产物 build-info.json 派生（P46）
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=$GIT_SHA && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"
}

# rollback_api（P37 快回滚——T5 骨架：dist.prev 翻回+startOrReload；T8 定稿 sha256 校验+post 段）
rollback_api() {
  echo "=== 快回滚（P37——T5 骨架，T8 定稿 sha256/post 段） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && [ -d dist.prev ] && mv dist dist.next && mv dist.prev dist && test -f dist/main.js"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && export GIT_COMMIT_HASH=\$(node -e \"console.log(require('./apps/api/dist/build-info.json').git)\" 2>/dev/null || echo $GIT_SHA) && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"
}

deploy_full() {
  echo "=== 上传源码 ==="
  tar czf - \
    --exclude='node_modules' --exclude='dist' --exclude='.turbo' \
    --exclude='backups' --exclude='.data' --exclude='.worktrees' \
    --exclude='.claude' --exclude='.git' --exclude='.env' \
    --exclude='.deploy-guard-state.json' --exclude='.preflight-*.ok' --exclude='.installed-lock-sha' \
    apps/ packages/ scripts/ package.json pnpm-workspace.yaml pnpm-lock.yaml \
    turbo.json tsconfig.base.json .eslintrc.base.json .gitignore ecosystem.config.cjs \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && tar xzf -"

  echo "=== 安装依赖 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm install"

  echo "=== 生成 Prisma Client ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma generate"

  echo "=== 应用数据库迁移（幂等） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma migrate deploy"

  echo "=== 构建 shared ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist && npx tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write"

  echo "=== 构建后端 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && rm -rf dist && npx nest build"

  echo "=== 构建前端 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web && npx vite build"

  cutover_api
}

deploy_web() {
  echo "=== 本地构建前端 ==="
  cd "$(dirname "$0")/apps/web" && rm -rf dist && npx vite build

  echo "=== 上传 dist ==="
  tar czf - -C dist . \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web/dist && rm -rf * && tar xzf -"

  echo "=== 完成（后端无需重启） ==="
}

deploy_api() {
  if [[ $ROLLBACK == 1 ]]; then rollback_api; return; fi
  echo "=== 上传后端源码 ==="
  tar czf - -C apps/api/src . \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api/src && tar xzf -"

  echo "=== 上传 shared 与仓根构建配置 ==="
  tar czf - -C packages/shared src tsconfig.json tsconfig.build.json package.json \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && tar xzf -"
  scp -i "$KEY" tsconfig.base.json "$SERVER:$REMOTE_DIR/tsconfig.base.json"

  echo "=== 生成 Prisma Client ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma generate"

  echo "=== 应用数据库迁移（幂等） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma migrate deploy"

  echo "=== 构建 shared 与后端（与 deploy_full 同一条命令） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist && npx tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && rm -rf dist && npx nest build"

  cutover_api
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
