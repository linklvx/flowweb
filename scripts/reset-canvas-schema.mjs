#!/usr/bin/env node
// scripts/reset-canvas-schema.mjs
// O0b-0（Spec B）格式批清库脚本（可重复执行）：doc rel→abs 翻转后旧 v1 doc 无迁移直接拒——
// 开发库全量清画布域数据（无用户数据，禁垫片/向后兼容）。
//
// DELETE 顺序（终裁 92 FK 面全覆盖——FK 子表先行→父表→无 FK 关联表删行非清列）：
//   FK 子表：ProjectMember→VideoProject→Template→CanvasDoc→CanvasDocUpdate→父表 CanvasProject
//     （CanvasProject 的 FK 子表实测 5 条：Template[SetNull]+CanvasDoc/ProjectMember/CanvasDocUpdate/
//      VideoProject[Cascade]——TRUNCATE 父表在 FK 引用时直接报错，故逐表 DELETE）
//   无 FK 关联表删行（清列留幽灵行：/videos 列表可见而 process 404；
//     GenerationIntent @@unique([projectId, intentId]) 遇 NULL 失去去重约束[PG NULL 互不相等]）：
//     Media/GenerationIntent 按 projectId 删行、VideoWork 按 canvasProjectId 删行
// + Redis SCAN `videoWork:process:*` 删（快照缓存 300s 窗口——翻转后旧空间载荷即公开页鬼影）。
//
// 连接参数从 apps/api/.env 的 DATABASE_URL/REDIS_URL 读（不打印密码）。
// 锚（重置后人工对账）：/works /videos /materials credits 无幽灵行。
//
// 用法：node scripts/reset-canvas-schema.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(ROOT, 'apps/api/package.json'));

// ── 读 .env（apps/api/.env——只取 DATABASE_URL/REDIS_URL，不打印密码） ──
function loadEnv() {
  let raw = '';
  try {
    raw = readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8');
  } catch {
    console.error('[reset-canvas-schema] apps/api/.env 不存在——无法读连接参数');
    process.exit(1);
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(DATABASE_URL|REDIS_URL)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();
const databaseUrl = env.DATABASE_URL;
const redisUrl = env.REDIS_URL ?? 'redis://localhost:6379/0';
if (!databaseUrl) {
  console.error('[reset-canvas-schema] apps/api/.env 缺 DATABASE_URL');
  process.exit(1);
}
// 非本地库防误清：host 非 localhost/127.0.0.1 时需显式 --force（不加 stdin 确认——本机开发流程要可重复执行）
const dbHost = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1'].includes(dbHost) && !process.argv.includes('--force')) {
  console.error(`[reset-canvas-schema] 非本地库拒绝执行（当前 host=${dbHost}）需 --force`);
  process.exit(1);
}
// 脱敏展示（不打印密码）
const safeDb = databaseUrl.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@');
console.log(`[reset-canvas-schema] DB=${safeDb}  REDIS=${redisUrl.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@')}`);

// ── PG：FK 子表先行→父表→无 FK 关联表（依赖从 apps/api 解析 pg） ──
const { Client } = requireApi('pg');
const client = new Client({ connectionString: databaseUrl });
await client.connect();

const orderedDeletes = [
  // FK 子表先行
  ['ProjectMember', `DELETE FROM "ProjectMember"`],
  ['VideoProject', `DELETE FROM "VideoProject"`],
  ['Template', `DELETE FROM "Template"`],
  ['CanvasDoc', `DELETE FROM "CanvasDoc"`],
  ['CanvasDocUpdate', `DELETE FROM "CanvasDocUpdate"`],
  // 父表
  ['CanvasProject', `DELETE FROM "CanvasProject"`],
  // 无 FK 关联表删行非清列（清列留幽灵行）
  ['Media', `DELETE FROM "Media" WHERE "projectId" IS NOT NULL`],
  ['GenerationIntent', `DELETE FROM "GenerationIntent" WHERE "projectId" IS NOT NULL`],
  ['VideoWork', `DELETE FROM "VideoWork" WHERE "canvasProjectId" IS NOT NULL`],
];

for (const [label, sql] of orderedDeletes) {
  const r = await client.query(sql);
  console.log(`[reset-canvas-schema] ${label}: ${r.rowCount} 行删除`);
}
await client.end();
console.log('[reset-canvas-schema] PG 画布域清空完毕');

// ── Redis：SCAN videoWork:process:* 删（ioredis 从 apps/api 解析） ──
const Redis = requireApi('ioredis');
const redis = new Redis(redisUrl);
let cursor = '0';
let deleted = 0;
do {
  const [next, keys] = await redis.scan(cursor, 'MATCH', 'videoWork:process:*', 'COUNT', 100);
  cursor = next;
  if (keys.length > 0) deleted += await redis.del(...keys);
} while (cursor !== '0');
await redis.quit();
console.log(`[reset-canvas-schema] Redis videoWork:process:* 删 ${deleted} 键`);

console.log('[reset-canvas-schema] 完成——锚（人工对账）：重启 api/web 后 /works /videos /materials credits 对账无幽灵行');
console.log('[reset-canvas-schema] 回滚纪律：回滚 O0b-0 格式批必须重跑本脚本（旧 gate-seed 无 meta 戳）；gate-seed 重跑=node --experimental-strip-types apps/api/prisma/gate-seed.ts（或 pnpm --filter @flowweb/api exec tsx prisma/gate-seed.ts）');
