// scripts/lib/load-bench-verdict.mjs —— Y1c T33 负载基准门禁纯判据（零 IO 零 import 副作用）。
// 消费方=scripts/bench-load.mjs（装置跑完即判 exit）+scripts/load-bench.test.mjs（node --test 红组）。
// 阈值单一真源=本文件（spec v5.4 §9.4 分档语义——硬 block=发布阻断/软 warn=评审触发非只测不补）。
//
// 硬门六项（plan :434 逐字冻结）：
//   ①正确性/数据丢失不变量任一失败 ②错误率>0（v1.7 口径=仅 5xx/未处理异常/非预期 1011/数据断言
//   失败——预期 4411/4412/4404/4406/4413 单列不计入；负载 5xx<0.1% 无超时雪崩）③WAL fsync p95>20ms
//   ④save barrier p95>2s ⑤10k 冷加载 p95>3s ⑥恢复 RTO>5min+feed lag>30s（六项判据=plan 原文五门
//   编号展开——RTO/feed lag 各占一门）。
// 软 warn=吞吐/CPU/RSS/IO/p99 及 1.0-1.2× 预算带、feed lag 5-30s、apply_replay_ms/echo_bytes 软预算
//   （超限=触发 fork/patch 评审——非只测不补）。发布前无 TBD 阈值：每项预算带依据注记在 SOFT_BUDGETS。

/** 硬门阈值（ms/bytes——单一真源；改动=改本常量=有意识动作+测试同步）。 */
export const HARD_THRESHOLDS = {
  walFsyncP95Ms: 20,        // WAL fsync p95>20ms（10×10 并发场景口径——spec §9.4）
  saveBarrierP95Ms: 2_000,  // save barrier p95>2s（charter slo 项同值——T33 硬门同源）
  coldLoadP95Ms: 3_000,     // 10k 节点冷加载 p95>3s（charter http-seed 触发条件同源）
  recoveryRtoMs: 300_000,   // 恢复 RTO>5min（charter slo RTO≤30min 为生产目标——本硬门=基准阻断档 5min）
  feedLagMs: 30_000,        // feed lag>30s（软档 5-30s 见 SOFT_BUDGETS）
};

/** 错误率分档（v1.7 口径）。 */
export const ERROR_RATE_LIMITS = {
  http5xxRateMax: 0.001,     // 负载测试 5xx<0.1%（超过=block；观测分母 httpOps=0=fail-closed unobservable）
  timeoutCascadeRate: 0.01,  // 超时雪崩：操作超时占比>1%（「无超时雪崩」的机器化——零星超时进 warn）
};

/** 软预算清单（发布前无 TBD——每项带依据）。固定 runner 形态注记：本地实弹 4C/16G win32 为本卡
 *  基线形态（外推服务器档归 runbook §9.2 既有判据线——两线独立不混用）。 */
export const SOFT_BUDGETS = [
  { axis: 'rss', budgetBytes: 1_600_000_000, bandHigh: 1.2, why: 'api 进程 RSS 软预算 1.6GiB（本地 16G 形态：maxResidentDocBytes 装载面+基线外推；1.0-1.2× 带内=warn，超带=over 级 warn 触发评审）' },
  { axis: 'cpu', budgetPercent: 85, bandHigh: 1.2, why: 'CPU 峰值软预算 85%（4C 形态满载留系统余量；带内 85-100%=warn）' },
  { axis: 'io', budgetBytes: 2_000_000_000, bandHigh: 1.2, why: '全窗磁盘写软预算 2GiB（spool 256MB 容量+PG 批归零回收的净增长口径——超带=IO 放大评审）' },
  { axis: 'applyReplay', budgetP95Ms: 100, why: 'apply_replay_ms 软预算 p95≤100ms（S1 契约下库内重放=幂等 no-op 纯解码——装置口径=回声 RTT 代理，主体应远低于 fsync p95 的 5 倍）' },
  { axis: 'echoBytes', why: 'echo_bytes 软预算=入站字节×扇出连接数上界（广播每帧恰一次含发送者——结构性上界，超出=广播放大异常评审）' },
  { axis: 'feedLagSoft', budgetMs: 5_000, why: 'feed lag 5-30s=软 warn 档（spec §9.4；>30s 归硬门）' },
];

/** p99 尾部劣化 warn 判据：p99>2×对应硬门阈值（p95 达标但尾部翻倍=劣化信号——软档）。 */
const P99_AXES = [
  { axis: 'walFsyncP99', get: (a) => a.walFsync?.p99, threshold: HARD_THRESHOLDS.walFsyncP95Ms, label: 'WAL fsync p99' },
  { axis: 'coldLoadP99', get: (a) => a.coldLoad?.p99, threshold: HARD_THRESHOLDS.coldLoadP95Ms, label: '冷加载 p99' },
  { axis: 'saveBarrierP99', get: (a) => a.saveBarrier?.p99, threshold: HARD_THRESHOLDS.saveBarrierP95Ms, label: 'save barrier p99' },
];

