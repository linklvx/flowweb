#!/usr/bin/env node
// scripts/dev-reset-canvas.mjs
// T18（plan v11.2 S5 片·v11.1 ⑤）：dev 全表 reset——collab/产物/媒体/资金任务域清库+队列+缓存+对象存储+IDB 指引。
//
// 安全五件套（v11.1 ⑤ 裁定——red：非白名单环境/生产 DB 拒执行）：
//   ① 环境白名单：NODE_ENV=production 拒执行；
//   ② 目标库校验：DATABASE_URL host 必须 ∈ {localhost,127.0.0.1,::1}（非本地=疑似生产——拒）；
//   ③ 默认 dry-run：无 --apply 只打印计划零执行；
//   ④ 路径限定：MinIO 只清 temp//uploads//results/ 三前缀（buildKey 词表单源——卡文「artifacts」=
//     代码事实的 results/）；spool 只清 COLLAB_SPOOL_DIR（缺省 apps/api/.data/collab-spool）目录内容；
//      Redis 只 SCAN 固定模式清单（禁 FLUSHDB/FLUSHALL）；
//   ⑤ 禁连生产：①②双门（host 白名单+NODE_ENV）——两道独立闸。
//
// 清面（PG 表序=FK 子表先行；CanvasProject/Template/VideoWork 项目壳不在此域——旧脚本
// reset-canvas-schema.mjs（O0b-0 画布域含项目行）与本脚本**并存非取代**：范围不同〔本卡=
// collab/产物/媒体/资金任务运维域；旧卡=格式批项目域〕——处置裁定见 T18 报告）：
//   ProjectMember? 否——项目壳保留故成员保留；删：NodeArtifact→ArtifactProjection→MediaBinding
//   →MediaFactOutbox→CanvasDocUpdate→CanvasDoc→Media 全量（含上传）→GenerationIntent→
//   TeamCreditTransaction→LightingTask。
//
// 两轮零回灌：连跑两轮，第二轮全计数为零（api/worker 停写前提——回灌源=进程重建行/队列回投）。
//
// MinIO 不可达容忍（127.0.0.1:9000 本机常未启动）：try/catch 警告跳过不失败。
// IDB 是浏览器端——脚本无法清：打印 DevTools 清理指引（最窄交付=文档+console 提示）。
//
// 用法：node scripts/dev-reset-canvas.mjs [--apply]
import { readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(ROOT, 'apps/api/package.json'));

