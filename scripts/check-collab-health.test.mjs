// scripts/check-collab-health.test.mjs —— Y0b-5 T15 红测（plan 四 it + parser 面钉）。
// 消费形态：verify 链 scripts-node-test 步列举（node --test 非 glob——空 glob 假绿已修）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMetricFiles, extractMetricNames } from './check-spec-consistency.mjs';
import { THRESHOLDS, resolveSpoolCapacityBytes } from './collab-health-thresholds.mjs';
import { parsePromText, evaluate, runCheck } from './check-collab-health.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ===== it 1：阈值表单源断言（机器派生禁手抄） =====

test('阈值表单源断言：THRESHOLDS 键 ⊆ 实际注册指标名（*.metrics.ts 机器提取）+T14 四键覆盖+资金 P0 面在场', () => {
  const registered = new Set(extractMetricNames(collectMetricFiles().map((f) => fs.readFileSync(f, 'utf8')).join('\n')));
  const stray = Object.keys(THRESHOLDS).filter((k) => !registered.has(k));
  assert.deepEqual(stray, [], `THRESHOLDS 含未注册指标名（手抄漂移）：${stray.join(', ')}`);
  // T14 四键（degraded dirtyDocs/oldestUnflushed/spoolDepth/stuckDocs 的指标同源面——ready.service 注释口径）
  const t14 = Object.entries(THRESHOLDS).map(([k, v]) => v.t14Key).filter(Boolean);
  assert.deepEqual([...new Set(t14)].sort(), ['dirtyDocs', 'oldestUnflushed', 'spoolDepth', 'stuckDocs'],
    'T14 四键注解（t14Key）必须齐且恰四——巡检与 ready token 视图同源');
  // 资金不变量 P0 面（plan T15 P0 清单钉——名字从 THRESHOLDS 读，测试只钉键名契约）
  for (const m of ['intent_frozen_stranded_total', 'intent_reconcile_mismatch_total', 'ai_artifact_discarded_total', 'yjs_spool_capacity_total', 'collab_overload_state']) {
    assert.equal(THRESHOLDS[m]?.level, 'P0', `${m} 必须在 THRESHOLDS 且 P0`);
  }
});

// ===== it 2：P0 命中→exit 2+SMS 恰一条+per-check 节流 =====

/** 健康基线 prom 文本（叠加 overrides：{seriesId: value}——缺席序列按 0 处理） */
function promText(overrides = {}) {
  const base = {
    'collab_overload_state{state="ok"}': 1,
    'collab_overload_state{state="tripped"}': 0,
    intent_frozen_stranded_total: 0,
    intent_reconcile_mismatch_total: 0,
    'ai_artifact_discarded_total{cause="node-deleted"}': 0,
    'ai_artifact_discarded_total{cause="precall-miss"}': 0,
    yjs_spool_capacity_total: 0,
    yjs_spool_depth_bytes: 0,
    yjs_doc_stuck_total: 0,
    yjs_zero_conn_docs: 0,
    'collab_auth_reject_total{reason="rate",source="bucket"}': 0,
    yjs_doc_bytes_over_threshold_total: 0,
    yjs_pending_projects: 0,
    yjs_oldest_unflushed_age_seconds: 0,
    awareness_states: 0,
    'collab_ws_close_total{code="1000",reason="x"}': 0,
    'collab_ws_close_total{code="4410",reason="y"}': 0,
    'collab_ws_close_total{code="4404",reason="z"}': 0,
    ...overrides,
  };
  return Object.entries(base).map(([k, v]) => `${k} ${v}`).join('\n') + '\n';
}

/** fetch 注入（url 末段分派 /metrics 与 /api/ready） */
function makeFetch({ metricsText, readyBody = { ready: true } }) {
  return async (url) => {
    if (String(url).endsWith('/metrics')) {
      if (metricsText === null) throw new Error('metrics unreachable');
      return { ok: true, status: 200, text: async () => metricsText };
    }
    if (String(url).endsWith('/api/ready')) return { ok: true, status: 200, json: async () => readyBody };
    throw new Error(`unexpected url ${url}`);
  };
}

