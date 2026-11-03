#!/usr/bin/env node
// scripts/reset-collab.mjs
// Y1c T30（spec §4.4 恢复+plan Task 30）：collab 库破坏性 reset 工具——runbook §3.3「服务器 rebuild」
// 人工流程（rebuild-db.mjs DROP+人工 tsx seed+gate-seed）收编为单命令可重复执行机器流程。
//
// ⚠ 破坏性：DROP SCHEMA public CASCADE——库内数据确认丢弃；回退锚=cutover ②已落的 pre-migrate
//   pg_dump（deploy.sh --rebuild-db 分支 fail-fast 断言它在位；恢复语义权威=full-stack-backup.md §3）。
//
// 七阶段序（每阶段完成即落盘状态文件；重跑跳过已完成阶段——kill -9 后重跑感知已完成阶段，不依赖
// 人工判断；状态文件=仓根 .reset-collab-state.json〔gitignored——DB 正被 drop，状态不能存 PG〕）：
//   1 precheck          DSN 可得+owner 核查（rebuild-db.mjs 先例两合法形态）+消费者在线断言
//                      （pg_stat_activity 同库活连接〔除自身 pid〕>0=红，打印连接明细——「停全部旧
//                       DB 消费者之前 reset 必红」的机器化）+租约判定（CollabLease scope=primary
//                       held=红，decideResetGuard 同构 decideLeaseVerdict 形态）+inflight/stranded
//                      判据（decideResetGuard 纯函数——pending 可观测时阻断；消费者已停常态=不可
//                       观测放行，观测责任=维护关写/drain 步〔runbook §16〕，三查全量接线归 T30b）
//   2 drop-recreate     DROP 前计数留档（GenerationIntent/CanvasDocUpdate 仅日志）+DROP SCHEMA
//                      public CASCADE; CREATE SCHEMA public
//   3 migrate           prisma migrate deploy（apps/api cwd 子进程）+advisory lock 串行守卫
//                      （pg_try_advisory_lock(hashtext('flowweb:reset-collab:migrate')) 围 migrate
//                      全程——禁并行同 schema 状态：并行 reset/migrate 第二者显式红，不静默排队）
//   4 seed              pnpm --filter @flowweb/api exec tsx prisma/seed.ts + gate-seed.ts
//                      （runbook :171 服务器 rebuild 人工序收编；幂等 upsert 可重跑）
//   5 quarantine-spool  旧 spool/WAL 整目录挪 .quarantine-<timestamp>/ 兄弟目录（保证据不删；
//                      目录不存在=已完成语义幂等）——T13/T29 恢复契约的 post-restore 步骤半边：
//                      bump 后旧 WAL 段 historyId 不匹配，boot 扫描不收养（栅栏双保险）
//   6 bump-history      UPDATE "SystemHistory" SET historyId=gen_random_uuid(), epochStartedAt=now()
//                      WHERE id=1（迁移引导行由 T7 迁移内 INSERT id=1 建立；显式 bump=新纪元单一
//                      语义——canvas-doc-head.ts requireSystemHistory 注释「修复=restore 工具收尾
//                      bump」在本工具落地。bump=时间戳栅栏清除：旧段 lastWriteAt>epochStartedAt 的
//                      整段 quarantine 判据对新一代恒假）
//   7 verify            SystemHistory id=1 行在且 historyId 非零非空+epochStartedAt 非零+核心
//                      collab 表在位（CanvasDoc/CanvasDocUpdate/CanvasDocSnapshot/SystemHistory）
//                      +spool 目录净（不存在或空）
//
// 「清本地缓存键」口径（spec 偏离 38⑳）：客户端 IDB 缓存键五元 (uid,pid,generation,schemaVersion,
//   historyId)——服务端无清客户端缓存能力，唯一服务端动作=bump historyId 使五元自燃失效（4410/版本
//   门客户端自清）；本工具不伪装有该动作面。「清公开快照缓存」=snapshot-doc-cache 进程内 TTL+LRU
//   （单实例假设）——消费者进程停+新进程起=天然清空，工具无动作面（语义在 runbook §16 登记）。
//
// 全链成功后删除状态文件（下一次运行=全新全链 reset——「reset 可重复执行」语义）；--status 只读
// 打印在档阶段与剩余阶段。--hold-after <stage>=该阶段落盘后挂起（kill -9 演练锚，T27 先例）。
//
// 用法：
//   node scripts/reset-collab.mjs --rebuild-db --confirm            破坏性全链（--confirm 缺失=拒，零副作用）
//   node scripts/reset-collab.mjs --rebuild-db --confirm --hold-after migrate   中断演练
//   node scripts/reset-collab.mjs --status                           只读查看阶段状态
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideResetGuard } from './lib/gate-decision.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = path.join(ROOT, '.reset-collab-state.json');
const API_DIR = path.join(ROOT, 'apps/api');
const requireApi = createRequire(path.join(API_DIR, 'package.json'));