function loadEnv() {
  let raw = '';
  try { raw = readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8'); } catch { /* 统一报错 */ }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(DATABASE_URL|REDIS_URL|COLLAB_SPOOL_DIR|MINIO_ENDPOINT|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|MINIO_BUCKET|MINIO_USE_SSL)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** 安全门执行（main 首段——模块顶层零副作用：测试 import 导出面不触发门/连接）。
 *  返回过门后的 { env, APPLY, databaseUrl }（拒执行=process.exit(1)）。 */
function runGates() {
  const env = loadEnv();
  const APPLY = process.argv.includes('--apply');
  // ── 安全门 ①⑤：环境白名单+禁连生产 ──
  if (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') {
    console.error('[dev-reset-canvas] NODE_ENV=production 拒执行（安全门①——本脚本仅限 dev/test 库）');
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;   // process.env 优先（测试注入缝+12-factor 惯例）
  if (!databaseUrl) { console.error('[dev-reset-canvas] apps/api/.env 缺 DATABASE_URL'); process.exit(1); }
  // ── 安全门 ②：目标库校验（host 白名单——非本地=疑似生产拒） ──
  const dbHost = new URL(databaseUrl).hostname;
  if (!isLocalDbHost(databaseUrl)) {
    console.error(`[dev-reset-canvas] 非本地库拒绝执行（安全门②——host=${dbHost} ∉ {localhost,127.0.0.1,::1}；疑似生产库禁连）`);
    process.exit(1);
  }
  // ── 安全门 ③：默认 dry-run ──
  if (!APPLY) console.log('[dev-reset-canvas] dry-run（默认）——加 --apply 执行');
  const safeDb = databaseUrl.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@');
  console.log(`[dev-reset-canvas] DB=${safeDb}`);
  return { env, APPLY, databaseUrl };
}

// ── PG：全表清（FK 子表先行——纯列关联表无 FK 约束序敏感，仍按依赖语义序） ──
const TABLES = [
  'NodeArtifact',          // 产物权威（无 FK——先清供投影/outbox 语义归零）
  'ArtifactProjection',    // 投影 outbox
  'MediaBinding',          // doc 引用索引（FK→Media——先于 Media）
  'MediaFactOutbox',       // 媒体事实 outbox
  'CanvasDocUpdate',       // 增量账本（FK→CanvasProject）
  'CanvasDoc',             // doc 态（FK→CanvasProject）
  'Media',                 // 全量（含上传——projectId 无关行同清）
  'GenerationIntent',      // 资金意图
  'TeamCreditTransaction', // 团队积分流水（append-only 审计——dev 全清）
  'LightingTask',          // 打光任务
];

async function resetPg(databaseUrl, APPLY) {
  const { Client } = requireApi('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const counts = {};
  // T19 登记收口（T18-④）：dry-run 试 ledger 通行证——BEGIN+SET LOCAL app.ledger_tx+ROLLBACK
  // 零删除但真验证 trigger 通行语义（apply 轮才发现通行证坏=dry-run 假绿灯——trigger 定义变更/
  // 权限面变化的提前暴露；int specs 同款 SET LOCAL 形态）。
  if (!APPLY) {
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.ledger_tx = 'on'");
      await client.query('ROLLBACK');
      console.log('[dev-reset-canvas] dry-run ledger 通行证验证 OK（BEGIN+SET LOCAL+ROLLBACK——apply 轮 TeamCreditTransaction 删除前提）');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[dev-reset-canvas] dry-run ledger 通行证验证失败（apply 轮 TeamCreditTransaction 删除将被 trigger 拒）: ${e.message}`);
      await client.end();
      throw e;
    }
  }
  for (const t of TABLES) {
    if (!APPLY) {
      const n = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`).catch(() => ({ rows: [{ n: -1 }] }));
      counts[t] = `${n.rows[0].n} 行（计划清）`;
      continue;
    }
    if (t === 'TeamCreditTransaction') {
      // ledger 单写者触发器（check-ledger-single-writer 面）：裸 DELETE 被 PG trigger 拒——通行证=
      // 事务内 SET LOCAL app.ledger_tx='on'（int specs 同款；dev reset=合法维护写非绕过）。
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL app.ledger_tx = 'on'");
        const r = await client.query(`DELETE FROM "${t}"`);
        await client.query('COMMIT');
        console.log(`[dev-reset-canvas] ${t}: ${r.rowCount} 行删除（ledger_tx 通行证）`);
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      continue;
    }
    const r = await client.query(`DELETE FROM "${t}"`);
    counts[t] = `${r.rowCount} 行删除`;
    console.log(`[dev-reset-canvas] ${t}: ${r.rowCount} 行删除`);
  }
  if (!APPLY) console.log(`[dev-reset-canvas] dry-run PG 计划：${JSON.stringify(counts)}`);
  await client.end();
}

// ── BullMQ 队列 obliterate（QUEUE_NAMES 单源 requireApi——禁本地抄清单） ──
async function resetQueues(env, APPLY) {
  const { QUEUE_NAMES } = requireApi('./dist/config/queue.constants.js');   // dist 面（TS 源不可直 require——与 census 消费 shared dist 同前提；nest build 产物）
  const Redis = requireApi('ioredis');
  const { Queue } = requireApi('bullmq');
  const redisUrl = env.REDIS_URL ?? 'redis://localhost:6379/0';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true, connectionName: 'dev-reset-canvas' });
  try {
    await redis.connect();
  } catch (e) {
    console.warn(`[dev-reset-canvas] Redis 不可达（${e.message}）——队列/键清理跳过（警告不失败）`);
    return;
  }
  // T18 评审 P2#4：每队列 duplicate 连接显式持有+finally 全量 quit——Queue.close() 不保证关闭
  // 注入的 ioredis 实例（实测 10 连接残留⇒进程不退出 EXIT=124）；禁裸 redis.duplicate() 丢弃引用。
  const conns = [];
  try {
    for (const name of Object.values(QUEUE_NAMES)) {
      const conn = redis.duplicate();
      conns.push(conn);
      const q = new Queue(name, { connection: conn });
      try {
        const before = await q.getJobCounts().catch(() => null);
        if (APPLY) {
          await q.obliterate({ force: true });
          console.log(`[dev-reset-canvas] 队列 ${name} obliterate（清前 job 计数=${before ? JSON.stringify(before) : 'n/a'}）`);
        } else {
          console.log(`[dev-reset-canvas] dry-run 队列 ${name}：job 计数=${before ? JSON.stringify(before) : 'n/a'}（计划 obliterate）`);
        }
      } finally {
        await q.close().catch(() => {});
      }
    }
    // ── Redis 键（安全门④：固定模式清单 SCAN——禁 FLUSHDB） ──
    for (const pat of REDIS_PATTERNS) {
      let cursor = '0'; let deleted = 0; const found = [];
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pat, 'COUNT', 100);
        cursor = next;
        found.push(...keys);
      } while (cursor !== '0');
      if (APPLY && found.length > 0) deleted = await redis.del(...found);
      console.log(`[dev-reset-canvas] Redis ${pat}：${APPLY ? `${deleted} 键删除` : `${found.length} 键（计划清）`}`);
    }
  } finally {
    await Promise.allSettled([...conns.map((c) => c.quit()), redis.quit()]);   // 全连接收口（进程可退出）
  }
}

