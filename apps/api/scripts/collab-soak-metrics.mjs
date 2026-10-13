// apps/api/scripts/collab-soak-metrics.mjs —— Y0c T0.5：soak 装置 metrics 提取器（多进程安全）。
// 背景：T0 起 main.ts 引导层 register.setDefaultLabels({role:'api'})——全族指标文本带 role 标签，
// 原 collab-soak.mjs 的 `^name value$` 首匹配正则全体失配（装置失明实证=T0.5 入口条件贴档）。
// 本模块=纯提取（零顶层副作用，可被 node:test 直 import——collab-soak.mjs 顶层 parseArgs 不可 import）：
//   每行按 role 标签精确匹配+labels 精确消歧——将来双进程（api 3000 与 worker 3002=T29）后
//   同名指标多 role 序列同存时取值确定（禁首匹配猜进程）。
// 词表=store.metrics.ts 声明侧同源（T0 注册）；trigger 词表漂移时两处随改（.mjs 不 import dist——
// collab-smoke CSV 字面量同惯例）。
export const DOC_LOAD_TRIGGERS = ['ws', 'direct', 'reconciler'];
export const STORE_TRIGGERS = ['debounce', 'soft', 'disconnect', 'retry', 'drain'];

/** prom 文本同族全部序列行：[{labels, value}]——sample* 原语的解析底座 */
export function parseMetricSamples(text, name) {
  const out = [];
  const re = new RegExp(`^${name}(?:\\{([^}]*)\\})? ([0-9.eE+-]+)$`, 'gm');
  for (const m of text.matchAll(re)) {
    const labels = {};
    if (m[1]) {
      for (const lm of m[1].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[lm[1]] = lm[2];
    }
    out.push({ labels, value: Number(m[2]) });
  }
  return out;
}

/** 单序列取值：role 必须命中（无 role 行=旧式/T0 前形态——禁误匹配）+labels 全等消歧。
 *  0 行→null（序列不存在——counter 未 inc 或失明）；匹配数恒 ≤1（合法 prom 文本同标签集恰一行）。 */
export function metricValue(text, name, role, labels = {}) {
  const rows = parseMetricSamples(text, name).filter((r) => r.labels.role === role
    && Object.entries(labels).every(([k, v]) => r.labels[k] === v));
  return rows.length ? rows[0].value : null;
}

/** 直方图桶族：{le: 累计值}（name 传全名含 _bucket 后缀；role 过滤+labels 消歧同 metricValue） */
export function histogramBuckets(text, name, role, labels = {}) {
  const out = {};
  for (const r of parseMetricSamples(text, name)) {
    if (r.labels.role !== role || r.labels.le === undefined) continue;
    if (!Object.entries(labels).every(([k, v]) => r.labels[k] === v)) continue;
    out[r.labels.le] = r.value;
  }
  return out;
}

/** 装置观测面全集（soak 压测与三场景共用）：process 族+驻留/spool+store 窗桶+T0 新三件计数与直方图读数 */
export function sampleProcess(text, role) {
  const pick = (name, labels) => metricValue(text, name, role, labels);
  const counterMap = (name, triggers) => Object.fromEntries(triggers.map((t) => [t, pick(name, { trigger: t })]));
  const histPair = (base) => ({ count: pick(`${base}_count`), sum: pick(`${base}_sum`) });
  return {
    rss: pick('process_resident_memory_bytes'),
    heap: pick('nodejs_heap_size_used_bytes'),
    docs: pick('yjs_loaded_documents'),
    spoolBytes: pick('yjs_spool_depth_bytes'),
    buckets: histogramBuckets(text, 'yjs_store_duration_seconds_bucket', role),
    docLoad: counterMap('yjs_doc_load_total', DOC_LOAD_TRIGGERS),
    storeTotal: counterMap('yjs_store_total', STORE_TRIGGERS),
    withdocOpen: histPair('yjs_withdoc_open_duration_seconds'),
    withdoc: histPair('yjs_withdoc_duration_seconds'),
  };
}

/** sampleOne(url, role)——装置唯一取样入口（读取代码路径恒经提取器；双端点读取归 T29）。
 *  headers 透传（PROMETHEUS_TOKEN 面由调用方组装）。 */
export async function sampleOne(url, role, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`/metrics ${res.status}`);
  return sampleProcess(await res.text(), role);
}

/** counter 族窗口差（baseline→final）：null→0（序列不存在=零计数语义）；gauge/buckets 不进 delta。 */
export function metricsDelta(base, final) {
  const d = {};
  for (const group of ['docLoad', 'storeTotal']) {
    d[group] = Object.fromEntries(Object.keys(base[group]).map((k) => [
      k, (final[group][k] ?? 0) - (base[group][k] ?? 0),
    ]));
  }
  d.withdocOpen = { count: (final.withdocOpen.count ?? 0) - (base.withdocOpen.count ?? 0), sum: (final.withdocOpen.sum ?? 0) - (base.withdocOpen.sum ?? 0) };
  d.withdoc = { count: (final.withdoc.count ?? 0) - (base.withdoc.count ?? 0), sum: (final.withdoc.sum ?? 0) - (base.withdoc.sum ?? 0) };
  return d;
}
