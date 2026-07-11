#!/bin/bash
# 日常部署脚本
#   ./deploy.sh         全量部署（上传源码 + 依赖 + 前端构建 + 重启后端）
#   ./deploy.sh web     仅部署前端（本地构建 → 上传 dist）
#   ./deploy.sh api     仅部署后端（上传源码 → 服务器构建 → 重启）

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
    --exclude='.claude' --exclude='.git' \
    apps/ packages/ package.json pnpm-workspace.yaml pnpm-lock.yaml \
    turbo.json tsconfig.base.json .eslintrc.base.json .gitignore \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && tar xzf -"

  echo "=== 安装依赖 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && pnpm install"

  echo "=== 构建前端 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web && npx vite build"

  echo "=== 重启后端 ==="
  ssh -i "$KEY" "$SERVER" "pm2 restart flowweb-api"
}

deploy_web() {
  echo "=== 本地构建前端 ==="
  cd "$(dirname "$0")/apps/web" && npx vite build

  echo "=== 上传 dist ==="
  tar czf - -C dist . \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/web/dist && rm -rf * && tar xzf -"

  echo "=== 完成（后端无需重启） ==="
}

deploy_api() {
  echo "=== 上传后端源码 ==="
  tar czf - -C apps/api/src . \
    | ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api/src && tar xzf -"

  echo "=== 服务器构建 ==="
  ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR/apps/api && npx nest build"

  echo "=== 重启后端 ==="
  ssh -i "$KEY" "$SERVER" "pm2 restart flowweb-api"
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
