// apps/api/scripts/collab-kill9-drill.ts —— Y0a-2/3 演练驱动（spec §4.1 G-1/G-2+§5 Z25；collab-core 载体）。
// 模式：
//   --mode=kill9-normal ：停写→双模式 barrier（docs===0∧batches===0 持续 ≥3s）→kill -9→重启→重放 ⊇ 已接受集
//   --mode=kill9-fault  ：DB 触发器拒 INSERT→批入 spool→barrier（+spoolBytes 连续采样不变）→kill -9→drop 触发器→重启回灌→重放 ⊇
//   --mode=sigterm [--spool-fail]：drain 前置断言（G-2a ii）→SIGTERM→关停日志断言（drain_complete pending 全 0 或 undrained 与 storeInFlight 一致）
//   --mode=handover [--graceful|--usurp]（Z25/W16 三变体）：A 持租约写 N 键→B 起（同库同 spool 根+同 wsPort——
//     P17 固定端口，否则 B listen 永远成功、listener 让位断言落空）→接管触发→B 接管（租约+listener+回灌）→
//     键集 ⊇。基础/kill9：kill -9 A→B 于 TTL+ε（TTL=2000 确定性 ~2-3s）接管；--graceful：A SIGTERM（默认
//     TTL=10s——显式释放 vs TTL 接管对比清晰）→B 接管不吃 TTL（SV12/步骤 6 实证）；--usurp：break-glass
//     脚本清行为 'revoked'→A 落 collab_lease_revoked+listener 让位（WS_PORT TCP 拒连直证）→B 起（抢跑竞态
//     消除——B 不在跑则 A 的 HB ≤HB/2 必先见 revoked）→B CAS 经 expiresAt<now() 立即夺取→epoch=+2
//     （break-glass 按契约自耗 +1）→A 终态不抢回（B holder 稳定 3s）。
//   演练前 clearLeaseRow（W19/Z16/必办⑥改判）：不再注入 FORCE（env 已删）——startServer 前清租约行
//   （owner=NULL 使 CAS 立即命中；本地 dev 实例若持锁被让位，runbook=collab-lease-breakglass.ts）。
// W24/N15 登记（.claude/launch.json api-b 同步标注）：同机第二实例只能错端口跑，且只有先起的那个能
//   持有 collab——3000/3001 端口冲突先于租约暴露；租约价值=TTL 崩溃接管/跨主机/误配快速失败。
// 判定锚=已接受集=驱动侧 provider 文档的节点键集（写入方全量知情）。
// 载体（Step 1 探针实证登记）：tsx/esbuild 不发射 decorator metadata→AppModule DI 链不可起——
// 驱动先 `tsc -p tsconfig.drill.json`（gate-collab 先例：tsc 全量+node dist 子进程，重启零重编译）。
// 关停通道：Windows kill('SIGTERM')=TerminateProcess 硬杀（本机探针实证：exit signal=SIGTERM、
// handler 未执行）→win32 主通道=IPC process.send({type:'shutdown'})（drill-server 双通道 closing 闸
// 幂等——POSIX 支路经手动 SIGTERM handler 同闸）；POSIX 走真 SIGTERM（CI Linux=生产同构通道）。
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import * as net from 'node:net';
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

// W19/Z16：break-glass 等价自动化（owner=NULL 使下实例 CAS 立即命中）——kill9Mode/sigtermMode/
// handoverMode 的 startServer 前调用（handover 的 B 除外：B 必须看到 A 持行=lease-held 断言前提）。
async function clearLeaseRow(): Promise<void> {
  await prisma!.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary'`);
}

// Z25 usurp：仓内 break-glass 脚本（tsx 子进程跑——脚本无 DI 依赖；同 DATABASE_URL env）。
function execScript(script: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), resolve(__dirname, script)], {
      cwd: resolve(__dirname, '..'), env: process.env, stdio: 'inherit',
    });
    child.once('exit', (code) => (code === 0 ? res() : rej(new Error(`${script} exit ${code}`))));
    child.once('error', rej);
  });
}

