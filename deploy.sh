#!/bin/bash
# 日常部署脚本
#   ./deploy.sh         全量部署（上传源码 + 依赖 + prisma + 构建 + 重启后端）
#   ./deploy.sh web     仅部署前端（本地构建 → 上传 dist）
#   ./deploy.sh api     仅部署后端（上传源码 + shared/tsconfig → prisma → 构建 → 重启）
#                         前置依赖：远端需先跑过一次 full 部署（workspace 结构/pnpm install/prisma/scripts 在位）
#
# 注意：deploy.sh 不会覆盖服务器上的 .env 文件，环境变量需在服务器上手动管理。

SERVER="ubuntu@101.42.94.107"
KEY="$HOME/.ssh/flowweb_server"
REMOTE_DIR="/home/ubuntu/flowweb"
MODE="${1:-full}"

set -e

deploy_full() {
  echo "=== 上传源码 ==="
  tar czf - \
    --exclude='node_modules' --exclude='dist' --exclude='.turbo' \
    --exclude='backups' --exclude='.data' --exclude='.worktrees' \
    --exclude='.claude' --exclude='.git' --exclude='.env' \
    apps/ packages/ scripts/ package.json pnpm-workspace.yaml pnpm-lock.yaml \
    turbo.json tsconfig.base.json .eslintrc.base.json .gitignore \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && tar xzf -"

  echo "=== 安装依赖 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm install"

  echo "=== 生成 Prisma Client ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma generate"

  echo "=== 构建 shared ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist && npx tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write"

  echo "=== 构建后端 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && rm -rf dist && npx nest build"

  echo "=== 构建前端 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web && npx vite build"

  echo "=== 重启后端 ==="
  # kill_timeout 10000——enableShutdownHooks 后 server.destroy() 逐 doc flush 多次 DB 往返，超 pm2 默认 1600ms 即 SIGKILL 拆承重墙
  ssh -i "$KEY" "$SERVER" "pm2 restart flowweb-api --kill-timeout 10000"
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
  echo "=== 上传后端源码 ==="
  tar czf - -C apps/api/src . \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api/src && tar xzf -"

  echo "=== 上传 shared 与仓根构建配置 ==="
  tar czf - -C packages/shared src tsconfig.json tsconfig.build.json package.json \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && tar xzf -"
  scp -i "$KEY" tsconfig.base.json "$SERVER:$REMOTE_DIR/tsconfig.base.json"

  echo "=== 生成 Prisma Client ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx prisma generate"

  echo "=== 构建 shared 与后端（与 deploy_full 同一条命令） ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/packages/shared && rm -rf dist && npx tsc -p tsconfig.build.json && node ../../scripts/check-shared-dist.mjs --write"
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && rm -rf dist && npx nest build"

  echo "=== 重启后端 ==="
  # kill_timeout 10000——enableShutdownHooks 后 server.destroy() 逐 doc flush 多次 DB 往返，超 pm2 默认 1600ms 即 SIGKILL 拆承重墙
  ssh -i "$KEY" "$SERVER" "pm2 restart flowweb-api --kill-timeout 10000"
}

case "$MODE" in
  full) deploy_full ;;
  web)  deploy_web ;;
  api)  deploy_api ;;
  *)
    echo "用法: ./deploy.sh [full|web|api]"
    exit 1
    ;;
esac

echo ""
echo "=== 部署完成 === https://www.flow123.com"