// ── MinIO：三前缀清（不可达容忍——警告跳过） ──
/** 前缀清除核（可注入 s3 客户端——元测试伪客户端直跑真循环：分页枚举+千件批删）。
 *  T18 评审 P1#2：本核此前引用未定义 PREFIXES（ReferenceError 被 catch 吞成「MinIO 不可达」
 *  ——apply 模式对象永不清理且静默伪装）；抽出可注入核+运行时断言测试防该类死码回潮。 */
async function purgeS3Prefixes(s3, bucket, prefixes, apply, { ListObjectsV2Command, DeleteObjectsCommand }) {
  const out = [];
  for (const prefix of prefixes) {
    let token; let total = 0; const objects = [];
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) { objects.push({ Key: o.Key }); total++; }
      token = page.NextContinuationToken;
    } while (token);
    if (apply) {
      for (let i = 0; i < objects.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.slice(i, i + 1000) } }));
      }
    }
    out.push({ prefix, total, deleted: apply ? objects.length : 0 });
  }
  return out;
}

async function resetMinio(env, APPLY) {
  try {
    const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = requireApi('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'us-east-1',
      endpoint: env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000',
      credentials: { accessKeyId: env.MINIO_ACCESS_KEY ?? 'minioadmin', secretAccessKey: env.MINIO_SECRET_KEY ?? 'minioadmin' },
      forcePathStyle: true,
      tls: env.MINIO_USE_SSL === 'true',
      requestHandler: { connectionTimeout: 2_000, requestTimeout: 5_000 },   // 不可达快失败（默认无超时=挂起——实测 127.0.0.1:9000 常未启动）
    });
    const bucket = env.MINIO_BUCKET ?? 'flowai';
    for (const r of await purgeS3Prefixes(s3, bucket, MINIO_PREFIXES, APPLY, { ListObjectsV2Command, DeleteObjectsCommand })) {
      console.log(`[dev-reset-canvas] MinIO ${r.prefix}：${APPLY ? `${r.deleted} 对象删除` : `${r.total} 对象（计划清）`}`);
    }
  } catch (e) {
    console.warn(`[dev-reset-canvas] MinIO 不可达/失败（${e.message}）——对象清理跳过（警告不失败；127.0.0.1:9000 本机常未启动）`);
  }
}

