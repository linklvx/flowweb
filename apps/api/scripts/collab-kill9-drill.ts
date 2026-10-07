// apps/api/scripts/collab-kill9-drill.ts —— Y0a-2 演练驱动（spec §4.1 G-1/G-2；collab-core 载体）。
// 模式：
//   --mode=kill9-normal ：停写→双模式 barrier（docs===0∧batches===0 持续 ≥3s）→kill -9→重启→重放 ⊇ 已接受集
//   --mode=kill9-fault  ：DB 触发器拒 INSERT→批入 spool→barrier（+spoolBytes 连续采样不变）→kill -9→drop 触发器→重启回灌→重放 ⊇
//   --mode=sigterm [--spool-fail]：SIGTERM→关停日志断言（drain_complete pending 全 0 或 undrained 与 storeInFlight 一致）
// 判定锚=已接受集=驱动侧 provider 文档的节点键集（写入方全量知情）。
// 载体（Step 1 探针实证登记）：tsx/esbuild 不发射 decorator metadata→AppModule DI 链不可起——
// 驱动先 `tsc -p tsconfig.drill.json`（gate-collab 先例：tsc 全量+node dist 子进程，重启零重编译）。
// 关停通道：Windows kill('SIGTERM')=TerminateProcess 硬杀（本机探针实证：exit signal=SIGTERM、
// handler 未执行）→win32 主通道=IPC process.send({type:'shutdown'})（drill-server 双通道 closing 闸
// 幂等）；POSIX 走 SIGTERM（enableShutdownHooks 语义）。
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';
import { ensureCollabSessionFixture, cleanupCollabSessionFixture } from '../src/test-utils/db-fixtures';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const PID = process.env.DRILL_PROJECT ?? `y0a2-drill-${Date.now()}`;
const DRILL_TOKEN = `drill-token-${Date.now()}`;   // fixture 的 Session token（ensureCollabSessionFixture 直插行=过 WS 鉴权）
const NODES = 25;                        // 已接受集大小
const COLLAPSE_MS = 3_200;               // ≥maxDebounce(300×1.5) 的持续判定窗
const TERM_VIA_SIGNAL = process.platform !== 'win32';   // 见文件头探针实证——win32=false→IPC 主通道
const DRILL_ENTRY = resolve(__dirname, '..', 'dist', 'scripts', 'collab-drill-server.js');

