import { getHeapStatistics } from 'node:v8';
import type { CollabRole } from '../../config/env';

/** Y0b-3 T4（spec §3.2）：heap 压力谓词——单源 util，禁第二套。
 *  两项各管一种死法互不重叠：heapUsed/heap_size_limit 管 GC 螺旋（纯 V8 口径）；
 *  rss/TRIP_BYTES 管原生内存膨胀（RSS 已含 external/arrayBuffers——再并入 V8 比例=重复计数+量纲错位）。
 *  布尔结构（两量纲各自独立上下阈——RELEASE_BYTES 真正生效）：
 *    tripped  = heapRatio >= TRIP_RATIO(0.8) || rss >= TRIP_BYTES(750MiB)    —— trip 需 2 连续采样
 *    released = heapRatio < RELEASE_RATIO(0.7) && rss < RELEASE_BYTES(600MiB) —— 单次即释放
 *  默认值标定（server-profile F1 实测基线 138.8MB）：release 600MiB=基线×安全倍率 ∧ trip 750MiB=
 *  杀线（max_memory_restart 1G）−缓解预算；单调链 baseline×4 < release < trip 与合并算术式
 *  resident_cap+maxDocBytes+基线 ≤ TRIP[api] ∧ TRIP[role]+200MiB ≤ max_memory_restart[role]
 *  （Z118+Z126③）由 scripts/check-ecosystem.mjs per-role 断言（提取锚=本文件 RSS_TRIP_BYTES/
 *  RSS_RELEASE_BYTES Record 字面量——三键缺一即红，Z142③ fail-closed）。
 *  fail-open：测量抛错→{tripped:false,...}（指标失败不得全站拒连）。
 *  阈值经参数注入（env 读放 gateway 侧包装——util 收纯数值保持可测）。 */
/** Y0c T30（Z84②/§0.6 偏离 41）：TRIP/RELEASE 按 role 分离（per-role 映射——不留旧单值导出）。
 *  api/all 维持 Y0b-3 T4 标定值（750MiB/600MiB）；worker 暂用 api 同值〔待实测校准→T32——
 *  worker 无 heap 闸消费者（gateway 只在 api/all 装配），数值面存在为 check-ecosystem 算术与
 *  T32 重标定；§5.1「worker 480M⇒trip<280M」重标定绑定设计杀线，Z103① 实测前维持 1G 制式下
 *  现值算术自洽（750MiB+200MiB≤1G）〕。 */
export const RSS_TRIP_BYTES: Record<CollabRole, number> = {
  api: 786_432_000, // 750MiB
  all: 786_432_000,
  worker: 786_432_000, // 〔待实测校准→T32〕
};
export const RSS_RELEASE_BYTES: Record<CollabRole, number> = {
  api: 629_145_600, // 600MiB（§9.15 人工评估线同值）
  all: 629_145_600,
  worker: 629_145_600, // 〔待实测校准→T32〕
};

export interface HeapPressureSample {
  tripped: boolean;
  /** max(heapRatio, rss/TRIP_BYTES)——两量纲归一观测口径 */
  ratio: number;
  /** 独立暴露（debug 口径） */
  heapRatio: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
}

export interface HeapPressureOptions {
  tripBytes?: number;
  releaseBytes?: number;
  tripRatio?: number;
}

type HeapMeasure = () => { heapUsed: number; heapLimit: number; rss: number };
let measureFn: HeapMeasure = () => {
  const heap = getHeapStatistics();
  return { heapUsed: heap.used_heap_size, heapLimit: heap.heap_size_limit, rss: process.memoryUsage().rss };
};

/** 测试注入（仅测试 import——prod 走 process.memoryUsage/getHeapStatistics）；null=测量抛错（fail-open 用例）。 */
export function stubHeapMeasure(m: { heapUsed: number; heapLimit: number; rss: number } | null): void {
  measureFn = m
    ? () => m
    : () => { throw new Error('heap measure stubbed to throw'); };
}

/** 迟滞模块态：pendingTrip=第 1 次超阈（2 连续采样判定的中间态）；releaseCallback=tripped→released
 *  翻转时的一次性回调（releaseHook() 取走——gateway 接清 refusalCache+gauge）。 */
let pendingTrip = false;
let trippedState = false;
let releaseCallback: (() => void) | null = null;

export function resetHeapPressure(): void {
  pendingTrip = false;
  trippedState = false;
  releaseCallback = null;
}

export function measureHeapPressure(opts: HeapPressureOptions = {}): HeapPressureSample {
  // 缺省档=api（唯一生产消费者 gateway 只装配于 api|all 且按 role 显式注入——本 fallback 仅
  // 覆盖裸调用面/测试面；util 不读 env 保持纯数值可测）
  const tripBytes = opts.tripBytes ?? RSS_TRIP_BYTES.api;
  const releaseBytes = opts.releaseBytes ?? RSS_RELEASE_BYTES.api;
  const tripRatio = opts.tripRatio ?? 0.8;
  const releaseRatio = tripRatio - 0.1; // 迟滞带 0.1（0.8→0.7）
  try {
    const m = measureFn();
    const heapRatio = m.heapLimit > 0 ? m.heapUsed / m.heapLimit : 0;
    const rssRatio = m.rss / tripBytes;
    if (!trippedState) {
      const overTrip = heapRatio >= tripRatio || m.rss >= tripBytes;
      if (overTrip) {
        if (pendingTrip) { trippedState = true; pendingTrip = false; }
        else pendingTrip = true;
      } else {
        pendingTrip = false;
      }
    } else if (heapRatio < releaseRatio && m.rss < releaseBytes) {
      trippedState = false;
      releaseCallback = () => {};
    }
    return { tripped: trippedState, ratio: Math.max(heapRatio, rssRatio), heapRatio, rssBytes: m.rss, heapUsedBytes: m.heapUsed, heapLimitBytes: m.heapLimit };
  } catch {
    return { tripped: false, ratio: 0, heapRatio: 0, rssBytes: 0, heapUsedBytes: 0, heapLimitBytes: 0 };
  }
}

/** tripped→released 翻转时返回一次性回调（gateway 接 onServingTransition 清 refusalCache）；否则 undefined。 */
export function releaseHook(): (() => void) | undefined {
  const cb = releaseCallback;
  releaseCallback = null;
  return cb ?? undefined;
}