// ── spool 目录（安全门④：只清该目录内容——COLLAB_SPOOL_DIR 显式值或 api cwd 缺省形态） ──
function resetSpool(env, APPLY) {
  const dir = env.COLLAB_SPOOL_DIR
    ?? path.join(ROOT, 'apps/api', '.data', 'collab-spool');   // collab-spool.service 缺省 join(cwd,'.data','collab-spool')——api 进程 cwd=apps/api
  if (!existsSync(dir)) { console.log(`[dev-reset-canvas] spool 目录不存在（${dir}）——跳过`); return; }
  const entries = readdirSync(dir);
  if (!APPLY) { console.log(`[dev-reset-canvas] dry-run spool ${dir}：${entries.length} 项（计划清）`); return; }
  for (const name of entries) rmSync(path.join(dir, name), { recursive: true, force: true });
  console.log(`[dev-reset-canvas] spool ${dir}：${entries.length} 项删除`);
}

// ── IDB（浏览器端——打印清理指引） ──
function printIdbGuide() {
  console.log('[dev-reset-canvas] IDB（浏览器端，脚本无法清）：DevTools → Application → IndexedDB → 删除全部 flowweb:collab:* 前缀库（四维缓存键 uid:pid:g<gen>:s<schema>——本地 doc 快照）');
}

// ── 元测试导出面（dev-reset-canvas.test.mjs 消费——静态锚+purgeS3Prefixes 运行时断言载体） ──
export const RESET_TABLES = TABLES;
/** T19（P2#7 测试缝）：dry-run ledger 通行证段（BEGIN+SET LOCAL+ROLLBACK 三连——apply 轮
 *  TeamCreditTransaction 删除前提的提前验证）。导出供元测试断言序列与失败档语义。 */
export { resetPg };
export const REDIS_PATTERNS = [
  'videoWork:process:*',        // doc 快照缓存（版本键随 v3 bump——旧空间失效清理）
  'videoWork:categories',       // 分类缓存
  'user:video-separate:*',      // 分离并发计数
  'lock:video-separate:*',      // 分离幂等锁
];
export const MINIO_PREFIXES = ['temp/', 'uploads/', 'results/'];   // buildKey 词表单源对齐（'artifacts'=results/）
export { purgeS3Prefixes };   // T18 评审 P1#2：可注入核（伪 s3 客户端直跑真循环——防 PREFIXES 类死码回潮）
export function isLocalDbHost(url) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); }
  catch { return false; }   // 非法 URL=不可判定=拒（fail-closed）
}

async function main() {
  const { env, APPLY, databaseUrl } = runGates();   // 安全门①②③首段（拒执行=exit 1 先于任何连接）
  await resetPg(databaseUrl, APPLY);
  await resetQueues(env, APPLY);
  await resetMinio(env, APPLY);
  resetSpool(env, APPLY);
  printIdbGuide();
  console.log(APPLY
    ? '[dev-reset-canvas] 完成——锚（两轮零回灌）：再跑一轮应全零（api/worker 停写前提）'
    : '[dev-reset-canvas] dry-run 完成——加 --apply 执行');
}

// 直跑守卫（测试 import 导出面零副作用——collab-renumber-layer 同形态）
const isMain = process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1]).split(path.sep).join('/')).href;
if (isMain) {
  main().catch((e) => { console.error(`[dev-reset-canvas] FAIL: ${e.message}`); process.exit(1); });
}