// ── 阶段状态机（纯函数零 IO——node:test 消费面，deploy-guard.test.mjs T30 组）──
export const RESET_STAGES = ['precheck', 'drop-recreate', 'migrate', 'seed', 'quarantine-spool', 'bump-history', 'verify'];

export function freshState(mode) {
  return { v: 1, startedAt: new Date().toISOString(), mode, stages: {} };
}

/** 状态文件解析——fail-closed：损坏 JSON/版本不符/stages 非对象/阶段行非完成态一律 throw（不静默重来）。 */
export function parseResetState(raw) {
  let obj;
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('reset 状态文件损坏（非 JSON）——fail-closed：人工核查 .reset-collab-state.json，或确认放弃后续阶段后删除它再全新重跑');
  }
  if (obj == null || typeof obj !== 'object') throw new Error('reset 状态文件损坏（非对象）——fail-closed');
  if (obj.v !== 1) throw new Error(`reset 状态文件版本不符（v=${JSON.stringify(obj.v)}≠1）——fail-closed`);
  if (typeof obj.startedAt !== 'string' || !obj.startedAt) throw new Error('reset 状态文件缺 startedAt——fail-closed');
  if (typeof obj.mode !== 'string' || !obj.mode) throw new Error('reset 状态文件缺 mode——fail-closed');
  if (obj.stages == null || typeof obj.stages !== 'object' || Array.isArray(obj.stages)) throw new Error('reset 状态文件 stages 非对象——fail-closed');
  for (const [name, entry] of Object.entries(obj.stages)) {
    if (!RESET_STAGES.includes(name)) throw new Error(`reset 状态文件含未知阶段 ${name}——fail-closed（异版本产物）`);
    if (entry == null || typeof entry !== 'object' || entry.done !== true) throw new Error(`reset 状态文件阶段 ${name} 行非完成态（半写入）——fail-closed`);
  }
  return { v: 1, startedAt: obj.startedAt, mode: obj.mode, stages: obj.stages };
}

/** 下一个未完成阶段（全完成=null——无续跑面）。 */
export function nextStage(state) {
  return RESET_STAGES.find((s) => state.stages[s]?.done !== true) ?? null;
}

/** 已完成阶段跳过判定（状态文件在档=已完成证据，不依赖人工判断）。 */
export function shouldSkip(state, stage) {
  return state.stages[stage]?.done === true;
}

/** 标记阶段完成（纯函数——返回新状态，落盘归 CLI）。 */
export function markStageDone(state, stage, detail) {
  const entry = { done: true, at: new Date().toISOString() };
  if (detail != null) entry.detail = detail;
  return { ...state, stages: { ...state.stages, [stage]: entry } };
}