// Z25：WS 端口探测——usurp 用（A listener 释放=TCP 拒连直证；B 接管后=可连直证 listen 成功）。
function tcpConnectOK(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((res) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (ok: boolean) => { sock.destroy(); res(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs).unref?.();
  });
}
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
async function startServer(env: Record<string, string>, fixedWsPort?: number): Promise<DrillHandle> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const wsPort = fixedWsPort ?? port + 1;   // handover（P17）：A/B 共享 wsPort——否则 B listen 永远成功，listener 让位断言落空
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
  await clearLeaseRow();                       // W19：清残留持行——h 快路径即获取（演练焦点=RPO 非接管时序）
  const h = await startServer(env); await h.ready;
  const { provider, keys } = await connectWrite(h, PID, NODES);
  await provider.destroy();                    // 停写（断连触发 flush——故障档 flush 失败批入 spool）
  await barrier(h, { withSpoolStable: fault, requireSpoolNonEmpty: fault });   // V23：三归零判据+故障前置断言
  const accepted = new Set(keys);
  const seqBefore = await prisma!.canvasDocUpdate.count({ where: { projectId: PID } });   // V23 反向下限（barrier 后=已接受集全落定，防"驱动侧没写进去"假绿）
  h.child.kill('SIGKILL');                     // kill -9（Windows=TerminateProcess——演练语义成立）
  await sleep(500);
  if (fault) await dropTrigger();              // 重启前恢复写入
  await clearLeaseRow();                       // W19：死 A 持行清掉——h2 快路径获取（接管时序由 handover 变体专测）
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
  await clearLeaseRow();                       // W19：清残留持行
  const h = await startServer(spoolFail ? { ...env, DRILL_SPOOL_FAIL: '1' } : env);   // Y14：服务态注入（monkey-patch append 恒抛——overCapacityFlag 会被滞回解除支自清）
  await h.ready;                               // X3：startServer env 已含 MINIO_INIT=skip
  const { provider } = await connectWrite(h, PID, NODES);
  await provider.destroy();
  await sleep(1_500);                          // store 失败已发生（批在队列）
  if (!spoolFail) await dropTrigger();         // Y14b：仅非故障档 drop——让 drain 的 append 成功走 drain_complete；--spool-fail 档保持 trigger（append 恒败+spool 恒败=undrained 判据确定可达）
  // Y0a-3（必办⑤/Z8）：G-2a ii"draining 可见"——B4 修正后唯一可达序=SIGTERM 前 POST /api/drain
  //（Nest dispose 先于模块 shutdown——SIGTERM 后 ready 不可达）。drain 进演练面（Y0a-4 部署链预演）。
  const drainRes = await fetch(`http://127.0.0.1:${h.port}/api/drain`, { method: 'POST', headers: { 'x-prometheus-token': h.token } });
  if (drainRes.status !== 200) fail(`POST /api/drain 非 200：${drainRes.status}`);
  const drained = await (await fetch(`http://127.0.0.1:${h.port}/api/ready`)).json();
  if (!(drained.ready === false && drained.reason === 'draining'))
    fail(`G-2a ii：ready 未转 draining（P6 优先级——两档统一值）：${JSON.stringify(drained)}`);
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

