// scripts/load-bench.test.mjs —— Y1c T33 负载基准门禁判据自测（node --test scripts/ 池消费）。
// 红组先例=drill-fault.test.mjs T31 红①-红⑥：①纯函数阈值断言（超限样本红=verdict fail/达标样本绿=pass
// ——判据在装置落档前先以样本钉死，防「先跑后调阈值」）②装置在档可 import+场景清单固定+--confirm
// 破坏性守卫+错误率口径源文本锚（v1.7 定义——预期 close 码单列不计入）。
// 阈值单一真源=scripts/lib/load-bench-verdict.mjs（装置+gate 脚本同 import——发布前无 TBD 阈值）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERDICT = path.join(ROOT, 'scripts', 'lib', 'load-bench-verdict.mjs');
const BENCH = path.join(ROOT, 'scripts', 'bench-load.mjs');

// ── 判据样本工厂（达标基线——各项全在硬门内的绿色样本；各用例按需覆写单轴） ──
const GREEN = () => ({
  meta: { profile: 'test', machine: 'test-rig', startedAt: 0, axesComplete: true },
  errors: { http5xx: 0, httpOps: 1000, unhandledExceptions: 0, unexpectedClose1011: 0, dataAssertionFailures: 0, timeouts: 0, timedOps: 1000, expectedCloseCodes: { 4411: 0, 4412: 0, 4404: 0, 4406: 0, 4413: 0 } },
  invariants: { convergence: { pass: true }, crossProjectIsolation: { pass: true }, integrityProbe: { pass: true }, noSilentDrop: { pass: true } },
  axes: {
    coldLoad: { p50: 500, p95: 1200, p99: 1800, unit: 'ms' },
    walFsync: { p50: 8, p95: 12, p99: 16, unit: 'ms' },
    saveBarrier: { p50: 300, p95: 800, p99: 1500, unit: 'ms' },
    feedLag: { p50: 100, p95: 800, p99: 2000, max: 3000, unit: 'ms' },
    recoveryRto: { ms: 45_000 },
    applyReplay: { p50: 5, p95: 20, p99: 40, unit: 'ms' },
    echo: { bytes: 10_000_000, inboundBytes: 10_000_000, fanoutCeiling: 10 },
    resources: { rssMaxBytes: 1_000_000_000, rssBudgetBytes: 1_600_000_000, cpuMaxPercent: 60, ioWriteBytes: 500_000_000 },
  },
});

test('T33 红①：判据模块在档可 import+硬门阈值常量冻结（plan :434 逐字——fsync 20ms/barrier 2s/冷加载 3s/RTO 5min/feed lag 30s）', async () => {
  const mod = await import(pathToFileURL(VERDICT).href);
  assert.equal(mod.HARD_THRESHOLDS.walFsyncP95Ms, 20, 'WAL fsync p95>20ms（10×10）');
  assert.equal(mod.HARD_THRESHOLDS.saveBarrierP95Ms, 2_000, 'save barrier p95>2s');
  assert.equal(mod.HARD_THRESHOLDS.coldLoadP95Ms, 3_000, '10k 冷加载 p95>3s');
  assert.equal(mod.HARD_THRESHOLDS.recoveryRtoMs, 300_000, '恢复 RTO>5min');
  assert.equal(mod.HARD_THRESHOLDS.feedLagMs, 30_000, 'feed lag>30s');
  assert.ok(Array.isArray(mod.SOFT_BUDGETS), '软预算清单在档（发布前无 TBD——每项带依据注记）');
});

test('T33 红②：达标样本=pass（六硬门全绿+零错误）', async () => {
  const { decideLoadBenchVerdict } = await import(pathToFileURL(VERDICT).href);
  const v = decideLoadBenchVerdict(GREEN());
  assert.equal(v.verdict, 'pass');
  assert.equal(v.hardBlocks.length, 0);
});