// ── env（apps/api/.env——只取 DATABASE_URL/COLLAB_SPOOL_DIR，不打印密码；collab-rebuild-gen 先例）──
function readApiEnv() {
  try {
    return readFileSync(path.join(API_DIR, '.env'), 'utf-8');
  } catch { return ''; }
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replace(/^"|"$/g, '');
  const m = readApiEnv().match(/^DATABASE_URL=(.*)$/m);
  if (m) return m[1].trim().replace(/^"|"$/g, '');
  throw new Error('DATABASE_URL 未配置（apps/api/.env 或环境变量）');
}

/** spool 目录解析——与 api 侧 collab-spool.service 同源：env 显式值（服务器=树外 flowweb-data，
 *  ecosystem 注入）优先，缺省=api cwd 下 .data/collab-spool（本地 dev 形态=apps/api/.data/collab-spool）。 */
function resolveSpoolDir() {
  const fromEnvFile = readApiEnv().match(/^COLLAB_SPOOL_DIR=(.*)$/m);
  const raw = process.env.COLLAB_SPOOL_DIR ?? (fromEnvFile ? fromEnvFile[1].trim().replace(/^"|"$/g, '') : undefined);
  return path.resolve(raw ?? path.join(API_DIR, '.data', 'collab-spool'));
}

function maskDsn(dsn) {
  return dsn.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@');
}

/** 子进程：win32 下 .cmd 解析需 shell——命令字符串形态（参数全静态字面量无注入面；args+shell 并用触发 DEP0190）。 */
function runCmd(cmd, args, opts) {
  return process.platform === 'win32'
    ? spawnSync([cmd, ...args].join(' '), { ...opts, shell: true })
    : spawnSync(cmd, args, { ...opts });
}

