import { Counter, Gauge, register } from 'prom-client';

export const yjsStoreDrainTotal = new Counter({
  name: 'yjs_store_drain_total',
  help: 'storeDocument drain 结果：noop=空转（readCanvas 无条件触发的空转率观测）/ appended=落库一行',
  labelNames: ['result'],
  registers: [register],
});

export const yjsStoreAppendFailureTotal = new Counter({
  name: 'yjs_store_append_failure_total',
  help: 'store append 失败次数（队列保留待重试，at-least-once）',
  registers: [register],
});

export const yjsStoreCompactFailureTotal = new Counter({
  name: 'yjs_store_compact_failure_total',
  help: 'compaction 失败次数（行已落库，仅一致性问题）',
  registers: [register],
});

export const yjsUnflushedProjects = new Gauge({
  name: 'yjs_unflushed_projects',
  help: 'unflushed 兜底 Map 当前条目数',
  registers: [register],
});

/** 批3-4：canvas_doc 持久化字节量观测——load 播种快照字节（set）+ append 增量累加（inc）的近似累计 */
export const yjsCanvasDocBytes = new Gauge({
  name: 'yjs_canvas_doc_bytes',
  help: 'canvas_doc 持久化字节量（快照 set + 增量 inc 近似；compact 归并后为近似值）',
  labelNames: ['projectId'],
  registers: [register],
});

/** 批3-4：session sweep 关闭计数（cause=revoked 复验确认 / db-fail 连续复验异常兜底关） */
export const collabSweepCloseTotal = new Counter({
  name: 'collab_sweep_close_total',
  help: 'session sweep close(4401) 次数（灰度 COLLAB_SWEEP_ENABLED 开启后有效）',
  labelNames: ['cause'],
  registers: [register],
});
