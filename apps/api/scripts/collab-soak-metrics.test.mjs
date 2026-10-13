// apps/api/scripts/collab-soak-metrics.test.mjs —— T0.5 提取器单测（node:test——仓根 scripts/*.test.mjs 同形态）。
// 覆盖点=plan T0.5 验收锚「提取器对同族多序列的取数正确性——单进程下以多 trigger 序列代验」：
//   同名指标多序列（trigger=ws/direct × role=api/worker）按 role+labels 精确取值；缺序列→null；
//   无 role 旧式行（T0 前形态）禁误匹配（setDefaultLabels 后装置失明回归的防回归锚）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  metricValue, histogramBuckets, sampleProcess, sampleOne, metricsDelta,
  DOC_LOAD_TRIGGERS, STORE_TRIGGERS,
} from './collab-soak-metrics.mjs';

// 合成 prom 文本——同族多序列（api 与 worker 双 role、ws 与 direct 双 trigger 同存；
// 另附一行无 role 旧式行验证禁误匹配）。标签顺序混排（role 在前/在后两形态——prom-client
// defaultLabels 实测输出 role 在声明 labelNames 之后，但提取器禁依赖顺序）。
const TEXT = [
  '# HELP yjs_doc_load_total doc 物化装载计数',
  '# TYPE yjs_doc_load_total counter',
  'yjs_doc_load_total{role="api",trigger="ws"} 3',
  'yjs_doc_load_total{trigger="direct",role="api"} 1',
  'yjs_doc_load_total{role="worker",trigger="ws"} 7',
  'yjs_doc_load_total{trigger="direct",role="worker"} 2',
  'yjs_loaded_documents 99',
  '# HELP process_resident_memory_bytes',
  'process_resident_memory_bytes{role="api"} 204075008',
  'process_resident_memory_bytes{role="worker"} 111111111',
  'yjs_spool_depth_bytes{role="api"} 4096',
  '# TYPE yjs_store_duration_seconds_bucket histogram',
  'yjs_store_duration_seconds_bucket{le="0.005",role="api"} 1',
  'yjs_store_duration_seconds_bucket{le="0.01",role="api"} 2',
  'yjs_store_duration_seconds_bucket{le="+Inf",role="api"} 5',
  'yjs_store_duration_seconds_bucket{le="0.005",role="worker"} 10',
  'yjs_store_duration_seconds_bucket{le="+Inf",role="worker"} 10',
  'yjs_store_duration_seconds_count{role="api"} 5',
  'yjs_store_duration_seconds_sum{role="api"} 0.123',
  'yjs_withdoc_open_duration_seconds_count{role="api"} 4',
  'yjs_withdoc_open_duration_seconds_sum{role="api"} 0.2',
].join('\n');

test('role+labels 精确取值：同族多 trigger 多序列按 role 消歧（api≠worker）', () => {
  assert.equal(metricValue(TEXT, 'yjs_doc_load_total', 'api', { trigger: 'ws' }), 3);
  assert.equal(metricValue(TEXT, 'yjs_doc_load_total', 'api', { trigger: 'direct' }), 1);
  assert.equal(metricValue(TEXT, 'yjs_doc_load_total', 'worker', { trigger: 'ws' }), 7);
  assert.equal(metricValue(TEXT, 'yjs_doc_load_total', 'worker', { trigger: 'direct' }), 2);
  assert.equal(metricValue(TEXT, 'process_resident_memory_bytes', 'api'), 204075008);
  assert.equal(metricValue(TEXT, 'process_resident_memory_bytes', 'worker'), 111111111);
});

test('缺序列→null（trigger 词表外未 inc 的序列 prom 文本无行）；缺 role 参数→null', () => {
  assert.equal(metricValue(TEXT, 'yjs_doc_load_total', 'api', { trigger: 'reconciler' }), null);
  assert.equal(metricValue(TEXT, 'yjs_spool_depth_bytes', 'worker'), null);
});

test('无 role 旧式行禁误匹配（T0 前形态防回归——yjs_loaded_documents 99 不得被 api 视角取到）', () => {
  assert.equal(metricValue(TEXT, 'yjs_loaded_documents', 'api'), null);
});

test('histogramBuckets：按 le 收集且 role 过滤（api 3 桶≠worker 2 桶）', () => {
  const api = histogramBuckets(TEXT, 'yjs_store_duration_seconds_bucket', 'api');
  assert.deepEqual(api, { '0.005': 1, '0.01': 2, '+Inf': 5 });
  const worker = histogramBuckets(TEXT, 'yjs_store_duration_seconds_bucket', 'worker');
  assert.deepEqual(worker, { '0.005': 10, '+Inf': 10 });
  assert.deepEqual(histogramBuckets(TEXT, 'yjs_store_duration_seconds_bucket', 'nobody'), {});
});

test('sampleProcess：装置观测面全集按 role 组装（含 counter 词表遍历+直方图 count/sum）', () => {
  const s = sampleProcess(TEXT, 'api');
  assert.equal(s.rss, 204075008);
  assert.equal(s.docs, null);
  assert.equal(s.spoolBytes, 4096);
  assert.deepEqual(s.docLoad, { ws: 3, direct: 1, reconciler: null });
  assert.deepEqual(Object.keys(s.docLoad), DOC_LOAD_TRIGGERS);
  assert.equal(s.storeTotal.debounce, null);
  assert.deepEqual(Object.keys(s.storeTotal), STORE_TRIGGERS);
  assert.equal(s.withdocOpen.count, 4);
  assert.equal(s.withdocOpen.sum, 0.2);
  assert.equal(s.withdoc.count, null);
  assert.deepEqual(s.buckets, { '0.005': 1, '0.01': 2, '+Inf': 5 });
});

test('sampleOne(url, role)：经真实 HTTP 端点提取（fetch 路径集成+token header 透传）', async () => {
  let seenToken = null;
  const srv = createServer((rq, rs) => {
    seenToken = rq.headers['x-prometheus-token'] ?? null;
    rs.writeHead(200, { 'content-type': 'text/plain' });
    rs.end(TEXT);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/metrics`;
    const s = await sampleOne(url, 'api', { 'x-prometheus-token': 'tok-1' });
    assert.equal(seenToken, 'tok-1');
    assert.equal(s.rss, 204075008);
    assert.equal(s.docLoad.ws, 3);
    const w = await sampleOne(url, 'worker');
    assert.equal(w.rss, 111111111);
    assert.equal(w.docLoad.ws, 7);
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test('metricsDelta：counter 族差值（null→0 序列不存在语义）且 gauge 不进 delta', () => {
  const base = sampleProcess(TEXT, 'api');
  const later = sampleProcess(TEXT.replace('yjs_doc_load_total{role="api",trigger="ws"} 3', 'yjs_doc_load_total{role="api",trigger="ws"} 9'), 'api');
  const d = metricsDelta(base, later);
  assert.equal(d.docLoad.ws, 6);
  assert.equal(d.docLoad.direct, 0);
  assert.equal(d.storeTotal.debounce, 0);
  assert.equal(d.withdocOpen.count, 0);
  assert.equal('rss' in d, false);
  assert.equal('docs' in d, false);
});