function writeState(state) {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

// ── 阶段实现（每阶段自管连接——阶段间无共享生命周期）──
async function openClient() {
  const { Client } = requireApi('pg');
  const client = new Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  return client;
}

async function stagePrecheck() {
  const client = await openClient();
  try {
    // owner 核查（rebuild-db.mjs 先例——P2-5 防误伤真义=确认 DSN 连的是自家库，非字面角色名）：
    // 合法两形态——①schema owner=连接用户；②PG14+ 默认 schema owner=pg_database_owner 且 database
    // owner=连接用户。非本地库/未知库在此红（DROP 前最后一道防误伤）。
    const own = await client.query(`SELECT
      pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='public')) AS schema_owner,
      pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) AS db_owner,
      current_user AS usr`);
    const { schema_owner, db_owner, usr } = own.rows[0];
    console.log(`owner 核查：schema_owner=${schema_owner} db_owner=${db_owner} usr=${usr}`);
    if (!(schema_owner === usr || (schema_owner === 'pg_database_owner' && db_owner === usr))) {
      throw new Error(`schema 非连接用户所有（schema_owner=${schema_owner} db_owner=${db_owner} usr=${usr}）——疑似连错库，人工核查（Z34/P2-5 先例）`);
    }
    // 消费者在线断言：同库活连接（除自身 pid）>0=红；打印连接明细（旧 DB 消费者=api/worker/执行链
    // poller——pg_stat_activity 非超级用户可见同角色连接，本仓全部消费者同 DSN 用户）。
    const act = await client.query(`SELECT pid, usename, application_name, client_addr::text AS client_addr,
      state, backend_type, to_char(query_start, 'YYYY-MM-DD HH24:MI:SS') AS query_start, left(query, 80) AS query
      FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() ORDER BY pid`);
    if (act.rows.length > 0) {
      console.error('同库活连接明细：');
      for (const r of act.rows) console.error(`  pid=${r.pid} user=${r.usename} app=${r.application_name ?? '(无)'} addr=${r.client_addr ?? '(本地)'} state=${r.state ?? '-'} type=${r.backend_type} qstart=${r.query_start ?? '-'} query=${r.query ?? '-'}`);
    }
    // 租约判定：schema 已被先前 run drop 时表不在=无租约行（同库连接为零已证，表缺=空窗同义）。
    let leaseRow = null;
    try {
      const r = await client.query(`SELECT owner, "expiresAt" FROM "CollabLease" WHERE scope = 'primary'`);
      if (r.rows[0] != null) leaseRow = { owner: r.rows[0].owner, expiresAtMs: r.rows[0].expiresAt == null ? null : new Date(r.rows[0].expiresAt).getTime() };
    } catch (e) {
      if (e.code !== '42P01') throw e;
      console.log('CollabLease 表不存在（schema 已空——先前 run 已 drop，租约判定=无行）');
    }
    const guard = decideResetGuard({ activeConnections: act.rows.length, leaseRow, nowMs: Date.now(), pending: null });
    if (guard.verdict === 'fail') throw new Error(`reset 守卫红（decideResetGuard）：${guard.why}`);
    console.log(`reset 守卫：${guard.why}`);
    return `connections=0 lease=${leaseRow == null ? 'no-row' : 'ok'}（owner 核查过）`;
  } finally { await client.end().catch(() => {}); }
}

async function stageDropRecreate() {
  const client = await openClient();
  try {
    // DROP 前计数留档（仅日志——应用在线断言无意义的窗口不复存在，计数=丢弃面审计锚）。
    const counts = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM "GenerationIntent") AS generation_intent,
      (SELECT COUNT(*)::int FROM "CanvasDocUpdate") AS canvas_doc_update`).catch(() => ({ rows: [{ generation_intent: 0, canvas_doc_update: 0 }] }));
    console.log(`DROP 前计数（丢弃面留档）：GenerationIntent=${counts.rows[0].generation_intent} CanvasDocUpdate=${counts.rows[0].canvas_doc_update}`);
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log('schema rebuilt（DROP SCHEMA public CASCADE + CREATE SCHEMA public）');
    return `丢弃面 GenerationIntent=${counts.rows[0].generation_intent} CanvasDocUpdate=${counts.rows[0].canvas_doc_update}`;
  } finally { await client.end().catch(() => {}); }
}

async function stageMigrate() {
  // advisory lock 串行守卫：固定文本键 hashtext——并行 reset/migrate（同 schema 状态竞态）第二者
  // 显式红禁排队（禁并行同 schema 状态）。锁围 migrate 子进程全程，finally 释放（连接断开亦自动释放）。
  const { Client } = requireApi('pg');
  const lockConn = new Client({ connectionString: loadDatabaseUrl() });
  await lockConn.connect();
  try {
    const locked = await lockConn.query(`SELECT pg_try_advisory_lock(hashtext('flowweb:reset-collab:migrate')::bigint) AS ok`);
    if (!locked.rows[0].ok) throw new Error('migrate advisory lock 未取得（并行 reset/migrate 在跑——禁并行同 schema 状态，人工等待先者完成后重跑本工具续跑）');
    console.log('migrate advisory lock 取得（flowweb:reset-collab:migrate——串行守卫生效）');
    const r = runCmd('npx', ['prisma', 'migrate', 'deploy'], { cwd: API_DIR, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`prisma migrate deploy 失败（exit ${r.status}——状态文件在档，修复后重跑自本阶段续）`);
    return 'prisma migrate deploy 完成（advisory lock 串行守卫下）';
  } finally {
    await lockConn.query('SELECT pg_advisory_unlock(hashtext(\'flowweb:reset-collab:migrate\')::bigint)').catch(() => {});
    await lockConn.end().catch(() => {});
  }
}

function stageSeed() {
  // runbook :171 服务器 rebuild 人工序收编：seed.ts（经 tsx 直跑，import ../src/*——src 上传面在
  // deploy.sh 已覆盖）+gate-seed.ts（Playwright 门禁 fixtures）。两步均须 exit 0。
  for (const script of ['prisma/seed.ts', 'prisma/gate-seed.ts']) {
    console.log(`seed：pnpm --filter @flowweb/api exec tsx ${script}`);
    const r = runCmd('pnpm', ['--filter', '@flowweb/api', 'exec', 'tsx', script], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${script} 失败（exit ${r.status}）`);
  }
  return 'seed.ts+gate-seed.ts 完成';
}