test('P0 命中→exit 2+SMS 恰一条+per-check 节流（同 check 重跑不重发、异 check 各发）', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-health-'));
  const sent = [];
  const smsSender = async (check, text) => { sent.push({ check, text }); };
  const env = {};
  let metricsText = promText();

  // run1：首跑建基线（增量类 insufficient→exit 1——it 3 覆盖；此处只取基线副作用）
  const r1 = await runCheck({ now: 1_000_000, fetchImpl: makeFetch({ metricsText }), stateDir, env, smsSender });
  assert.equal(r1.exitCode, 1);
  assert.equal(sent.length, 0, 'P1/insufficient 不发 SMS');

  // run2：spool 容量熔断 0→1（P0 硬停面）——恰一条 SMS
  metricsText = promText({ yjs_spool_capacity_total: 1 });
  const r2 = await runCheck({ now: 1_000_000 + 300_000, fetchImpl: makeFetch({ metricsText }), stateDir, env, smsSender });
  assert.equal(r2.exitCode, 2, 'P0 命中 exit 2');
  const p0 = r2.findings.filter((f) => f.level === 'P0');
  assert.equal(p0.length, 1, `本样本恰一个 P0（实得 ${JSON.stringify(p0)}）`);
  assert.equal(p0[0].check, 'yjs_spool_capacity_total');
  assert.equal(sent.length, 1, 'SMS 恰一条');
  assert.match(sent[0].text, /yjs_spool_capacity_total/);

  // run3：同 check 再命中（capacity 1→2 再增，5min 后节流窗内）——不重发，exit 仍 2
  metricsText = promText({ yjs_spool_capacity_total: 2 });
  const r3 = await runCheck({ now: 1_000_000 + 600_000, fetchImpl: makeFetch({ metricsText }), stateDir, env, smsSender });
  assert.equal(r3.exitCode, 2);
  assert.equal(sent.length, 1, '同 check 节流窗内不重发');

  // run4：新 P0（资金不变量 intent_frozen_stranded_total 0→5）——不被旧 P0 吞，各发各的
  metricsText = promText({ yjs_spool_capacity_total: 3, intent_frozen_stranded_total: 5 });
  const r4 = await runCheck({ now: 1_000_000 + 900_000, fetchImpl: makeFetch({ metricsText }), stateDir, env, smsSender });
  assert.equal(r4.exitCode, 2);
  assert.deepEqual(r4.findings.filter((f) => f.level === 'P0').map((f) => f.check),
    ['intent_frozen_stranded_total', 'yjs_spool_capacity_total']);
  assert.equal(sent.length, 2, '异 check 各发——新 P0 不被旧 P0 节流吞');
  assert.equal(sent[1].check, 'intent_frozen_stranded_total');
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test('节流窗过期后同 check 复发可再发（SMS_THROTTLE_MS 边界）', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-health-'));
  const sent = [];
  const env = {};
  const withCap = promText({ yjs_spool_capacity_total: 1 });
  await runCheck({ now: 1_000_000, fetchImpl: makeFetch({ metricsText: promText() }), stateDir, env, smsSender: async (c, t) => sent.push({ check: c }) });
  await runCheck({ now: 1_000_000 + 300_000, fetchImpl: makeFetch({ metricsText: withCap }), stateDir, env, smsSender: async (c, t) => sent.push({ check: c }) });
  await runCheck({ now: 1_000_000 + 300_000 + 16 * 60_000, fetchImpl: makeFetch({ metricsText: promText({ yjs_spool_capacity_total: 2 }) }), stateDir, env, smsSender: async (c, t) => sent.push({ check: c }) });
  assert.equal(sent.length, 2, '超过 15min 节流窗后复发重发');
  fs.rmSync(stateDir, { recursive: true, force: true });
});

// ===== it 3：样本不足（首跑）→P1+insufficient-samples 标注 =====