// Z25：handover 双进程演练——A 普通 CAS 起并持租约→写 N 键→接管触发→B 接管（租约+listener+回灌）→
// 键集 ⊇ 停写前（跨 owner 子目录回灌——R3 正名）。三变体见文件头。V17 配套：holder/epoch 取证经
// x-prometheus-token（全字段授权视图）；接管计时走 DB 行直读（100ms 轮询——ready 有 1s 缓存 Z10，
// 计时粒度不足）；ready 断言走 /api/ready（缓存对 ≤8s 预算无碍）。
async function handoverMode(env: Record<string, string>): Promise<void> {
  const graceful = process.argv.includes('--graceful');
  const usurp = process.argv.includes('--usurp');
  const variant = graceful ? 'graceful' : usurp ? 'usurp' : 'kill9';
  const WS_PORT = 31001;   // P17：A/B 共享
  const leaseRow = () => prisma!.$queryRaw<{ owner: string | null; epoch: bigint }[]>`
    SELECT owner, epoch FROM "CollabLease" WHERE scope = 'primary'`;
  const readyOf = async (h: DrillHandle) => (await (await fetch(`http://127.0.0.1:${h.port}/api/ready`, { headers: { 'x-prometheus-token': h.token } })).json()) as {
    ready: boolean; reason?: string; holder?: string; epoch?: string;
  };
  await clearLeaseRow();
  // TTL 分档：kill9/usurp=2000/500（确定性接管/revoke 观察 ≤500ms）；graceful=默认 10s——显式释放
  // （≤数秒）vs TTL 接管（≥8.5s）对比才清晰，SV12 断言不被小 TTL 稀释。不变式 HB×2≤TTL 两档均满足。
  const envA = graceful ? env : { ...env, COLLAB_LEASE_TTL_MS: '2000', COLLAB_LEASE_HEARTBEAT_MS: '500' };
  const A = await startServer(envA, WS_PORT); await A.ready;
  const { provider, keys } = await connectWrite(A, PID, NODES);
  const aReady = await readyOf(A);
  const aOwner = aReady.holder as string;
  const epochA = Number(aReady.epoch);
  if (!aOwner || !epochA) fail(`handover：A ready 无 holder/epoch（租约未持有？）：${JSON.stringify(aReady)}`);

  let B: DrillHandle;
  let epochDelta = 1;   // A(CAS +1)→B(CAS +1)；usurp：break-glass 按契约自耗 +1（脚本头注释）→B 后 = +2
  if (usurp) {
    // 顺序修正（对计划草案的机制适配——消除 CAS 抢跑竞态，报告登记）：break-glass 先于 B 起。
    // 若 B 先起（1s 重试循环在跑），break-glass 后 B 的 CAS 可能抢在 A 的下一次心跳（≤500ms）之前
    // 经 expiresAt<now() 支路夺走行——A 随后心跳见 owner=B→heartbeat-fenced 而非 revoked（~25% 概率
    // 翻转，revoked 日志断言变抽签）。B 不在跑则 A 的 HB 必先见 'revoked'（确定性）。
    epochDelta = 2;
    await execScript('collab-lease-breakglass.ts');
    const tR = Date.now();
    // logger.error=Nest 的 stderr（sigtermMode 同坑登记——仅搜 stdout=恒假红），双流搜
    const aLog = () => A.drillStdout() + A.drillStderr();
    while (!aLog().includes('collab_lease_revoked')) {
      if (Date.now() - tR > 2_000) fail(`usurp：A 2s 内未落 collab_lease_revoked（HB≤500ms 应已见 revoked）\n${aLog().slice(-1500)}`);
      await sleep(100);
    }
    const tL = Date.now();   // listener 让位直证：A 释放后 WS_PORT TCP 拒连（B 未起=端口上无他人）
    while (await tcpConnectOK(WS_PORT)) {
      if (Date.now() - tL > 3_000) fail('usurp：A listener 3s 内未释放（WS_PORT 仍可连——让位断言败）');
      await sleep(100);
    }
    // Z10：ready 服务 1s 单飞缓存——break-glass→revoke→listener 释放可在 aReady 后 <1s 内完成，
    // 立读会命中 revoked 前的缓存旧体（本地实证假红）。睡过缓存窗再断言。
    await sleep(1_200);
    const aLost = await readyOf(A);
    if (aLost.ready !== false || aLost.reason !== 'lease-lost')
      fail(`usurp：A 未转 lease-lost（revoked→P6 lease-lost）：${JSON.stringify(aLost)}`);
    B = await startServer(envA, WS_PORT); await B.ready;   // everHeld=false 无终态门——CAS 经 expiresAt<now() 立即命中
    const tB = Date.now();   // ②ready 200 ≤8s（快速路径夺取+listen+回灌；B 的 listen 成功本身=让位对偶证明）
    for (;;) {
      const body = await readyOf(B).catch(() => null);
      if (body?.ready === true) break;
      if (Date.now() - tB > 8_000) fail(`handover(usurp)：B 未在 8s 内 ready（最后：${JSON.stringify(body)}）`);
      await sleep(200);
    }
    if (!(await tcpConnectOK(WS_PORT))) fail('usurp：B ready 后 WS_PORT 拒连——listen 未发生？');
  } else {
    B = await startServer(envA, WS_PORT); await B.ready;   // B HTTP 起、collab 不 listen（lease-held 闸前置）
    const bReady1 = await readyOf(B);
    if (bReady1.ready !== false || bReady1.reason !== 'lease-held' || bReady1.holder !== aOwner)
      fail(`handover：B 未报 lease-held/holder 不符：${JSON.stringify(bReady1)}`);
    if (graceful) {
      if (TERM_VIA_SIGNAL) A.child.kill('SIGTERM'); else A.child.send?.({ type: 'shutdown' });
    } else {
      A.child.kill('SIGKILL');
    }
  }
  try { await provider.destroy(); } catch { /* A 已死/已隔离时 destroy 同步抛（socket 已闭）——清理 no-op */ }

  if (!usurp) {
    // V28 两段断言（kill9/graceful）：①获租约（DB 行直读——owner 离开 aOwner 即 B 已 CAS；100ms 直读
    // 绕开 ready 1s 缓存的计时稀释）②ready 200 ≤8s（listen+回灌完成）。
    // graceful 的 SV12 证明=逻辑蕴含：envA 用默认 TTL=10s——TTL 接管路径最早也要信号后 ~8.5s
    // （末次续租距关停 ≤HB）才能经过期支路；B 在 ≤4s 获租约 ⟺ CAS 走了 owner IS NULL 支路 ⟺ A 已显式
    // 释放（直接断言"观察到 NULL"反而与 B 抢跑存在 100ms 轮询竞态——删）。
    // kill9 预算=TTL 2s（A 末次续租距 kill ≤HB → 过期 ∈[1.5,2]s）+B 重试格 ≤1s+余量。
    const t0 = Date.now();
    const acquireBudget = graceful ? 4_000 : 3_500;
    let acquiredAt = 0; let readyAt = 0; let bEpoch = 0;
    while (Date.now() - t0 < 8_000) {
      const row = (await leaseRow())[0];
      if (!acquiredAt && row && row.owner && row.owner !== aOwner && row.owner !== 'revoked') {
        acquiredAt = Date.now() - t0; bEpoch = Number(row.epoch);
      }
      if (acquiredAt) {
        const body = await readyOf(B).catch(() => null);
        if (body?.ready === true) { readyAt = Date.now() - t0; break; }
      }
      await sleep(100);
    }
    if (readyAt === 0) fail(`handover(${variant})：B 未在 8s 内 ready`);
    if (acquiredAt === 0 || acquiredAt > acquireBudget)
      fail(`handover：B 获租约 ${acquiredAt}ms > ${acquireBudget}ms（${graceful ? '显式释放不达 SV12' : 'TTL 接管超预算'}）`);
    if (bEpoch !== epochA + epochDelta) fail(`handover：epoch 非单调（A=${epochA} B=${bEpoch} 期望 +${epochDelta}）——接管顺序契约破`);
  } else {
    const bTaken = await readyOf(B);
    if (Number(bTaken.epoch) !== epochA + epochDelta)
      fail(`usurp：epoch 非单调（A=${epochA} B=${bTaken.epoch} 期望 +${epochDelta}——break-glass 自耗 1+CAS 1）`);
  }
  if (usurp) {   // A 不抢回（I6）：A 终态 revoked 不 rejoin——B holder 稳定 3s
    await sleep(3_000);
    const bStable = await readyOf(B);
    if (!bStable.ready || bStable.holder === aOwner) fail(`usurp：B 持有不稳定/A 抢回：${JSON.stringify(bStable)}`);
  }
  // 键集断言（跨 owner 回灌）
  const replayed = new Set(await replayKeys());
  const missing = keys.filter((k) => !replayed.has(k));
  if (missing.length > 0) fail(`handover：已接受集丢失 ${missing.length}/${keys.length}`);
  await stopServer(B); await stopServer(A);
  console.log(`DRILL PASS: handover${graceful ? ' --graceful' : ''}${usurp ? ' --usurp' : ''}（Z25 三变体：${variant}——epoch +${epochDelta}，键集 ${keys.length} ⊇）`);
}

async function main(): Promise<void> {
  if (!DATABASE_URL) fail('DATABASE_URL 未设置');
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) ?? '').slice(7);
  if (!['kill9-normal', 'kill9-fault', 'sigterm', 'handover'].includes(mode)) fail('usage: --mode=kill9-normal|kill9-fault|sigterm|handover [--spool-fail|--graceful|--usurp]');
  await ensureCompiled();                      // 载体：tsc 全量（emitDecoratorMetadata）+node dist 子进程——见文件头
  const spoolDir = await mkdtemp(join(tmpdir(), 'y0a2-drill-spool-'));
  const env = { DATABASE_URL, COLLAB_SPOOL_DIR: spoolDir, NODE_ENV: 'development' };
  await ensureCollabSessionFixture(prisma!, PID, DRILL_TOKEN);   // V7b：User+Team+Project+TeamMember（缺它 authenticate FORBIDDEN）+Session
  try {
    if (mode === 'sigterm') return await sigtermMode(env);
    if (mode === 'handover') return await handoverMode(env);
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