const pct = (n, d) => (d > 0 ? n / d : null);

/**
 * 判定负载基准结果。
 * @param {object} bench 装置产出的 bench JSON（axes/errors/invariants/meta——schema 见 bench-load.mjs）
 * @returns {{verdict:'pass'|'fail', hardBlocks:Array<{gate,actual,threshold,why}>, softWarns:Array<{axis,level,actual,budget,why}>, unobservable:string[]}}
 */
export function decideLoadBenchVerdict(bench) {
  const hardBlocks = [];
  const softWarns = [];
  const unobservable = [];
  const push = (gate, actual, threshold, why) => hardBlocks.push({ gate, actual, threshold, why });

  // —— 硬门①：正确性/数据丢失不变量任一失败 ——
  const invariants = bench?.invariants ?? {};
  for (const [id, inv] of Object.entries(invariants)) {
    if (!inv?.pass) push(`invariant:${id}`, false, true, `正确性/数据丢失不变量失败：${inv?.detail ?? '无 detail'}`);
  }

  // —— 硬门②：错误率（v1.7 口径） ——
  const e = bench?.errors ?? {};
  if ((e.unhandledExceptions ?? 0) > 0) push('errorRate:unhandled', e.unhandledExceptions, 0, '未处理异常>0（api 日志 ring 观测）');
  if ((e.unexpectedClose1011 ?? 0) > 0) push('errorRate:close1011', e.unexpectedClose1011, 0, '非预期 1011 close>0（预期 4411/4412/4404/4406/4413 单列不计入——见 expectedCloseCodes）');
  if ((e.dataAssertionFailures ?? 0) > 0) push('errorRate:assertion', e.dataAssertionFailures, 0, '数据断言失败>0（装置收敛/隔离/完整性断言）');
  const httpRate = pct(e.http5xx ?? 0, e.httpOps ?? 0);
  if (httpRate === null) {
    unobservable.push('httpOps=0——5xx 错误率不可观测（装置 HTTP 观测面缺失=fail-closed 供人工核对）');
    push('errorRate:http5xx', 'unobservable', ERROR_RATE_LIMITS.http5xxRateMax, 'HTTP 观测分母为零——不可观测即不放行（decidePre unobservable 同律）');
  } else if (httpRate >= ERROR_RATE_LIMITS.http5xxRateMax) {
    push('errorRate:http5xx', httpRate, ERROR_RATE_LIMITS.http5xxRateMax, `5xx=${e.http5xx}/${e.httpOps}（负载档容忍 <0.1%）`);
  }
  const timeoutRate = pct(e.timeouts ?? 0, e.timedOps ?? 0);
  if (timeoutRate === null) {
    unobservable.push('timedOps=0——超时占比不可观测');
  } else if (timeoutRate > ERROR_RATE_LIMITS.timeoutCascadeRate) {
    push('errorRate:timeoutCascade', timeoutRate, ERROR_RATE_LIMITS.timeoutCascadeRate, `操作超时占比=${e.timeouts}/${e.timedOps}>1%（「无超时雪崩」伴随条件）`);
  } else if ((e.timeouts ?? 0) > 0) {
    softWarns.push({ axis: 'timeouts', level: 'band', actual: timeoutRate, budget: ERROR_RATE_LIMITS.timeoutCascadeRate, why: `零星超时 ${e.timeouts}/${e.timedOps}（<1% 不构成雪崩——逐笔登记供评审）` });
  }

  // —— 硬门③④⑤⑥：分位阈值 ——
  const axes = bench?.axes ?? {};
  const t = HARD_THRESHOLDS;
  if (axes.walFsync?.p95 != null && axes.walFsync.p95 > t.walFsyncP95Ms)
    push('walFsyncP95', axes.walFsync.p95, t.walFsyncP95Ms, 'WAL fsync p95>20ms（10×10 并发档）——升级序判据（S4）');
  if (axes.saveBarrier?.p95 != null && axes.saveBarrier.p95 > t.saveBarrierP95Ms)
    push('saveBarrierP95', axes.saveBarrier.p95, t.saveBarrierP95Ms, 'save barrier p95>2s');
  if (axes.coldLoad?.p95 != null && axes.coldLoad.p95 > t.coldLoadP95Ms)
    push('coldLoadP95', axes.coldLoad.p95, t.coldLoadP95Ms, '10k 冷加载 p95>3s（charter http-seed 触发条件同源）');
  if (axes.recoveryRto?.ms != null && axes.recoveryRto.ms > t.recoveryRtoMs)
    push('recoveryRto', axes.recoveryRto.ms, t.recoveryRtoMs, '恢复 RTO>5min（kill→ready+回灌归零）');
  if (axes.feedLag?.p95 != null && axes.feedLag.p95 > t.feedLagMs)
    push('feedLagP95', axes.feedLag.p95, t.feedLagMs, 'feed lag p95>30s');

  // —— 软 warn：RSS/CPU/IO 预算带（1.0-1.2×）+超带 over 级 ——
  const r = axes.resources ?? {};
  for (const b of SOFT_BUDGETS) {
    if (b.axis === 'rss' && r.rssMaxBytes != null) {
      if (r.rssMaxBytes > b.budgetBytes * b.bandHigh) softWarns.push({ axis: 'rss', level: 'over', actual: r.rssMaxBytes, budget: b.budgetBytes, why: `${b.why}——实测超 1.2× 带上界` });
      else if (r.rssMaxBytes > b.budgetBytes) softWarns.push({ axis: 'rss', level: 'band', actual: r.rssMaxBytes, budget: b.budgetBytes, why: `${b.why}——带内` });
    }
    if (b.axis === 'cpu' && r.cpuMaxPercent != null) {
      if (r.cpuMaxPercent > b.budgetPercent * b.bandHigh) softWarns.push({ axis: 'cpu', level: 'over', actual: r.cpuMaxPercent, budget: b.budgetPercent, why: `${b.why}——超带上界` });
      else if (r.cpuMaxPercent > b.budgetPercent) softWarns.push({ axis: 'cpu', level: 'band', actual: r.cpuMaxPercent, budget: b.budgetPercent, why: `${b.why}——带内` });
    }
    if (b.axis === 'io' && r.ioWriteBytes != null) {
      if (r.ioWriteBytes > b.budgetBytes * b.bandHigh) softWarns.push({ axis: 'io', level: 'over', actual: r.ioWriteBytes, budget: b.budgetBytes, why: `${b.why}——超带上界` });
      else if (r.ioWriteBytes > b.budgetBytes) softWarns.push({ axis: 'io', level: 'band', actual: r.ioWriteBytes, budget: b.budgetBytes, why: `${b.why}——带内` });
    }
  }
  // —— 软 warn：feed lag 5-30s ——
  if (axes.feedLag?.p95 != null && axes.feedLag.p95 > 5_000 && axes.feedLag.p95 <= HARD_THRESHOLDS.feedLagMs)
    softWarns.push({ axis: 'feedLag', level: 'band', actual: axes.feedLag.p95, budget: 5_000, why: 'feed lag p95 落 5-30s 软档（spec §9.4）' });
  // —— 软 warn：apply_replay_ms 软预算 ——
  const arBudget = SOFT_BUDGETS.find((b) => b.axis === 'applyReplay');
  if (axes.applyReplay?.p95 != null && axes.applyReplay.p95 > arBudget.budgetP95Ms)
    softWarns.push({ axis: 'applyReplay', level: 'over', actual: axes.applyReplay.p95, budget: arBudget.budgetP95Ms, why: `${arBudget.why}——触发 fork/patch 评审` });
  // —— 软 warn：echo_bytes 结构性上界 ——
  if (axes.echo?.bytes != null && axes.echo.inboundBytes > 0) {
    const ceiling = axes.echo.inboundBytes * (axes.echo.fanoutCeiling ?? 10);
    if (axes.echo.bytes > ceiling)
      softWarns.push({ axis: 'echoBytes', level: 'over', actual: axes.echo.bytes, budget: ceiling, why: 'echo_bytes 超入站×扇出上界（广播放大异常——评审）' });
  }
  // —— 软 warn：p99 尾部劣化 ——
  for (const p of P99_AXES) {
    const v = p.get(axes);
    if (v != null && v > p.threshold * 2)
      softWarns.push({ axis: p.axis, level: 'band', actual: v, budget: p.threshold * 2, why: `${p.label}=${v}ms >2×硬门阈值（尾部劣化信号）` });
  }

  return { verdict: hardBlocks.length ? 'fail' : 'pass', hardBlocks, softWarns, unobservable };
}

/** 分位数（最近秩口径——装置原始样本数组；runbook §9 桶上界口径另注明，两者不混算）。 */
export function percentileNearestRank(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** 样本数组 → {p50,p95,p99,max,count}（装置分轴标准形）。 */
export function axisOf(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return { p50: null, p95: null, p99: null, max: null, count: 0 };
  return {
    p50: percentileNearestRank(samples, 50),
    p95: percentileNearestRank(samples, 95),
    p99: percentileNearestRank(samples, 99),
    max: Math.max(...samples),
    count: samples.length,
  };
}