function stageQuarantineSpool() {
  const dir = resolveSpoolDir();
  if (!existsSync(dir)) {
    console.log(`spool 目录不存在（${dir}）——quarantine 幂等跳过（已完成语义）`);
    return `spool 目录不存在（${dir}）`;
  }
  const quarantine = path.join(path.dirname(dir), `.quarantine-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  renameSync(dir, quarantine);
  console.log(`spool 整目录 quarantine：${dir} → ${quarantine}（保证据不删；bump 后旧段 historyId 栅栏双保险——boot 不收养）`);
  return `quarantine=${quarantine}`;
}

async function stageBumpHistory() {
  const client = await openClient();
  try {
    const r = await client.query(`UPDATE "SystemHistory" SET "historyId" = gen_random_uuid()::text, "epochStartedAt" = now(), "updatedAt" = now() WHERE id = 1 RETURNING "historyId", "epochStartedAt"`);
    if (r.rows.length !== 1) throw new Error('SystemHistory id=1 行缺失（migrate 引导行未建立——T7 迁移 INSERT 缺席，人工核查迁移树）');
    const newId = r.rows[0].historyId;
    console.log(`SystemHistory bump：historyId=${newId} epochStartedAt=${r.rows[0].epochStartedAt.toISOString()}（新纪元单一语义——旧 spool/WAL 段全失效，客户端 IDB 五元自燃〔偏离 38⑳：清本地缓存唯此口径〕）`);
    return `historyId=${newId}`;
  } finally { await client.end().catch(() => {}); }
}

async function stageVerify() {
  const client = await openClient();
  try {
    const sh = await client.query(`SELECT "historyId", "epochStartedAt" FROM "SystemHistory" WHERE id = 1`);
    if (sh.rows.length !== 1) throw new Error('verify 红：SystemHistory id=1 行缺失');
    const { historyId, epochStartedAt } = sh.rows[0];
    if (!historyId || historyId === '0') throw new Error(`verify 红：historyId 零值/空（${JSON.stringify(historyId)}）`);
    const epochMs = epochStartedAt instanceof Date ? epochStartedAt.getTime() : 0;
    if (!Number.isFinite(epochMs) || epochMs <= 0) throw new Error('verify 红：epochStartedAt 零值（时间戳栅栏求值基准失真——canvas-doc-head fail-closed 同律）');
    const core = ['CanvasDoc', 'CanvasDocUpdate', 'CanvasDocSnapshot', 'SystemHistory'];
    const tbl = await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1)`, [core]);
    const found = tbl.rows.map((r) => r.relname);
    const missing = core.filter((t) => !found.includes(t));
    if (missing.length > 0) throw new Error(`verify 红：核心 collab 表缺失（${missing.join(',')}）`);
    const spoolDir = resolveSpoolDir();
    const spoolFiles = existsSync(spoolDir) ? readdirSync(spoolDir) : [];
    if (spoolFiles.length > 0) throw new Error(`verify 红：spool 目录非净（${spoolDir} 含 ${spoolFiles.length} 项：${spoolFiles.slice(0, 5).join(',')}）`);
    console.log(`verify 过：SystemHistory id=1 非零（epoch=${new Date(epochMs).toISOString()}）+核心表 4/4（${core.join('/')}）+spool 目录净（${existsSync(spoolDir) ? '空' : '不存在'}）`);
    return `historyId 非零+核心表 4/4+spool 净`;
  } finally { await client.end().catch(() => {}); }
}

const STAGE_RUNNERS = {
  precheck: stagePrecheck,
  'drop-recreate': stageDropRecreate,
  migrate: stageMigrate,
  seed: stageSeed,
  'quarantine-spool': stageQuarantineSpool,
  'bump-history': stageBumpHistory,
  verify: stageVerify,
};

