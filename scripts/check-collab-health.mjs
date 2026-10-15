#!/usr/bin/env node
// scripts/check-collab-health.mjs —— Y0b-5 T15（Y0b-3 移交②收口）：collab 面巡检（cron */5）。
// 数据源：GET /metrics（x-prometheus-token——生产 fail-closed）+GET /api/ready（token 档——Y0c T29-II
// 起 workers 维度消费，请求带 COLLAB_ADMIN_TOKEN ?? PROMETHEUS_TOKEN 回退链 header〔C-1 controller 镜像〕）+GET worker 3002 /metrics（Y0c T29-II Z130③「巡检
// 即采集面」——loopback only⇒本巡检必须服务器本地 crontab；COLLAB_HEALTH_SKIP_WORKER=1 降级跳过）。
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
import { THRESHOLDS, resolveSpoolCapacityBytes, resolveMaxResidentBytes, NOT_SERVING_P0_MS, SMS_THROTTLE_MS, WORKER_METRIC_CHECKS, WORKER_PRESENCE_CHECK } from './collab-health-thresholds.mjs';
import { readEnvFile } from './lib/env-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_KEYS = [
  'PROMETHEUS_TOKEN', 'ALERT_SMS_TO', 'ALERT_SMS_TEMPLATE_ID',
  'COLLAB_ADMIN_TOKEN',          // Y0c T29-II（C-1）：/api/ready 授权档 token（controller 回退链 COLLAB_ADMIN_TOKEN ?? PROMETHEUS_TOKEN——admin 已设时 ready 只认它）
  'TENCENT_SMS_SECRET_ID', 'TENCENT_SMS_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_TEMPLATE_ID', 'TENCENT_SMS_SIGN_NAME',
  'COLLAB_SPOOL_CAPACITY_BYTES', 'COLLAB_HEALTH_API_URL', 'COLLAB_HEALTH_STATE_DIR',
  'COLLAB_MAX_RESIDENT_BYTES',   // Y0c T20（Z92）：yjs_resident_bytes 上限解析（residency 使用点默认 384MiB 同源）
  'COLLAB_HEALTH_WORKER_URL',    // Y0c T29-II（Z130③）：worker 3002 端点（缺省 http://127.0.0.1:3002——loopback，巡检必须服务器本地 crontab）
  'COLLAB_HEALTH_SKIP_WORKER',   // Y0c T29-II（R6b）：=1 跳过全部 worker 端点检查（COLLAB_ROLE=all 降级出口——runbook §11；缺省 fail-closed 期望 worker）
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
function labelSeriesKey(name, lb) {
  return `${name}{${Object.entries(lb).map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

function counterKey(name, t) {
  return t.labels ? labelSeriesKey(name, t.labels) : name;
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

  // —— ready token 档 workers 维度（Y0c T29-II Z130①②/R6c：付费三队列 registered≥1——任一 0/
  //    维度缺失/探测 null ⇒ P0〔worker 静默死亡=付费作业无声堆积面〕；waiting>阈值 ⇒ P1〔消费
  //    滞后——worker 活但吞吐不足〕。维度语义见偏离 39：registered=CLIENT LIST 活性信号，进程死
  //    ⇒TCP 断⇒立即除名，无 lastSeen） ——
  if (sample.readyOk && sample.ready) {
    const w = sample.ready.workers;
    if (!w) {
      findings.push({ check: 'ready-workers-missing', level: 'P0', detail: '/api/ready token 档缺 workers 维度（PROMETHEUS_TOKEN 未带/失配⇒公开五键档——巡检配置红；或 api 版本旧于 T29-II）' });
    } else {
      for (const q of WORKER_PRESENCE_CHECK.queues) {
        const p = w[q];
        if (!p || p.registered == null) {
          findings.push({ check: `ready-workers[${q}].registered`, level: 'P0', detail: `presence 探测失败/队列缺失（null=Redis 探测错——fail-closed 告；registered≥${WORKER_PRESENCE_CHECK.minRegistered} 不可判）` });
        } else if (p.registered < WORKER_PRESENCE_CHECK.minRegistered) {
          findings.push({ check: `ready-workers[${q}].registered`, level: 'P0', detail: `registered=${p.registered} <${WORKER_PRESENCE_CHECK.minRegistered}——付费队列无消费者（worker 静默死亡面；enqueue 已 fail-closed 503 拒收〔collab_worker_absent_total 交叉可读〕——分诊：pm2 worker/3002 端点）` });
        } else if (p.waiting > WORKER_PRESENCE_CHECK.maxWaiting) {
          findings.push({ check: `ready-workers[${q}].waiting`, level: 'P1', detail: `waiting=${p.waiting} >${WORKER_PRESENCE_CHECK.maxWaiting}（消费滞后——worker 在场但吞吐不足；持续升则查 provider 外呼时长/并发）` });
        }
      }
    }
  }

  // —— worker 3002 端点（Y0c T29-II Z130③/Z116/R6a：巡检即采集面——不可达 ⇒ P0〔kill worker
  //    ⇒ 下一轮 */5 非零退出的出口判据载体〕；COLLAB_HEALTH_SKIP_WORKER=1 ⇒ 全跳过〔R6b 降级
  //    出口——COLLAB_ROLE=all 单进程档无 3002 属预期〕） ——
  if (!sample.workerSkipped) {
    if (!sample.workerOk) {
      findings.push({ check: 'worker-metrics-unreachable', level: 'P0', detail: 'worker 3002 /metrics 不可达（进程静默死亡/pm2 未起/WORKER_METRICS_PORT 漂移/403=PROMETHEUS_TOKEN 失配——付费作业无声堆积面，runbook §11；降级出口=COLLAB_HEALTH_SKIP_WORKER=1）' });
    } else {
      const wm = sample.workerMetrics;
      for (const [name, t] of Object.entries(WORKER_METRIC_CHECKS)) {
        const family = wm.samples.filter((s) => s.name === name);
        if (family.length === 0) {
          findings.push({ check: name, level: 'P1', detail: `worker 端点族缺席（MetricsCore 未装配/collectDefaultMetrics 未跑——观测面结构缺陷，${t.note}）` });
          continue;
        }
        const bad = family.filter((s) => s.labels.role !== 'worker');
        if (bad.length > 0) {
          // Z116 分集：worker 端点所读族样本必须带 role="worker"——缺 role/异值=漏调 setDefaultLabels 的运行时侦测面
          findings.push({ check: name, level: 'P1', detail: `Z116 分集红：${bad.length} 样本缺 role="worker"（role 序列身份缺失/异值——main-worker 引导层 setDefaultLabels 漏调侦测面）` });
          continue;
        }
        const v = wm.get(name, { role: 'worker' }) ?? 0;
        if (v > t.value) findings.push({ check: name, level: t.level, detail: `worker ${v} > ${t.value}（${t.note}）` });
      }
    }
  }

  // —— 指标面（THRESHOLDS 单源遍历） ——
  for (const [name, t] of Object.entries(THRESHOLDS)) {
    const prevRounds = last?.rounds?.[name] ?? 0;

    if (t.kind === 'counter-delta' || t.kind === 'counter-share') {
      const ck = counterKey(name, t);
      const raw = !metricsOk ? null
        : t.kind === 'counter-share' ? m.sum(name)
          : m.sum(name, t.labels);   // t.labels 缺席=undefined→全族求和（labelNames 族取族和；单 series 族等价 get）
      const cur = raw === null ? null : raw;   // 序列缺席（labels 未出现过）由 sum 折 0
      const curOrZero = cur ?? 0;
      const prev = last?.counters?.[ck];
      if (metricsOk) {   // metrics 瞬时不可达时保留基线不写 0——否则恢复轮 delta=累计-0 伪造资金 P0+SMS（重启回落由下方 curOrZero<prev 重基线天然处理）
        nextLast.counters[ck] = curOrZero;
        if (t.kind === 'counter-share') {
          // 分子基线键一并写入（matchLabels 各键）——分子分母同口径窗口增量（只写族总量键则分子=绝对累计值误报）
          for (const lb of t.matchLabels) nextLast.counters[labelSeriesKey(name, lb)] = m.sum(name, lb);
        }
      }
      if (!metricsOk || prev === undefined) {
        if (prev === undefined || (t.kind === 'counter-delta' && !t.rounds)) findings.push(insuff(name, t.kind === 'counter-share' ? '份额基线未建' : `${name} 两样本差不可算`));
        continue;
      }
      if (curOrZero < prev) { nextLast.rounds[name] = 0; continue; }   // 进程重启回落——重基线（counters 已更新）不误报；rounds 清零防连续窗跨部署拼接
      const delta = curOrZero - prev;
      if (t.kind === 'counter-share') {
        if (delta <= 0) { nextLast.rounds[name] = 0; continue; }
        const num = t.matchLabels.reduce((a, lb) => a + Math.max(0, (m.sum(name, lb) ?? 0) - (last.counters[labelSeriesKey(name, lb)] ?? 0)), 0);
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
        // Y0c T29-II 小扩（Z148④）：warnLevel——持续判定未满窗时超限即发 WARN（首见档；
        // 无 warnLevel 的既有条目〔awareness_states〕行为零变化）
        else if (exceeded && t.warnLevel) findings.push({ check: name, level: t.warnLevel, detail: `${v} > ${t.value}（首见 WARN——持续 ${t.rounds} 轮升 ${t.level}）` });
      } else if (exceeded) {
        findings.push({ check: name, level: t.level, detail: `${v} > ${t.value}` });
      }
      continue;
    }

    if (t.kind === 'gauge-no-fall') {
      const v = metricsOk ? (m.get(name) ?? 0) : 0;
      nextLast.zero_conn_last = metricsOk ? v : (last?.zero_conn_last ?? null);   // 持久化当前值——下轮 prevV 判「不回落」（不写则恒 null，P1 不可达）；闪断轮保留上次值——毒化为 0 则丢「不回落」判定基线
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

    // Y0c T20（Z92 改形——Z106⑤）：guard gauge 与执法计数配对——「超限时必有 over_limit/evicted」非恒真
    // 形态。分支 A（超限）：violated = bytes>limit ∧ 两计数累计皆 0（连续 2 轮才告——reaper tick ≤15s
    // 滞后窗：首见超限后下一 tick 才计数，单轮即告会误报机制工作的首窗）；分支 B（上限内）：guardCounter
    // 增量稳定判定（连续 2 轮增量才告——样本间瞬态超限已被驱逐恢复=机制工作非病理；进程重启回落=重基线）。
    if (t.kind === 'bytes-guard-pair') {
      if (!metricsOk) continue;   // metrics 闪断不判（基线不写——counter-delta 闪断保留基线惯例在 guardCounter 键上同理不写 0）
      const bytes = m.get(name) ?? 0;
      const limit = resolveMaxResidentBytes(env);
      const guard = m.sum(t.guardCounter);
      const evicted = m.sum(t.evictCounter);
      const ck = t.guardCounter;
      const prevGuard = last?.counters?.[ck];
      nextLast.counters[ck] = guard;
      if (bytes > limit) {
        const violated = guard === 0 && evicted === 0;
        const rounds = violated ? prevRounds + 1 : 0;
        nextLast.rounds[name] = rounds;
        if (rounds >= 2) {
          findings.push({ check: name, level: t.level, detail: `${bytes}B 超限（上限 ${limit}B）连续 ${rounds} 轮而 over_limit/evicted 皆零——字节主约束未执法（死键=假门禁形态，查 COLLAB_MAX_RESIDENT_BYTES 与 reaper tick ③）` });
        }
        continue;
      }
      // 上限内分支：over_limit===0∧稳定（0 保持 0/历史值保持——增量连续 2 轮才告）
      if (prevGuard === undefined) { findings.push(insuff(name, '上限内稳定判定需基线')); continue; }
      if (guard < prevGuard) { nextLast.rounds[name] = 0; continue; }   // 进程重启回落——重基线
      const delta = guard - prevGuard;
      if (delta > 0) {
        const rounds = prevRounds + 1;
        nextLast.rounds[name] = rounds;
        if (rounds >= 2) findings.push({ check: name, level: t.level, detail: `上限内（${bytes}B/${limit}B）over_limit 连续 ${rounds} 轮增量 +${delta}——样本间反复超限回摆（字节约束贴限抖动/判据漂移，查 resident 集 bytes 构成）` });
      } else {
        nextLast.rounds[name] = 0;
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
  let last = null;
  if (fs.existsSync(lastPath)) { try { last = JSON.parse(fs.readFileSync(lastPath, 'utf8')); } catch { last = null; } }   // torn write 折 null=视同首跑重基线（throw 则每轮结构性 exit 2 无自愈）

  const base = (env.COLLAB_HEALTH_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const headers = env.PROMETHEUS_TOKEN ? { 'x-prometheus-token': env.PROMETHEUS_TOKEN } : {};
  // Y0c T29-II（C-1）：/api/ready 授权档回退链与 collab-ready.controller.ts:31-32 镜像同源——
  // token=COLLAB_ADMIN_TOKEN ?? PROMETHEUS_TOKEN（生产两 token 均设且异值时 ready 只认 admin token；
  // 错配⇒公开五键档⇒workers 缺失⇒ready-workers-missing 永久 P0 误报）。/metrics 与 3002 两端点
  // 只认 PROMETHEUS_TOKEN——维持 headers 不动。
  const readyToken = env.COLLAB_ADMIN_TOKEN ?? env.PROMETHEUS_TOKEN;
  const readyHeaders = readyToken ? { 'x-prometheus-token': readyToken } : {};
  let metricsOk = false;
  let metrics = null;
  try {
    const r = await fetchImpl(`${base}/metrics`, { headers, signal: AbortSignal.timeout(10_000) });
    if (r.ok) { metrics = parsePromText(await r.text()); metricsOk = true; }
  } catch { /* 折 P1 metrics-unreachable */ }
  let readyOk = false;
  let ready = null;
  try {
    // Y0c T29-II 裁决③：/api/ready 带 token headers（token 授权档才含 workers 维度；公开五键档
    // 无它=R6c P0 侦测面）——C-1 起用 readyHeaders（controller 回退链镜像，见上）
    const r = await fetchImpl(`${base}/api/ready`, { headers: readyHeaders, signal: AbortSignal.timeout(10_000) });
    if (r.ok) { ready = await r.json(); readyOk = true; }
  } catch { /* 折 P1 ready-unreachable */ }

  // Y0c T29-II（Z130③/R6a）：worker 3002 端点（loopback-only⇒本巡检必须服务器本地 crontab——
  // runbook §11；token 同源 PROMETHEUS_TOKEN。COLLAB_HEALTH_SKIP_WORKER=1 ⇒ 跳过=COLLAB_ROLE=all
  // 降级出口，缺省 fail-closed 期望 worker）
  const workerBase = (env.COLLAB_HEALTH_WORKER_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');
  const workerSkipped = env.COLLAB_HEALTH_SKIP_WORKER === '1';
  let workerOk = false;
  let workerMetrics = null;
  if (!workerSkipped) {
    try {
      const r = await fetchImpl(`${workerBase}/metrics`, { headers, signal: AbortSignal.timeout(10_000) });
      if (r.ok) { workerMetrics = parsePromText(await r.text()); workerOk = true; }
    } catch { /* 折 P0 worker-metrics-unreachable */ }
  }

  const { findings, nextLast } = evaluate({ metricsOk, metrics, readyOk, ready, workerOk, workerMetrics, workerSkipped }, last, now, env);
  fs.writeFileSync(lastPath, JSON.stringify(nextLast));

  // SMS：P0 恰 check 一条、per-check 节流（节流窗内复发不重发；新 P0 各发各的）
  let throttle = {};
  if (fs.existsSync(throttlePath)) { try { throttle = JSON.parse(fs.readFileSync(throttlePath, 'utf8')); } catch { throttle = {}; } }
  const smsSent = [];
  for (const f of findings.filter((x) => x.level === 'P0')) {
    if (throttle[f.check] !== undefined && now - throttle[f.check] < SMS_THROTTLE_MS) continue;
    if (!smsSender) continue;
    try {
      await smsSender(f.check, `[P0]${f.check}`.slice(0, 60));   // 模板 {1} 单参——短信正文短键，明细走日志
      throttle[f.check] = now;   // 节流戳=发送成功后写——失败轮不消耗节流窗（下轮重试）
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
