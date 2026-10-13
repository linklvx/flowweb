#!/usr/bin/env node
// scripts/check-collab-health.mjs —— Y0b-5 T15（Y0b-3 移交②收口）：collab 面巡检（cron */5）。
// 数据源：GET /metrics（x-prometheus-token——生产 fail-closed）+GET /api/ready（公开档 ready/reason 即可）。
// 退出码：0=健康；1=P1；2=P0。P0/P1 清单单源=collab-health-thresholds.mjs THRESHOLDS（键=实际注册指标名——测试机器断言）。
// 机制（plan T15）：
//   · 上次采样持久化 .data/collab-health-last.json（跨 run 增量可测——10s 窗测不出 5min 事故的修复；/tmp 重启即丢禁用）；
//   · 首跑（无 last）增量类全标 insufficient-samples 且按 plan 字面计 P1 → exit 1（装 crontab 后第一个周期属预期）；
//   · counter 进程重启回落=重基线不误报（部署每重启一次即一轮重基线——部署窗告警归 deploy-guard 域）；
//   · SMS=P0 且 per-check 节流 15min（.data/collab-health-sms-throttle.json——新 P0 不被旧 P0 吞）；
//     ALERT_SMS_TO 未设→SMS 跳过 exit 不变（最小可用降级）；SDK=tencentcloud-sdk-nodejs-sms 经
//     createRequire 锚 apps/api 解析（独立于 api 部署树——server 侧 cron 在仓根可解析）；
//   · 心跳自证：每次运行先写 .data/collab-health-heartbeat.txt——外层停更>15min=P0 判据（runbook §6）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { THRESHOLDS, resolveSpoolCapacityBytes, NOT_SERVING_P0_MS, SMS_THROTTLE_MS } from './collab-health-thresholds.mjs';
import { readEnvFile } from './lib/env-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_KEYS = [
  'PROMETHEUS_TOKEN', 'ALERT_SMS_TO', 'ALERT_SMS_TEMPLATE_ID',
  'TENCENT_SMS_SECRET_ID', 'TENCENT_SMS_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_TEMPLATE_ID', 'TENCENT_SMS_SIGN_NAME',
  'COLLAB_SPOOL_CAPACITY_BYTES', 'COLLAB_HEALTH_API_URL', 'COLLAB_HEALTH_STATE_DIR',
];