// Task 9 审查 Major-1：fail 改 throw——process.exit(1) 会绕过 main 的 finally（触发器/fixture/spoolDir
// 清理全跳过，实证残留 DB 2 项目+TEMP 2 目录）；throw 后经 main().catch 统一出口（finally 先行，exitCode 收口）。
function fail(msg: string): never { throw new Error(`DRILL FAIL: ${msg}`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Major-1 配套：spawn 后即登记，main().catch 兜底 SIGKILL——覆盖 ready 60s 超时 reject 与 barrier 中途
// fail 两类"child 尚活即抛出"路径（正常路径 stopServer 时摘除）。
const liveChildren = new Set<ChildProcess>();

let compiling: Promise<void> | null = null;
function ensureCompiled(): Promise<void> {
  compiling ??= new Promise<void>((res, rej) => {
    try {
      execSync('node node_modules/typescript/bin/tsc -p tsconfig.drill.json', { cwd: resolve(__dirname, '..'), stdio: 'inherit' });
      res();
    } catch (e) { rej(new Error(`drill 编译失败（tsc -p tsconfig.drill.json）: ${(e as Error).message}`)); }
  });
  return compiling;
}

async function metrics(port: number, token: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/metrics`, { headers: { 'x-prometheus-token': token } });   // 探针实证：无全局前缀（RoutesResolver {/metrics}）
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
  return res.text();
}
async function gauge(text: string, name: string): Promise<number> {
  const m = new RegExp(`^${name} ([0-9.]+)`, 'm').exec(text);
  if (!m) fail(`gauge ${name} 不在 metrics 输出中`);
  return Number(m[1]);
}

interface DrillHandle { child: ChildProcess; port: number; wsPort: number; token: string; ready: Promise<void>; drillStdout: () => string; drillStderr: () => string }
async function startServer(env: Record<string, string>): Promise<DrillHandle> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const wsPort = port + 1;
  const token = `drill-${port}`;
  const child = spawn(process.execPath, [DRILL_ENTRY], {
    env: {
      ...process.env, ...env,
      DRILL_HTTP_PORT: String(port), COLLAB_PORT: String(wsPort), PROMETHEUS_TOKEN: token, COLLAB_DEBOUNCE: '300',
      // X3/V21：skip 不可省（占位只过 zod——MinioModule 仍 ensureBucket 3 重试后 throw=listen 永不执行）
      MINIO_INIT: env.MINIO_INIT ?? 'skip',
      MINIO_ENDPOINT: 'http://127.0.0.1', MINIO_ACCESS_KEY: 'drill', MINIO_SECRET_KEY: 'drill-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],   // ipc=关停通道（controller 裁定 9——win32 主通道）
  });
  liveChildren.add(child);
  const stdout: string[] = []; const stderr: string[] = [];
  child.stdout!.on('data', (d) => stdout.push(String(d)));
  child.stderr!.on('data', (d) => stderr.push(String(d)));
  const ready = new Promise<void>((resolveReady, reject) => {
    const t = setTimeout(() => reject(new Error(`drill-server 未在 60s 内 listening\n${stdout.join('')}\n${stderr.join('')}`)), 60_000);
    const check = () => { if (stdout.join('').includes('drill_server_listening')) { clearTimeout(t); resolveReady(); } };
    child.stdout!.on('data', check); check();
  });
  return { child, port, wsPort, token, ready, drillStdout: () => stdout.join(''), drillStderr: () => stderr.join('') };
}

async function stopServer(h: DrillHandle): Promise<void> {
  h.child.kill('SIGKILL');   // Windows=TerminateProcess（演练外只求收口——不留孤儿进程/端口/DB 连接）
  liveChildren.delete(h.child);
  await new Promise<void>((r) => { h.child.once('exit', () => r()); setTimeout(r, 2_000).unref?.(); });
}

async function connectWrite(h: DrillHandle, projectId: string, nodes: number): Promise<{ provider: HocuspocusProvider; keys: string[] }> {
  const ydoc = new Y.Doc();
  // URL 形态照抄 test-utils/dual-client-server.ts:66（仓内实证——token query+name 分离传参）
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${h.wsPort}?token=${DRILL_TOKEN}`, name: `project:${projectId}`, document: ydoc });
  await new Promise<void>((r, rej) => {
    provider.on('synced', () => r());
    // reject 前先 destroy：sync 超时是可抛路径——provider WS 不关会挂住事件循环，exitCode=1 收不了口
    setTimeout(() => { provider.destroy(); rej(new Error('sync 超时')); }, 15_000);
  });
  const keys: string[] = [];
  for (let i = 0; i < nodes; i++) ydoc.getMap('nodes').set(`drill-${i}`, new Y.Map([['x', i]]));
  keys.push(...[...ydoc.getMap('nodes').keys()]);
  await sleep(200);                     // 上行送达窗
  return { provider, keys };
}

const prisma = DATABASE_URL
  ? new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
  : null;

async function replayKeys(): Promise<string[]> {   // DB 权威重放（绕过内存 doc）
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const { state, updates } = await repo.loadForHydration(PID);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
  return [...doc.getMap('nodes').keys()];
}