test('样本不足（首跑）→P1+insufficient-samples 标注；二次 run 增量可判→健康 exit 0', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-health-'));
  const metricsText = promText();
  const r1 = await runCheck({ now: 1_000_000, fetchImpl: makeFetch({ metricsText }), stateDir, env: {}, smsSender: async () => { throw new Error('P1 不应发 SMS'); } });
  assert.equal(r1.exitCode, 1, '首跑 exit 1（plan 字面：样本不足→P1）');
  const insuff = r1.findings.filter((f) => f.insufficient);
  assert.ok(insuff.length >= 5, `增量类 check 全部标注（实得 ${insuff.length} 条）`);
  assert.ok(insuff.every((f) => f.level === 'P1'));

  // 状态持久化自证：last.json + heartbeat 落盘
  assert.ok(fs.existsSync(path.join(stateDir, 'collab-health-last.json')), 'last.json 落盘');
  assert.ok(fs.existsSync(path.join(stateDir, 'collab-health-heartbeat.txt')), 'heartbeat.txt 落盘');

  const r2 = await runCheck({ now: 1_000_000 + 300_000, fetchImpl: makeFetch({ metricsText }), stateDir, env: {}, smsSender: async () => { throw new Error('健康不应发 SMS'); } });
  assert.equal(r2.exitCode, 0, '二次 run 健康样本 exit 0');
  assert.deepEqual(r2.findings, []);
  fs.rmSync(stateDir, { recursive: true, force: true });
});

// ===== it 4：外部整机可达性探测 = runbook 行（巡检脚本无法自证整机死亡） =====

test('外部整机可达性探测：runbook §6 行（第二机探测+crontab */5+心跳外层判据）', () => {
  const runbook = fs.readFileSync(path.join(ROOT, 'docs/superpowers/collab-ops-runbook.md'), 'utf8');
  const s6 = runbook.split('## §6')[1]?.split('## §7')[0] ?? '';
  assert.ok(s6.includes('check-collab-health.mjs'), '§6 载明巡检脚本');
  assert.ok(s6.includes('*/5'), '§6 crontab */5 行（复制即用）');
  assert.ok(/第二机|uptime/.test(s6), '§6 第二机/第三方 uptime 外部探测行');
  assert.ok(/heartbeat[\s\S]{0,200}-mmin \+15|-mmin \+15|>15min/.test(s6), '§6 心跳外层停更>15min=P0 判据行');
});

// ===== P0/P1 逐面钉（evaluate 纯函数——runCheck 之外的可判性） =====

test('evaluate：not-serving>1min→P0；其余 ready=false reason→P1', () => {
  const base = parsePromText(promText());
  const e1 = evaluate({ metricsOk: true, metrics: base, readyOk: true, ready: { ready: false, reason: 'not-serving' } },
    { ts: 0, counters: {}, overload_tripped: 0, not_serving_since: 1_000_000 - 120_000, rounds: {} }, 1_000_000, {});
  assert.ok(e1.findings.some((f) => f.level === 'P0' && f.check.includes('not-serving')), '持续 not-serving>1min → P0');
  const e2 = evaluate({ metricsOk: true, metrics: base, readyOk: true, ready: { ready: false, reason: 'pg-down' } }, null, 1_000_000, {});
  assert.ok(e2.findings.some((f) => f.level === 'P1' && f.check === 'ready-false' && /pg-down/.test(f.detail)));
});