/** prom 文本最小 parser：`name{k="v",…} value` 行（# 注释跳过）——不引 prom-client（根 scripts 零依赖惯例）。 */
export function parsePromText(text) {
  const samples = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sp = line.lastIndexOf(' ');
    if (sp < 0) continue;
    const v = Number(line.slice(sp + 1));
    if (!Number.isFinite(v)) continue;
    const series = line.slice(0, sp);
    const brace = series.indexOf('{');
    const name = brace < 0 ? series : series.slice(0, brace);
    const labels = {};
    if (brace >= 0) for (const m of series.slice(brace + 1).matchAll(/([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"/g)) labels[m[1]] = m[2];
    samples.push({ name, labels, value: v });
  }
  const labelsMatch = (a, want) => want === undefined || Object.entries(want).every(([k, v]) => a[k] === v);
  return {
    samples,
    get: (name, labels) => samples.find((s) => s.name === name && labelsMatch(s.labels, labels))?.value ?? null,
    sum: (name, labels) => samples.filter((s) => s.name === name && labelsMatch(s.labels, labels)).reduce((a, s) => a + s.value, 0),
  };
}

/** counter 状态键（带 label 过滤的拼进键——rounds/counter 共用键域）。 */
function counterKey(name, t) {
  if (!t.labels) return name;
  return `${name}{${Object.entries(t.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

const insuff = (check, detail) => ({ check, level: 'P1', insufficient: true, detail: `insufficient-samples——${detail}` });

/**
 * 纯评估：sample（拉取结果）+last（上次 nextLast|null）→ findings + nextLast（持久化态）。
 * findings 单源遍历 THRESHOLDS（kind 分派）——阈值表即检查清单，无第二份手抄面。
 */
export function evaluate(sample, last, now, env) {
  const findings = [];
  const nextLast = {
    ts: now,
    counters: { ...(last?.counters ?? {}) },
    rounds: { ...(last?.rounds ?? {}) },
    overload_tripped: 0,
    not_serving_since: null,
    zero_conn_last: null,
  };
  const metricsOk = !!sample.metricsOk;
  const m = sample.metrics;
  const cap = resolveSpoolCapacityBytes(env);

  // —— ready 面（非指标驱动：not-serving 持续>1min 升 P0——drain 60s 自动解除窗之外的真卡死） ——
  if (!sample.readyOk) {
    findings.push({ check: 'ready-unreachable', level: 'P1', detail: '/api/ready 不可达（api 进程哑/端口不对——整机死亡面归 runbook 第二机探测）' });
  } else if (sample.ready && !sample.ready.ready) {
    const reason = sample.ready.reason ?? 'unknown';
    if (reason === 'not-serving') {
      const since = last?.not_serving_since ?? null;
      nextLast.not_serving_since = since ?? now;
      if (since !== null && now - since > NOT_SERVING_P0_MS) {
        findings.push({ check: 'not-serving>1min', level: 'P0', detail: `not-serving 持续 ${Math.floor((now - since) / 1000)}s（租约 held∧未服务——查 gateway 状态机/pm2 日志）` });
      } else {
        findings.push({ check: 'ready-false', level: 'P1', detail: `ready=false reason=${reason}（观察窗内——持续>1min 升 P0）` });
      }
    } else {
      findings.push({ check: 'ready-false', level: 'P1', detail: `ready=false reason=${reason}` });
    }
  }
  if (!metricsOk) {
    findings.push({ check: 'metrics-unreachable', level: 'P1', detail: '/metrics 拉取失败（403=PROMETHEUS_TOKEN 失配——生产 fail-closed；连接拒绝=进程哑）' });
  }

  // —— 指标面（THRESHOLDS 单源遍历） ——
  for (const [name, t] of Object.entries(THRESHOLDS)) {
    const prevRounds = last?.rounds?.[name] ?? 0;

    if (t.kind === 'counter-delta' || t.kind === 'counter-share') {
      const ck = counterKey(name, t);
      const raw = !metricsOk ? null
        : t.kind === 'counter-share' ? m.sum(name)
          : t.labels ? m.sum(name, t.labels) : m.get(name);
      const cur = raw === null ? null : raw;   // 序列缺席（labels 未出现过）由 sum 折 0；get 无标签缺席折 0 在下行
      const curOrZero = cur ?? 0;
      const prev = last?.counters?.[ck];
      nextLast.counters[ck] = curOrZero;
      if (!metricsOk || prev === undefined) {
        if (t.kind === 'counter-delta' && (!t.rounds || prev === undefined)) findings.push(insuff(name, t.kind === 'counter-share' ? '份额基线未建' : `${name} 两样本差不可算`));
        continue;
      }
      if (curOrZero < prev) continue;   // 进程重启回落——重基线（counters 已更新）不误报
      const delta = curOrZero - prev;
      if (t.kind === 'counter-share') {
        if (delta <= 0) { nextLast.rounds[name] = 0; continue; }
        const num = t.matchLabels.reduce((a, lb) => a + Math.max(0, (m.sum(name, lb) ?? 0) - (last.counters[`${name}{${Object.entries(lb).map(([k, v]) => `${k}="${v}"`).join(',')}}`] ?? 0)), 0);
        if (delta >= t.minDelta && num / delta >= t.share) {
          findings.push({ check: name, level: t.level, detail: `${t.matchLabels.map((lb) => Object.values(lb)).flat().join('/')} 增量 ${num}/${delta}（${Math.floor((num / delta) * 100)}% ≥ ${t.share * 100}% 且 ≥${t.minDelta} 次）` });
        }
        continue;
      }
      if (delta > t.delta) {
        const rounds = prevRounds + 1;
        nextLast.rounds[name] = rounds;
        if (rounds >= (t.rounds ?? 1)) {
          findings.push({ check: name, level: t.level, detail: `增量 +${delta}${t.labels ? `（${counterKey(name, t)}）` : ''}${t.rounds ? `——连续第 ${rounds} 轮` : ''}` });
        }
      } else {
        nextLast.rounds[name] = 0;
      }
      continue;
    }

    if (t.kind === 'label-gauge-persistent') {
      const cur = metricsOk ? (m.get(name, t.labels) ?? 0) : 0;
      nextLast.overload_tripped = cur >= 1 ? 1 : 0;
      if (!last) { findings.push(insuff(name, '连续样本需上次采样')); continue; }
      if (cur >= 1 && last.overload_tripped >= 1) {
        findings.push({ check: name, level: t.level, detail: `heap 闸 ${JSON.stringify(t.labels)} 连续两样本命中——安全阀降级中（runbook：tripped 持续>10min=人工 drain+有序重启）` });
      }
      continue;
    }

    if (t.kind === 'gauge-tier') {
      const v = metricsOk ? (m.get(name) ?? 0) : 0;
      const hit = [...t.tiers].sort((a, b) => a.pct - b.pct).filter((tier) => v >= tier.pct * cap).pop();
      if (hit) {
        findings.push({ check: `${name}${hit.tag}`, level: hit.level, detail: `${v}B / 容量 ${cap}B（${(v / cap * 100).toFixed(1)}% 命中 ${hit.tag} 档）` });
      }
      continue;
    }

    if (t.kind === 'gauge-max') {
      const v = metricsOk ? (m.get(name) ?? 0) : 0;
      const exceeded = v > t.value;
      if (t.rounds) {
        if (!last) { findings.push(insuff(name, '持续判定需上次采样')); continue; }
        const rounds = exceeded ? prevRounds + 1 : 0;
        nextLast.rounds[name] = rounds;
        if (rounds >= t.rounds) findings.push({ check: name, level: t.level, detail: `${v} > ${t.value} 持续第 ${rounds} 轮` });
      } else if (exceeded) {
        findings.push({ check: name, level: t.level, detail: `${v} > ${t.value}` });
      }
      continue;
    }

    if (t.kind === 'gauge-no-fall') {
      const v = metricsOk ? (m.get(name) ?? 0) : 0;
      const prevV = last?.zero_conn_last ?? null;
      if (v <= 0) { nextLast.rounds[name] = 0; continue; }
      const rounds = prevV !== null && v >= prevV ? prevRounds + 1 : 1;
      nextLast.rounds[name] = rounds;
      if (!last) { findings.push(insuff(name, '不回落判定需上次采样')); continue; }
      if (rounds >= t.rounds && prevV !== null) {
        findings.push({ check: name, level: t.level, detail: `${v} 未回落（前值 ${prevV}——连续第 ${rounds} 轮，stuck 候选池）` });
      }
      continue;
    }
  }
  return { findings, nextLast };
}

/** 腾讯云 SMS 发送器（SDK 经 createRequire 锚 apps/api——独立于 api 部署树；凭据缺=构造失败降级 null）。 */
export function makeSmsSender(env, reqFromApi = null) {
  if (!env.ALERT_SMS_TO) return null;
  const req = reqFromApi ?? createRequire(path.join(ROOT, 'apps', 'api', 'package.json'));
  return async (check, text) => {
    const { sms } = req('tencentcloud-sdk-nodejs-sms');
    const client = new sms.v20210111.Client({
      credential: { secretId: env.TENCENT_SMS_SECRET_ID, secretKey: env.TENCENT_SMS_SECRET_KEY },
      region: 'ap-guangzhou',
    });
    const resp = await client.SendSms({
      PhoneNumberSet: [env.ALERT_SMS_TO],
      SmsSdkAppId: env.TENCENT_SMS_SDK_APP_ID,
      TemplateId: env.ALERT_SMS_TEMPLATE_ID ?? env.TENCENT_SMS_TEMPLATE_ID,
      TemplateParamSet: [text],
      SignName: env.TENCENT_SMS_SIGN_NAME,
    });
    const status = resp.SendStatusSet?.[0];
    if (status?.Code !== 'Ok') throw new Error(`SMS rejected: ${status?.Code}`);
  };
}

/** 单轮巡检（CLI 与测试共用——fetch/stateDir/env/smsSender 全注入）。 */
export async function runCheck(opts) {
  const { now = Date.now(), fetchImpl = globalThis.fetch, stateDir, env = {}, smsSender = null } = opts;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'collab-health-heartbeat.txt'), new Date(now).toISOString());   // 心跳先行——评估/发送失败也留痕

  const lastPath = path.join(stateDir, 'collab-health-last.json');
  const throttlePath = path.join(stateDir, 'collab-health-sms-throttle.json');
  const last = fs.existsSync(lastPath) ? JSON.parse(fs.readFileSync(lastPath, 'utf8')) : null;

  const base = (env.COLLAB_HEALTH_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const headers = env.PROMETHEUS_TOKEN ? { 'x-prometheus-token': env.PROMETHEUS_TOKEN } : {};
  let metricsOk = false;
  let metrics = null;
  try {
    const r = await fetchImpl(`${base}/metrics`, { headers, signal: AbortSignal.timeout(10_000) });
    if (r.ok) { metrics = parsePromText(await r.text()); metricsOk = true; }
  } catch { /* 折 P1 metrics-unreachable */ }
  let readyOk = false;
  let ready = null;
  try {
    const r = await fetchImpl(`${base}/api/ready`, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) { ready = await r.json(); readyOk = true; }
  } catch { /* 折 P1 ready-unreachable */ }

  const { findings, nextLast } = evaluate({ metricsOk, metrics, readyOk, ready }, last, now, env);
  fs.writeFileSync(lastPath, JSON.stringify(nextLast));

  // SMS：P0 恰 check 一条、per-check 节流（节流窗内复发不重发；新 P0 各发各的）
  const throttle = fs.existsSync(throttlePath) ? JSON.parse(fs.readFileSync(throttlePath, 'utf8')) : {};
  const smsSent = [];
  for (const f of findings.filter((x) => x.level === 'P0')) {
    if (throttle[f.check] !== undefined && now - throttle[f.check] < SMS_THROTTLE_MS) continue;
    throttle[f.check] = now;
    if (!smsSender) continue;
    try {
      await smsSender(f.check, `[P0]${f.check}`.slice(0, 60));   // 模板 {1} 单参——短信正文短键，明细走日志
      smsSent.push(f.check);
    } catch (e) {
      console.error(`check-collab-health: SMS 发送失败（${f.check}）——${e?.message ?? e}（exit 码不受影响：告警旁路非判据）`);
    }
  }
  fs.writeFileSync(throttlePath, JSON.stringify(throttle));

  for (const f of findings) console.log(`[${f.level}]${f.insufficient ? '[insufficient-samples]' : ''} ${f.check} —— ${f.detail}`);
  const exitCode = findings.some((f) => f.level === 'P0') ? 2 : findings.some((f) => f.level === 'P1') ? 1 : 0;
  return { exitCode, findings, smsSent };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const env = { ...readEnvFile(path.join(ROOT, 'apps', 'api', '.env'), ENV_KEYS), ...process.env };   // 已设 process.env 优先（B12 不覆盖）
  const stateDir = env.COLLAB_HEALTH_STATE_DIR ?? path.join(ROOT, '.data');
  runCheck({ stateDir, env, smsSender: makeSmsSender(env) })
    .then((r) => { console.log(`check-collab-health: ${r.exitCode === 0 ? 'OK' : r.exitCode === 1 ? 'P1' : 'P0'}（exit ${r.exitCode}）`); process.exitCode = r.exitCode; })
    .catch((e) => { console.error(`check-collab-health: 结构性错误（exit 2）——${e?.stack ?? e}`); process.exitCode = 2; });   // 用 exitCode 非 process.exit——Windows 下 undici 句柄收尾期硬 exit 会踩 libuv 断言吞退出码（实测 127）
}