test('T33 红③：硬门逐项超限=fail（六项各自独立红——每项单独覆写，判据有判别性）', async () => {
  const { decideLoadBenchVerdict } = await import(pathToFileURL(VERDICT).href);
  const cases = [
    ['不变量失败', (s) => { s.invariants.convergence = { pass: false, detail: '双端不收敛' }; }, 'invariant'],
    ['未处理异常>0', (s) => { s.errors.unhandledExceptions = 1; }, 'unhandled'],
    ['非预期 1011', (s) => { s.errors.unexpectedClose1011 = 1; }, '1011'],
    ['数据断言失败', (s) => { s.errors.dataAssertionFailures = 1; }, 'assertion'],
    ['WAL fsync p95>20ms', (s) => { s.axes.walFsync.p95 = 25; }, 'walFsync'],
    ['save barrier p95>2s', (s) => { s.axes.saveBarrier.p95 = 2_400; }, 'saveBarrier'],
    ['10k 冷加载 p95>3s', (s) => { s.axes.coldLoad.p95 = 3_500; }, 'coldLoad'],
    ['恢复 RTO>5min', (s) => { s.axes.recoveryRto.ms = 320_000; }, 'recoveryRto'],
    ['feed lag>30s', (s) => { s.axes.feedLag.p95 = 35_000; }, 'feedLag'],
  ];
  for (const [label, mutate, expectGate] of cases) {
    const s = GREEN(); mutate(s);
    const v = decideLoadBenchVerdict(s);
    assert.equal(v.verdict, 'fail', `${label} 必须 fail`);
    assert.ok(v.hardBlocks.some((b) => b.gate.includes(expectGate)), `${label} 命中 ${expectGate} 门（实际 blocks=${JSON.stringify(v.hardBlocks.map((b) => b.gate))}）`);
  }
});

test('T33 红④：v1.7 错误率口径——预期 close 码 4411/4412/4404/4406/4413 单列不计入（有预期码不红）+5xx<0.1% 负载容忍档', async () => {
  const { decideLoadBenchVerdict } = await import(pathToFileURL(VERDICT).href);
  // 预期码单列：拒帧演练产生的 4411/4412 等=协议预期行为，任一数量不进错误率
  const s = GREEN();
  s.errors.expectedCloseCodes = { 4411: 37, 4412: 5, 4404: 2, 4406: 1, 4413: 8 };
  let v = decideLoadBenchVerdict(s);
  assert.equal(v.verdict, 'pass', '预期码单列不计入错误率（卡文二段口径原文）');
  // 负载 5xx<0.1% 容忍档：千分之一以下不红（雪崩档另行判）
  const s2 = GREEN();
  s2.errors.http5xx = 9; s2.errors.httpOps = 10_000;   // 0.09%
  v = decideLoadBenchVerdict(s2);
  assert.equal(v.verdict, 'pass', '5xx 0.09%<0.1% 不 block（负载档容忍）');
  // 超 0.1%=fail
  const s3 = GREEN();
  s3.errors.http5xx = 11; s3.errors.httpOps = 10_000;   // 0.11%
  v = decideLoadBenchVerdict(s3);
  assert.equal(v.verdict, 'fail');
  assert.ok(v.hardBlocks.some((b) => b.gate.includes('errorRate')), '5xx≥0.1% 命中错误率门');
  // 超时雪崩=block（「无超时雪崩」伴随条件——操作超时占比>1% 即雪崩档）
  const s4 = GREEN();
  s4.errors.timeouts = 50; s4.errors.timedOps = 1_000;   // 5%
  v = decideLoadBenchVerdict(s4);
  assert.equal(v.verdict, 'fail');
  assert.ok(v.hardBlocks.some((b) => b.gate.includes('timeoutCascade')), '超时占比 5% 命中雪崩门');
});

test('T33 红⑤：软 warn 分档——1.0-1.2× 预算带/feed lag 5-30s/apply_replay/echo_bytes 超软预算=warn 不 block', async () => {
  const { decideLoadBenchVerdict } = await import(pathToFileURL(VERDICT).href);
  // feed lag 5-30s 软档：p95=8s 不 block 但必须 warn
  const s = GREEN();
  s.axes.feedLag.p95 = 8_000;
  let v = decideLoadBenchVerdict(s);
  assert.equal(v.verdict, 'pass', 'feed lag 8s<30s 硬门不 block');
  assert.ok(v.softWarns.some((w) => w.axis === 'feedLag'), 'feed lag 5-30s=软 warn 在档');
  // RSS 预算带：1.0-1.2×预算（1.6GiB 预算，1.7GiB=带内）
  const s2 = GREEN();
  s2.axes.resources.rssMaxBytes = 1_700_000_000;
  v = decideLoadBenchVerdict(s2);
  assert.equal(v.verdict, 'pass');
  assert.ok(v.softWarns.some((w) => w.axis === 'rss'), 'RSS 预算带内=warn');
  // 超 1.2× 预算=warn 升级（仍不 block——软档超限=触发 fork/patch 评审非只测不补）
  const s3 = GREEN();
  s3.axes.resources.rssMaxBytes = 2_500_000_000;
  v = decideLoadBenchVerdict(s3);
  assert.equal(v.verdict, 'pass', 'RSS 超软预算不 block（评审触发档）');
  assert.ok(v.softWarns.some((w) => w.axis === 'rss' && w.level === 'over'), '超预算=over 级 warn');
  // apply_replay 软预算超限=warn
  const s4 = GREEN();
  s4.axes.applyReplay.p95 = 500;
  v = decideLoadBenchVerdict(s4);
  assert.ok(v.softWarns.some((w) => w.axis === 'applyReplay'), 'apply_replay_ms 超软预算=warn');
  // echo_bytes 超结构性上界（inbound×fanout 上界）=warn
  const s5 = GREEN();
  s5.axes.echo.bytes = s5.axes.echo.inboundBytes * 20;   // 远超 10 连接扇出上界
  v = decideLoadBenchVerdict(s5);
  assert.ok(v.softWarns.some((w) => w.axis === 'echoBytes'), 'echo_bytes 超扇出上界=warn');
  // p99 尾部劣化（p99>2×对应硬门阈值）=warn
  const s6 = GREEN();
  s6.axes.walFsync.p99 = 45;   // >2×20ms
  v = decideLoadBenchVerdict(s6);
  assert.ok(v.softWarns.some((w) => w.axis === 'walFsyncP99'), 'p99 尾部劣化=warn');
});