async function barrier(h: DrillHandle, opts: { withSpoolStable?: boolean; requireSpoolNonEmpty?: boolean } = {}): Promise<void> {
  // V23（Y12/N4 判据入代码）：docs/batches/inFlight 三归零 + 持续 ≥COLLAPSE_MS——批离开队列≠批已落定
  //（storeInFlight 在飞窗口正是 kill 最脆弱时刻）；故障模式加 spoolBytes 两采样不变。
  // requireSpoolNonEmpty 判定后置（首轮实现前置单采样=destroy 后 debounce 未到即读=假红——批还在队列，
  // spool 尚未接手）：quiescence 达成时批必须已落定，此时故障档 spool 必非空（PG 恒败批只能入 spool）。
  const t0 = Date.now();
  let stableSince: number | null = null; let lastSpoolBytes = -1;
  let lastSample = '';                        // Minor 3：超时 fail 消息带末次四 gauge 采样（诊断不再只给结论）
  while (Date.now() - t0 < 30_000) {
    const text = await metrics(h.port, h.token);
    const projects = await gauge(text, 'yjs_pending_projects'); const batches = await gauge(text, 'yjs_pending_batches');
    const inFlight = await gauge(text, 'yjs_store_in_flight_docs');
    const spoolBytes = await gauge(text, 'yjs_spool_depth_bytes');
    lastSample = `projects=${projects} batches=${batches} storeInFlight=${inFlight} spoolBytes=${spoolBytes}`;
    const quiescent = projects === 0 && batches === 0 && inFlight === 0 && (!opts.withSpoolStable || spoolBytes === lastSpoolBytes);
    if (quiescent) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= COLLAPSE_MS) {
        if (opts.requireSpoolNonEmpty && await gauge(text, 'yjs_spool_depth_files') === 0) {
          fail('故障模式判据失败：quiescence 达成但 spool 空=批直接落 PG（触发器未生效？）');
        }
        return;
      }
    }
    else stableSince = null;
    lastSpoolBytes = spoolBytes;
    await sleep(400);
  }
  fail(`quiescence barrier 30s 未达成（projects/batches/inFlight 未归零或 spool 不稳定）——末次采样 ${lastSample}`);
}

async function createTrigger(): Promise<void> {
  await prisma!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS y0a_drill_block ON "CanvasDocUpdate"`);   // Y22：幂等——CI 取消/硬崩残留触发器会让下次 CREATE 直接红
  await prisma!.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION y0a_drill_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'drill: insert blocked'; END $$ LANGUAGE plpgsql`);
  await prisma!.$executeRawUnsafe(`CREATE TRIGGER y0a_drill_block BEFORE INSERT ON "CanvasDocUpdate" FOR EACH ROW EXECUTE FUNCTION y0a_drill_block()`);
}
async function dropTrigger(): Promise<void> {
  await prisma!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS y0a_drill_block ON "CanvasDocUpdate"`).catch(() => {});
  await prisma!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS y0a_drill_block()`).catch(() => {});
}

async function kill9Mode(env: Record<string, string>, fault: boolean): Promise<void> {
  if (fault) await createTrigger();            // V7 修正：触发器先于 startServer（先建再写——"触发器前批次已落 PG"的不可判窗口消除）
  const h = await startServer(env); await h.ready;
  const { provider, keys } = await connectWrite(h, PID, NODES);
  await provider.destroy();                    // 停写（断连触发 flush——故障档 flush 失败批入 spool）
  await barrier(h, { withSpoolStable: fault, requireSpoolNonEmpty: fault });   // V23：三归零判据+故障前置断言
  const accepted = new Set(keys);
  const seqBefore = await prisma!.canvasDocUpdate.count({ where: { projectId: PID } });   // V23 反向下限（barrier 后=已接受集全落定，防"驱动侧没写进去"假绿）
  h.child.kill('SIGKILL');                     // kill -9（Windows=TerminateProcess——演练语义成立）
  await sleep(500);
  if (fault) await dropTrigger();              // 重启前恢复写入
  const h2 = await startServer(env); await h2.ready;
  // V7c 轮询替代 sleep：回灌完成信号=spool 段回收（depth_files===0；onModuleInit replayAll 先于 listen）或 30s deadline
  const t1 = Date.now();
  while (Date.now() - t1 < 30_000) {
    const text = await metrics(h2.port, h2.token);
    if (await gauge(text, 'yjs_spool_depth_files') === 0) break;
    await sleep(300);
  }
  const replayed = new Set(await replayKeys());
  const seqAfter = await prisma!.canvasDocUpdate.count({ where: { projectId: PID } });
  await stopServer(h2);
  if (seqAfter < seqBefore) fail(`kill9：行数反向下限失败（after=${seqAfter} < before=${seqBefore}——重启丢行）`);
  const missing = [...accepted].filter((k) => !replayed.has(k));
  if (missing.length > 0) fail(`kill9-${fault ? 'fault' : 'normal'}：已接受集丢失 ${missing.length}/${accepted.size}：${missing.slice(0, 5).join(',')}…`);
  console.log(`DRILL PASS: kill9-${fault ? 'fault' : 'normal'} —— ${accepted.size} 节点 ⊇ 已接受集（RPO 故障腿 ${fault ? 'spool 覆盖' : '≤maxDebounce 窗口外'}）`);
}

