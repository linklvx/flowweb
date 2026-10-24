// packages/shared/src/testing/y1c-barrier-corpus.ts
// Y1c T5a：save barrier 语料（plan v1.7 Task 5/T5a——spec §4.2 v5.3 钉死算法+v5.4 节流/半链）。
// 纯数据 fixture（确定性 nonce/clientSeq/tabId）——T10 barrier 接线与 web UI 四态用例消费：
//   - 并发双 tab barrier（两 nonce 各自回执——服务端 ≤250ms 节流合并 flushThrough；
//     barrier 语义=per-tab 只覆盖本连接此前帧，两回执 committedSeq 可同值不可互替）
//   - 同 nonce 重试幂等（handler 按 nonce 幂等——重发同请求回执逐字段等值）
//   - maintenance 冻结期拒绝（{ok:false,reason:'maintenance'} 形态——error 回执不产生 Durable）
//   - handler catch 兜底（永不 throw——BARRIER_FAILED 带 committedSeq=当时 pgSeq）
import type { BarrierErrorReceipt, BarrierReceipt, BarrierRequest } from '../collab/doc-protocol';

export interface BarrierCorpus {
  concurrentTabs: { requests: [BarrierRequest, BarrierRequest]; receipts: [BarrierReceipt, BarrierReceipt] };
  nonceRetry: { request: BarrierRequest; receipts: [BarrierReceipt, BarrierReceipt] };
  maintenanceReject: { request: BarrierRequest; receipt: BarrierErrorReceipt };
  barrierFailed: { request: BarrierRequest; receipt: BarrierErrorReceipt };
}

export function buildBarrierCorpus(): BarrierCorpus {
  const tab1: BarrierRequest = { nonce: 'nonce-t1-a1', clientSeq: 7, tabId: 'tab-1', sessionEpoch: 3 };
  const tab2: BarrierRequest = { nonce: 'nonce-t2-b2', clientSeq: 4, tabId: 'tab-2', sessionEpoch: 1 };
  // committedSeq=pgSeq（BigInt 入 wire payload 显式 String()——十进制串）
  return {
    concurrentTabs: {
      requests: [tab1, tab2],
      receipts: [
        { nonce: tab1.nonce, clientSeq: 7, committedSeq: '42' },
        { nonce: tab2.nonce, clientSeq: 4, committedSeq: '42' },   // 同批 PG 提交——可同值；判 Durable 各按各 tab 的 clientSeq
      ],
    },
    nonceRetry: {
      request: { nonce: 'nonce-retry-c3', clientSeq: 12, tabId: 'tab-1', sessionEpoch: 3 },
      receipts: [
        { nonce: 'nonce-retry-c3', clientSeq: 12, committedSeq: '57' },
        { nonce: 'nonce-retry-c3', clientSeq: 12, committedSeq: '57' },   // 幂等——重试同结果（逐字段等值）
      ],
    },
    maintenanceReject: {
      request: { nonce: 'nonce-maint-d4', clientSeq: 9, tabId: 'tab-2', sessionEpoch: 1 },
      receipt: { nonce: 'nonce-maint-d4', error: 'maintenance', committedSeq: '57' },   // 不产生 Durable
    },
    barrierFailed: {
      request: { nonce: 'nonce-fail-e5', clientSeq: 15, tabId: 'tab-1', sessionEpoch: 3 },
      receipt: { nonce: 'nonce-fail-e5', error: 'BARRIER_FAILED', committedSeq: '57' }, // 永不 throw——catch 后回执
    },
  };
}