test('T33 红⑥：装置在档可 import+BENCH_SCENARIOS 清单固定（卡文场景族——乱序/缺场景=红）', async () => {
  const mod = await import(pathToFileURL(BENCH).href);
  assert.ok(Array.isArray(mod.BENCH_SCENARIOS) && mod.BENCH_SCENARIOS.length === 7);
  assert.deepEqual(mod.BENCH_SCENARIOS, [
    'cold-load',        // 10k 节点冷加载（服务端装载/客户端 synced/read model 首屏分轴）
    'mixed-payload',    // 8MiB 混合（传输/解码/fsync/apply/PG 批/投影+apply_replay_ms+echo_bytes）
    'concurrency',      // 10 项目×10 连接真实并发（WAL fsync 放大/批延迟/feed 负载/可见节点隔离）
    'ss2-fanout',       // 8MiB SS2×10 连接出站扇出/事件循环阻塞（OUTBOUND_BUDGET 96MiB 同口径）
    'backlog-isolation',// spoolHeadSeq-pgSeq 积压规模/持续时间+慢项目隔离（背压验证）
    'sustained-disk',   // 长时间持续写入+磁盘接近上限（容量闸 fail-closed+恢复落定）
    'recovery-rto',     // kill→重启→ready+回灌归零（恢复 RTO 硬门实测）
  ]);
  assert.ok(mod.BENCH_PROFILES && mod.BENCH_PROFILES.full && mod.BENCH_PROFILES.smoke, '两档 profile（PR smoke/nightly-release full）');
});

test('T33 红⑦：装置破坏性守卫（--confirm 缺失=exit 非 0+refusal 文案——kill api/PG 触发器档=drill 同律）', () => {
  const r = spawnSync(process.execPath, [BENCH, '--profile', 'smoke'], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0, '--confirm 缺失必须 exit 非 0');
  assert.match((r.stdout ?? '') + (r.stderr ?? ''), /--confirm/);
});

test('T33 红⑧：装置源文本锚（错误率 v1.7 口径+分段落盘+超时上界+PG 锁等待观测——卡文纪律逐项）', async () => {
  const src = readFileSync(BENCH, 'utf-8');
  assert.match(src, /4411.*4412.*4404.*4406.*4413|EXPECTED_CLOSE_CODES/, '预期 close 码五码单列（不计入错误率）');
  assert.match(src, /1011/, '非预期 1011 计入错误率');
  assert.match(src, /writeFileSync|appendFileSync/, '分段落盘（防中断全丢）');
  assert.match(src, /timeoutMs|TIMEOUT|deadline/, '超时上界');
  assert.match(src, /wait_event|pg_lock|Lock/, 'PG 锁等待观测');
  assert.match(src, /mintWorkerScopeToken|exec-status/, 'feed 事件真链注入（exec-status 端点——feed lag 观测源）');
  assert.match(src, /COLLAB_SPOOL_CAPACITY_BYTES/, '磁盘接近上限=容量闸档（T31 D 档先例）');
  assert.match(src, /event_loop_lag/, '事件循环阻塞观测（charter http-seed 触发条件 loopBlock>50ms 同源）');
  assert.match(src, /OUTBOUND_BUDGET|96MiB|100_663_296/, '出站扇出与 OUTBOUND_BUDGET 同口径');
});