test('evaluate：heap 闸 tripped 连续两样本→P0；spool 深度 50%/80% 预阈值 P1+满仓 P0', () => {
  const tripped = parsePromText(promText({ 'collab_overload_state{state="ok"}': 0, 'collab_overload_state{state="tripped"}': 1 }));
  const last = { ts: 0, counters: {}, overload_tripped: 1, not_serving_since: null, rounds: {} };
  const e = evaluate({ metricsOk: true, metrics: tripped, readyOk: true, ready: { ready: true } }, last, 1_000_000, {});
  assert.ok(e.findings.some((f) => f.level === 'P0' && f.check === 'collab_overload_state'), 'tripped 连续 → P0');

  const cap = resolveSpoolCapacityBytes({});
  const half = parsePromText(promText({ yjs_spool_depth_bytes: Math.floor(cap * 0.5) + 1 }));
  const f50 = evaluate({ metricsOk: true, metrics: half, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  assert.ok(f50.findings.some((f) => f.level === 'P1' && f.check.includes('50%')), '≥50% 预阈值 P1');
  const deep = parsePromText(promText({ yjs_spool_depth_bytes: Math.floor(cap * 0.8) + 1 }));
  const f80 = evaluate({ metricsOk: true, metrics: deep, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  assert.ok(f80.findings.some((f) => f.level === 'P1' && f.check.includes('80%')), '≥80% 预阈值 P1');
  assert.ok(!f80.findings.some((f) => f.check.includes('50%')), '同指标高档命中不叠发低档（一条 SMS 面）');
  const full = parsePromText(promText({ yjs_spool_depth_bytes: cap }));
  const f100 = evaluate({ metricsOk: true, metrics: full, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  assert.ok(f100.findings.some((f) => f.level === 'P0' && f.check.includes('full')), '满仓 P0');
});

test('evaluate：T14 四键（dirtyDocs/oldestUnflushed）越阈 P1+stuck 增量连续 2 轮 P1+ws_close 4410/4404 占比 P1', () => {
  const dirty = parsePromText(promText({ yjs_pending_projects: 21, yjs_oldest_unflushed_age_seconds: 121 }));
  const e = evaluate({ metricsOk: true, metrics: dirty, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  assert.ok(e.findings.some((f) => f.level === 'P1' && f.check === 'yjs_pending_projects'), 'dirtyDocs 越阈 P1');
  assert.ok(e.findings.some((f) => f.level === 'P1' && f.check === 'yjs_oldest_unflushed_age_seconds'), 'oldestUnflushed 越阈 P1');

  // stuck 增量：第 1 轮记录、第 2 轮（连续）才 P1
  const s1 = parsePromText(promText({ yjs_doc_stuck_total: 1 }));
  const e1 = evaluate({ metricsOk: true, metrics: s1, readyOk: true, ready: { ready: true } },
    { ts: 0, counters: { yjs_doc_stuck_total: 0 }, overload_tripped: 0, not_serving_since: null, rounds: {} }, 1_000_000, {});
  assert.ok(!e1.findings.some((f) => f.check === 'yjs_doc_stuck_total' && !f.insufficient), '第 1 轮 stuck 增量不即红（连续 2 轮=10min 口径）');
  const s2 = parsePromText(promText({ yjs_doc_stuck_total: 2 }));
  const e2 = evaluate({ metricsOk: true, metrics: s2, readyOk: true, ready: { ready: true } }, e1.nextLast, 1_000_000 + 300_000, {});
  assert.ok(e2.findings.some((f) => f.level === 'P1' && f.check === 'yjs_doc_stuck_total'), '连续第 2 轮 stuck 增量 → P1');

  // ws_close 占比：4410+4404 占 6/7 ≥ 0.2 且 ≥5 次 → P1
  const ws = parsePromText(promText({
    'collab_ws_close_total{code="1000",reason="x"}': 1,
    'collab_ws_close_total{code="4410",reason="y"}': 4,
    'collab_ws_close_total{code="4404",reason="z"}': 2,
  }));
  const ew = evaluate({ metricsOk: true, metrics: ws, readyOk: true, ready: { ready: true } },
    { ts: 0, counters: { 'collab_ws_close_total': 0 }, overload_tripped: 0, not_serving_since: null, rounds: {} }, 1_000_000, {});
  assert.ok(ew.findings.some((f) => f.level === 'P1' && f.check === 'collab_ws_close_total'), '4410/4404 占比 ≥20% 且 ≥5 次 → P1');
});

test('evaluate：counter 进程重启回落=重基线不误报；metrics 不可达→P1+全增量 insufficient', () => {
  const afterRestart = parsePromText(promText({ yjs_spool_capacity_total: 0 }));
  const e = evaluate({ metricsOk: true, metrics: afterRestart, readyOk: true, ready: { ready: true } },
    { ts: 0, counters: { yjs_spool_capacity_total: 3 }, overload_tripped: 0, not_serving_since: null, rounds: {} }, 1_000_000, {});
  assert.ok(!e.findings.some((f) => f.check === 'yjs_spool_capacity_total' && !f.insufficient), 'counter 回落（进程重启）不判增量');

  const dead = evaluate({ metricsOk: false, metrics: null, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  assert.ok(dead.findings.some((f) => f.level === 'P1' && f.check === 'metrics-unreachable'), 'metrics 拉取失败 → P1');
  assert.ok(dead.findings.filter((f) => f.insufficient).length >= 5, '全增量类 insufficient');
});

test('parsePromText：带标签/无标签/缺席序列语义', () => {
  const p = parsePromText('collab_overload_state{state="ok"} 1\nintent_frozen_stranded_total 0\n');
  assert.equal(p.get('collab_overload_state', { state: 'ok' }), 1);
  assert.equal(p.get('collab_overload_state', { state: 'tripped' }), null, '缺席 label 组合 → null');
  assert.equal(p.get('intent_frozen_stranded_total'), 0);
  assert.equal(p.get('yjs_spool_capacity_total'), null, '缺席序列 → null（调用面折 0）');
  assert.equal(p.sum('collab_overload_state'), 1);
});

// ===== T15 审查修复钉（spec 审查实测三缺陷：zero_conn 死代码/share 分子基线/label 族求和） =====

test('T15R1：zero_conn 恒值不回落连跑 3 轮→P1（zero_conn_last 持久化——死代码复活）', () => {
  const sample = { metricsOk: true, metrics: parsePromText(promText({ yjs_zero_conn_docs: 5 })), readyOk: true, ready: { ready: true } };
  const e1 = evaluate(sample, null, 1_000_000, {});
  const e2 = evaluate(sample, e1.nextLast, 1_000_000 + 300_000, {});
  const e3 = evaluate(sample, e2.nextLast, 1_000_000 + 600_000, {});
  assert.ok(e3.findings.some((f) => f.level === 'P1' && f.check === 'yjs_zero_conn_docs' && !f.insufficient),
    'zero_conn=5 恒值 3 轮 → P1（现状 zero_conn_last 恒 null——prevV!==null 不可达，P1 永不触发）');
});

test('T15R2：share 分子=同口径窗口增量（历史 4410 累计不折分子）+首跑标 insufficient', () => {
  // run1 建基线：4410 历史累计 1000
  const c1 = parsePromText(promText({ 'collab_ws_close_total{code="4410",reason="y"}': 1000 }));
  const e1 = evaluate({ metricsOk: true, metrics: c1, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  assert.ok(e1.findings.some((f) => f.check === 'collab_ws_close_total' && f.insufficient),
    'share 首跑标 insufficient（份额基线未建）——现状静默跳过');
  // run2：新窗族总量 +5（全为正常 code=1000）、4410 累计不动 → 分子应为 0（现状=绝对累计 1000/5=20000% 误报 P1）
  const c2 = parsePromText(promText({ 'collab_ws_close_total{code="4410",reason="y"}': 1000, 'collab_ws_close_total{code="1000",reason="x"}': 5 }));
  const e2 = evaluate({ metricsOk: true, metrics: c2, readyOk: true, ready: { ready: true } }, e1.nextLast, 1_000_000 + 300_000, {});
  assert.ok(!e2.findings.some((f) => f.check === 'collab_ws_close_total' && !f.insufficient),
    '分子分母同口径窗口增量——历史累计不折分子，新窗仅 5 次正常关闭不误报');
  // run3 正路径：新窗 4410 +5 / 总量 +5 → 100% ≥ 20% 触发（防退化钉）
  const c3 = parsePromText(promText({ 'collab_ws_close_total{code="4410",reason="y"}': 1005, 'collab_ws_close_total{code="1000",reason="x"}': 5 }));
  const e3 = evaluate({ metricsOk: true, metrics: c3, readyOk: true, ready: { ready: true } }, e2.nextLast, 1_000_000 + 600_000, {});
  assert.ok(e3.findings.some((f) => f.level === 'P1' && f.check === 'collab_ws_close_total'),
    '同口径窗口增量正路径仍触发（4410 新窗 5/5=100%）');
});

test('T15R3：无 labels counter-delta 对 labelNames 族求和（非首 series 增量不漏报 P0）', () => {
  const b1 = parsePromText(promText());   // 基线含 node-deleted（首 series）+precall-miss 双 cause
  const e1 = evaluate({ metricsOk: true, metrics: b1, readyOk: true, ready: { ready: true } }, null, 1_000_000, {});
  const b2 = parsePromText(promText({ 'ai_artifact_discarded_total{cause="precall-miss"}': 5 }));   // 仅非首 series +5
  const e2 = evaluate({ metricsOk: true, metrics: b2, readyOk: true, ready: { ready: true } }, e1.nextLast, 1_000_000 + 300_000, {});
  assert.ok(e2.findings.some((f) => f.level === 'P0' && f.check === 'ai_artifact_discarded_total'),
    '非首 series（cause=precall-miss）+5 → P0（现状 m.get 只取 prom 文本首个 series——漏报）');
});

// ===== T15 质量审查修复钉（C1 metrics 闪断基线毒化伪造资金 P0 / I1 状态 JSON 容错 / M3 节流戳时机） =====

test('T15Q-C1：metrics 闪断→恢复→零新增事件不告 P0/P1（基线保留非毒化为 0）+share 分子基线同保留', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-health-'));
  const sent = [];
  const smsSender = async (check) => { sent.push(check); };
  // run1 建基线：资金不变量历史累计 3 + ws_close 4410 历史累计 1000（首跑 insuff → 重基线在累计值）
  const hist = promText({
    intent_frozen_stranded_total: 3,
    'collab_ws_close_total{code="4410",reason="y"}': 1000,
    'collab_ws_close_total{code="1000",reason="x"}': 2,
  });
  const r1 = await runCheck({ now: 1_000_000, fetchImpl: makeFetch({ metricsText: hist }), stateDir, env: {}, smsSender });
  assert.equal(r1.exitCode, 1, '首跑 insuff（预期 P1）');
  assert.equal(sent.length, 0);
  // run2 闪断：/metrics 瞬时不可达（本轮 P1 属预期）——旧码将已建基线毒化为 0
  const r2 = await runCheck({ now: 1_000_000 + 300_000, fetchImpl: makeFetch({ metricsText: null }), stateDir, env: {}, smsSender });
  assert.equal(r2.exitCode, 1, '闪断轮 metrics-unreachable P1（预期）');
  // run3 恢复：各 counter 累计不动（零新增事件）→ 不得伪造 P0/P1/SMS
  const r3 = await runCheck({ now: 1_000_000 + 600_000, fetchImpl: makeFetch({ metricsText: hist }), stateDir, env: {}, smsSender });
  assert.equal(r3.exitCode, 0, '恢复轮零新增——基线被毒化为 0 时此处伪造 intent_frozen_stranded_total P0（delta=3-0）+SMS');
  assert.deepEqual(r3.findings, []);
  assert.equal(sent.length, 0, '零新增事件不得发 SMS');
  // run4：恢复后首个真实增量窗=5 次正常关闭（4410 历史不动）→ 分子基线保留则分子=0 不告
  const plus5 = promText({
    intent_frozen_stranded_total: 3,
    'collab_ws_close_total{code="4410",reason="y"}': 1000,
    'collab_ws_close_total{code="1000",reason="x"}': 7,
  });
  const r4 = await runCheck({ now: 1_000_000 + 900_000, fetchImpl: makeFetch({ metricsText: plus5 }), stateDir, env: {}, smsSender });
  assert.equal(r4.exitCode, 0, 'share 分子基线毒化为 0 时 1000/5=20000% 伪造 share P1');
  assert.deepEqual(r4.findings, []);
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test('T15Q-C1：evaluate 闪断轮 nextLast 保留基线（counters 主键/share 分子键/zero_conn_last 不写 0）', () => {
  const last = {
    ts: 0, overload_tripped: 0, not_serving_since: null, zero_conn_last: 5,
    counters: { intent_frozen_stranded_total: 3, collab_ws_close_total: 1002, 'collab_ws_close_total{code="4410"}': 1000 },
    rounds: {},
  };
  const e = evaluate({ metricsOk: false, metrics: null, readyOk: true, ready: { ready: true } }, last, 1_000_000, {});
  assert.equal(e.nextLast.counters.intent_frozen_stranded_total, 3, 'counter 主基线保留（不写 0）');
  assert.equal(e.nextLast.counters['collab_ws_close_total{code="4410"}'], 1000, 'share 分子基线保留（不写 0）');
  assert.equal(e.nextLast.zero_conn_last, 5, 'zero_conn_last 保留（不毒化为 0）');
});

test('T15Q-I1：状态 JSON 损坏（torn write）→视同首跑重基线（非结构性 exit 2）；次轮健康自愈', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-health-'));
  const metricsText = promText();
  await runCheck({ now: 1_000_000, fetchImpl: makeFetch({ metricsText }), stateDir, env: {}, smsSender: null });
  // 撕裂写（写一半/截断）——旧码 JSON.parse throw → 每轮结构性 exit 2 无 SMS 无自愈
  fs.writeFileSync(path.join(stateDir, 'collab-health-last.json'), '{"ts":1000000,"counters":{');
  fs.writeFileSync(path.join(stateDir, 'collab-health-sms-throttle.json'), '{"yjs_');
  const r2 = await runCheck({ now: 1_000_000 + 300_000, fetchImpl: makeFetch({ metricsText }), stateDir, env: {}, smsSender: null });
  assert.equal(r2.exitCode, 1, '损坏态视同首跑——insuff P1（不 throw 结构性 exit 2）');
  const r3 = await runCheck({ now: 1_000_000 + 600_000, fetchImpl: makeFetch({ metricsText }), stateDir, env: {}, smsSender: null });
  assert.equal(r3.exitCode, 0, '重基线后次轮健康 exit 0（自愈闭环）');
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test('T15Q-M3：SMS 发送失败不消耗节流窗——同 check 节流窗内下轮重试可发', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-health-'));
  const sent = [];
  let smsDown = true;
  const smsSender = async (check) => { if (smsDown) throw new Error('sms down'); sent.push(check); };
  const env = {};
  await runCheck({ now: 1_000_000, fetchImpl: makeFetch({ metricsText: promText() }), stateDir, env, smsSender });   // 基线
  // run2：P0 命中但 SMS 发送失败——旧码节流戳已写 → 窗内复发被吞
  await runCheck({ now: 1_000_000 + 300_000, fetchImpl: makeFetch({ metricsText: promText({ yjs_spool_capacity_total: 1 }) }), stateDir, env, smsSender });
  assert.equal(sent.length, 0, 'run2 发送失败');
  smsDown = false;
  // run3：5min 后（节流窗 15min 内）同 check 复发——节流戳未消耗应重试发送
  await runCheck({ now: 1_000_000 + 600_000, fetchImpl: makeFetch({ metricsText: promText({ yjs_spool_capacity_total: 2 }) }), stateDir, env, smsSender });
  assert.equal(sent.length, 1, '失败轮未写节流戳——窗内复发重试发送（不被失败消耗）');
  fs.rmSync(stateDir, { recursive: true, force: true });
});
