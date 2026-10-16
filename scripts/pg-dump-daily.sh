#!/usr/bin/env bash
# scripts/pg-dump-daily.sh — Y0c T38（Z16①）：每日 pg_dump + 保留滚动 + 水位守护。
# crontab（服务器，check-collab-health 旁）：
#   17 3 * * * cd /home/ubuntu/flowweb && bash scripts/pg-dump-daily.sh >> .data/pg-dump-daily.log 2>&1
#
# 删除面纪律：本脚本只删 daily-* 族（pre-migrate-* = deploy.sh ② 迁移回滚锚，
# 5 份滚动归 deploy.sh 所有权，跨所有者删除=越权——§0.6 偏离 60）。
# 失败不删旧：pg_dump 任何失败路径零删除动作 + exit 非零 + ERROR 日志（现场 .tmp 保留排障）。
#
# 两个 env 覆写 = 演练/测试面（非配置灵活性——生产 crontab 恒默认值）：
#   BACKUP_DIR    备份目录（默认 ~/backups）——演练指向 /tmp 隔离目录，真实备份零接触
#   WATERMARK_PCT 水位阈值（默认 85）——df 口径对齐 deploy.sh deploy_api >85% 拒部署门
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-$HOME/backups}
WATERMARK_PCT=${WATERMARK_PCT:-85}
KEEP_DAILY=14
ENV_FILE=$REPO_DIR/apps/api/.env

log() { echo "[$(date '+%F %T')] $*"; }
die() { log "ERROR $*"; exit 1; }

# ── 1. DSN 提取（deploy.sh ② 同款：去引号+剥 Prisma 参数走 libpq；DSN 永不落日志）──
[[ -f $ENV_FILE ]] || die "缺 $ENV_FILE（须在仓根部署目录内运行）"
DSN=$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | sed 's/?.*$//')
[[ -n $DSN ]] || die "DATABASE_URL 提取为空——中止（零删除动作）"

# ── 2. atomic dump：先写 .tmp，exit 0 且非空才 mv 转正（失败不删旧）──
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d%H%M%S)
TMP=$BACKUP_DIR/.daily-$TS.dump.tmp
FINAL=$BACKUP_DIR/daily-$TS.dump
log "start BACKUP_DIR=$BACKUP_DIR WATERMARK_PCT=$WATERMARK_PCT KEEP_DAILY=$KEEP_DAILY"
log "pg_dump -Fc → $TMP（atomic：exit 0 且非空才 mv 为 daily-$TS.dump）"
if ! pg_dump -Fc "$DSN" -f "$TMP"; then
  die "pg_dump 失败——零删除动作，现场保留 $TMP 排障"
fi
[[ -s $TMP ]] || die "pg_dump exit 0 但产物为空——零删除动作，现场保留 $TMP"
mv "$TMP" "$FINAL"
log "dump 成功：$FINAL（$(stat -c%s "$FINAL") bytes）"

# ── 3. 保留滚动（日常删除面：daily-* 保留 KEEP_DAILY 份，超出删最旧——文件名 %Y%m%d%H%M%S 时序）──
mapfile -t DAILIES < <(find "$BACKUP_DIR" -maxdepth 1 -name 'daily-*.dump' | LC_ALL=C sort)
if (( ${#DAILIES[@]} > KEEP_DAILY )); then
  printf '%s\n' "${DAILIES[@]:0:${#DAILIES[@]}-KEEP_DAILY}" | while read -r old; do
    rm "$old" && log "保留滚动：删最旧 $old（>${KEEP_DAILY} 份）"
  done
fi

# ── 4. 水位守护（应急删除面：>WATERMARK_PCT 优先删最旧 daily-*，直到达标或族耗尽）──
used=$(df --output=pcent "$BACKUP_DIR" | tail -1 | tr -dc '0-9')
[[ $used =~ ^[0-9]+$ ]] || die "水位探测失败（used='${used}'）——fail-closed（deploy.sh 同款判据）"
while (( used > WATERMARK_PCT )); do
  mapfile -t DAILIES < <(find "$BACKUP_DIR" -maxdepth 1 -name 'daily-*.dump' | LC_ALL=C sort)
  if (( ${#DAILIES[@]} == 0 )); then
    die "水位守护失败：daily-* 族耗尽，文件系统仍 ${used}%>${WATERMARK_PCT}%（pre-migrate-* 归 deploy.sh 所有权不越权删——§0.6 偏离 60；须人工介入）"
  fi
  oldest=${DAILIES[0]}
  rm "$oldest"
  log "水位守护：${used}%>${WATERMARK_PCT}% 删最旧 $oldest"
  used=$(df --output=pcent "$BACKUP_DIR" | tail -1 | tr -dc '0-9')
done
log "水位守护：${used}%<=${WATERMARK_PCT}% 通过"
log "done OK：$FINAL"