async function sigtermMode(env: Record<string, string>): Promise<void> {
  const spoolFail = process.argv.includes('--spool-fail');
  await createTrigger();                       // append 恒败→drain 走 force-spool 路径
  const h = await startServer(spoolFail ? { ...env, DRILL_SPOOL_FAIL: '1' } : env);   // Y14：服务态注入（monkey-patch append 恒抛——overCapacityFlag 会被滞回解除支自清）
  await h.ready;                               // X3：startServer env 已含 MINIO_INIT=skip
  const { provider } = await connectWrite(h, PID, NODES);
  await provider.destroy();
  await sleep(1_500);                          // store 失败已发生（批在队列）
  if (!spoolFail) await dropTrigger();         // Y14b：仅非故障档 drop——让 drain 的 append 成功走 drain_complete；--spool-fail 档保持 trigger（append 恒败+spool 恒败=undrained 判据确定可达）
  if (TERM_VIA_SIGNAL) h.child.kill('SIGTERM');
  else h.child.send?.({ type: 'shutdown' });   // win32 主通道（SIGTERM=硬杀不可达 graceful——文件头探针实证）
  const out = await new Promise<string>((r) => { h.child.once('exit', () => r(h.drillStdout() + h.drillStderr())); setTimeout(() => r(h.drillStdout() + h.drillStderr()), 30_000).unref?.(); });   // shutdown_undrained 走 logger.error=Nest 的 stderr（首轮仅搜 stdout=ii 档恒假红）
  const drainDone = /\{"event":"shutdown_drain_complete".*\}/.exec(out)?.[0];
  const undrained = /\{"event":"shutdown_undrained".*\}/.exec(out)?.[0];
  if (spoolFail) {
    if (!undrained) fail(`sigterm --spool-fail：期望 shutdown_undrained 点名（G-2a ii 档——不得声称 0）\n${out.slice(-2000)}`);
    const e = JSON.parse(undrained);
    if (!(e.projects >= 1 && e.batches >= 1 && e.storeInFlight === e.projects)) fail(`undrained 与 storeInFlight 不一致：${undrained}`);   // Y5：projects 键名（docs 键恒 undefined→两档均红且报错指向错误方向）
  } else {
    if (!drainDone) fail(`sigterm：期望 shutdown_drain_complete（G-2a i 档）\n${out.slice(-2000)}`);
    const e = JSON.parse(drainDone);
    if (!(e.pending.projects === 0 && e.pending.batches === 0)) fail(`drain_complete pending 非 0：${drainDone}`);
  }
  console.log(`DRILL PASS: sigterm${spoolFail ? ' --spool-fail' : ''}（G-2a ${spoolFail ? 'ii' : 'i'} 档）`);
}

async function main(): Promise<void> {
  if (!DATABASE_URL) fail('DATABASE_URL 未设置');
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) ?? '').slice(7);
  if (!['kill9-normal', 'kill9-fault', 'sigterm'].includes(mode)) fail('usage: --mode=kill9-normal|kill9-fault|sigterm [--spool-fail]');
  await ensureCompiled();                      // 载体：tsc 全量（emitDecoratorMetadata）+node dist 子进程——见文件头
  const spoolDir = await mkdtemp(join(tmpdir(), 'y0a2-drill-spool-'));
  const env = { DATABASE_URL, COLLAB_SPOOL_DIR: spoolDir, NODE_ENV: 'development' };
  await ensureCollabSessionFixture(prisma!, PID, DRILL_TOKEN);   // V7b：User+Team+Project+TeamMember（缺它 authenticate FORBIDDEN）+Session
  try {
    if (mode === 'sigterm') return await sigtermMode(env);
    return await kill9Mode(env, mode === 'kill9-fault');
  } finally {
    await dropTrigger();
    await cleanupCollabSessionFixture(prisma!, PID, DRILL_TOKEN).catch(() => {});
    await prisma!.$disconnect();
    await rm(spoolDir, { recursive: true, force: true });
  }
}

void main().catch((e) => {
  for (const c of liveChildren) c.kill('SIGKILL');   // Major-1 兜底：ready 60s 超时/barrier 中途 fail 时 child 尚活——孤儿化收口（正常路径 stopServer 已摘除）
  console.error(e);
  process.exitCode = 1;   // finally（触发器/fixture/spoolDir 清理）已在 main 体内先行执行完
});