function printStatus() {
  if (!existsSync(STATE_PATH)) {
    console.log('无在档 reset 状态（.reset-collab-state.json 不存在——上次全链已成功收尾或从未运行）');
    return;
  }
  const state = parseResetState(readFileSync(STATE_PATH, 'utf-8'));
  const done = RESET_STAGES.filter((s) => shouldSkip(state, s));
  const rest = RESET_STAGES.filter((s) => !shouldSkip(state, s));
  console.log(JSON.stringify(state, null, 2));
  console.log(`已完成：${done.length ? done.join(' → ') : '（无）'}；剩余：${rest.length ? rest.join(' → ') : '（无——全链完成，状态文件应由成功收尾删除）'}（startedAt=${state.startedAt} mode=${state.mode}）`);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const holdAfter = get('hold-after');
  const known = new Set(['--rebuild-db', '--confirm', '--status', `--hold-after`]);
  const bare = args.filter((a) => a.startsWith('--'));
  for (const flag of bare) {
    if (!known.has(flag)) { console.error(`未知旗标: ${flag}（禁静默忽略）\n用法：node scripts/reset-collab.mjs --rebuild-db --confirm [--hold-after <stage>] | --status`); process.exit(2); }
  }
  if (args.includes('--status')) { printStatus(); return; }
  if (!args.includes('--rebuild-db')) { console.error('用法：node scripts/reset-collab.mjs --rebuild-db --confirm [--hold-after <stage>] | --status'); process.exit(2); }
  // 破坏性守卫（最先——此后任何 IO 之前）：--confirm 缺失=拒，exit 非 0 零副作用。
  if (!args.includes('--confirm')) {
    console.error('REFUSED 缺 --confirm：本工具破坏性（DROP SCHEMA public CASCADE——库内数据确认丢弃）。确认后重跑：node scripts/reset-collab.mjs --rebuild-db --confirm');
    process.exit(1);
  }
  if (holdAfter != null && !RESET_STAGES.includes(holdAfter)) { console.error(`--hold-after 未知阶段 ${holdAfter}（合法=${RESET_STAGES.join('|')}）`); process.exit(2); }

  const dsn = loadDatabaseUrl();
  console.log(`reset-collab（破坏性——DROP/重建/迁移/种子/quarantine/bump/verify 全链）DB=${maskDsn(dsn)} spool=${resolveSpoolDir()}`);

  let state;
  if (existsSync(STATE_PATH)) {
    state = parseResetState(readFileSync(STATE_PATH, 'utf-8'));
    const done = RESET_STAGES.filter((s) => shouldSkip(state, s));
    console.log(`resume：状态文件在档（startedAt=${state.startedAt}）——已完成 ${done.join(' → ') || '（无）'}，自 ${nextStage(state)} 续跑（kill 后重跑感知已完成阶段）`);
  } else {
    state = freshState('rebuild-db');
    writeState(state);
  }

  for (const stage of RESET_STAGES) {
    if (shouldSkip(state, stage)) { console.log(`SKIP ${stage}（已完成——状态文件在档）`); continue; }
    console.log(`STAGE ${stage}`);
    const detail = await STAGE_RUNNERS[stage]();
    state = markStageDone(state, stage, typeof detail === 'string' ? detail : undefined);
    writeState(state);
    console.log(`STAGE ${stage} done${detail ? `（${detail}）` : ''}——落盘 .reset-collab-state.json`);
    if (holdAfter === stage) { console.log(`HOLDING ${stage}（演练锚——kill -9 本进程后重跑感知已完成阶段；T27 先例）`); await new Promise(() => {}); }
  }

  unlinkSync(STATE_PATH);
  console.log('OK reset-collab 全链完成（状态文件已删——下次运行=全新全链 reset；「reset 可重复执行」语义）。收尾提醒：公开快照缓存=进程内 TTL+LRU（新进程起=天然清空）；客户端 IDB 五元由本次 bump 自燃（偏离 38⑳）。');
}

// node:test 消费面（阶段状态机纯函数——scripts node --test 池）；CLI 主入口仅直接执行时跑
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
}
