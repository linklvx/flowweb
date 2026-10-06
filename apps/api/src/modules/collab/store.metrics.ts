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

/** Y0a-1：compact 健康度唯一真实指标（v2.2 升 P0 告警线）——pendingStructs!=null 放弃本次；
 *  放弃不开窗=下次 store 立即重试（spec v2.4 E23——pendingStructs!=null 是需人工介入的异常态，
 *  活跃编辑期每 debounce 窗一次 ERROR+计数递增正是 P0 线要的最响信号；未编辑 doc 无 store 触发源不空转）。
 *  计数+ERROR 单点落 repo 的 abandoned 分支（gateway 与装载自愈两路覆盖，防双计）。 */
export const yjsCompactAbandonedTotal = new Counter({
  name: 'yjs_compact_abandoned_total',
  help: 'compact 写快照前 pendingStructs!=null 放弃本次的次数（放弃不开窗·下次 store 立即重试；连续命中=P0 人工介入信号）',
  registers: [register],
});

/** Y0a-1：装载单行 >4MB 观测计数（spec §1.4 WARN+计数——硬拒绝归 Y0b 配额批，本批只观测不 DoS 自己） */
export const yjsHydrationHugeRowTotal = new Counter({
  name: 'yjs_hydration_huge_row_total',
  help: 'loadForHydration 读到单行 >4MB 的次数（观测不拒绝；源头治理归 Y0b 配额批）',
  registers: [register],
});
