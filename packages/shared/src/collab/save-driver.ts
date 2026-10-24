// packages/shared/src/collab/save-driver.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §4.2/§3.4）：saved 四态驱动契约。
// **CONTRACT-FREEZE**——纯转移函数；消费方=T10 web 保存驱动/恢复 UI。复用纪律：UI 四态映射=
// T5a resolveSaveUiState 单源（Durable 判据=resp.clientSeq>=lastLocalEditSeq && resp.committedSeq——
// 本模块只驱动状态不另立判据）；退避表=SAVE_BARRIER_BACKOFF_STEPS_MS 单源 import。
// 契约测试=save-driver.spec.ts（TDD 红先行）。
import type { BarrierRequest, BarrierReceipt, BarrierErrorReceipt } from './doc-protocol';
import {
  resolveSaveUiState, SAVE_BARRIER_BACKOFF_STEPS_MS, type SaveUiState,
} from './doc-protocol';

/** 驱动状态（per-tab）：clientSeq 每次**本地编辑**自增（reload 后重置——配 sessionEpoch 按 session
 *  比较）；lastReceipt=最近一次**成功** barrier 回执（错误回执永不落此——不产生 Durable）；
 *  backoffStep=barrier 失败退避步进（成功归零）。 */
export interface SaveDriverState {
  lastLocalEditSeq: number;
  /** 会话纪元（reload 递增——回执按同 session 比较的载体：barrier 请求携带同字段；回执类事件
   *  携带所属 session 纪元，reducer 对 ≠state.sessionEpoch 的回执整体忽略〔§4.2 执法〕） */
  sessionEpoch: number;
  /** 客户端观测同步面：local=有未发送编辑/spooled=已发送未收 SyncStatus(true)/applied=已收 SyncStatus(true) */
  syncPhase: 'local' | 'spooled' | 'applied';
  lastReceipt: BarrierReceipt | null;
  inFlightBarrier: BarrierRequest | null;
  backoffStep: number;
}

/** 驱动事件（转移面全部事件——connection 事件为**恒等转移**负控载体）。回执类事件携带
 *  sessionEpoch（所属会话纪元——调用方按回执抵达的连接会话注入；BarrierRequest 同字段语义；
 *  §4.2「回执按同 session 比较」的执法输入面）。 */
export type SaveDriverEvent =
  | { type: 'local-edit' }                                       // 本地编辑→clientSeq 自增+回 local
  | { type: 'sync-phase'; phase: 'local' | 'spooled' | 'applied' }  // SyncStatus/发送面观测
  | { type: 'barrier-sent'; request: BarrierRequest }            // barrier 发出（断线新 nonce——调用方）
  | { type: 'barrier-receipt'; receipt: BarrierReceipt; sessionEpoch: number }   // 成功回执（同 session+nonce 匹配才落）
  | { type: 'barrier-error'; receipt: BarrierErrorReceipt; sessionEpoch: number }   // 错误回执（同 session+nonce 匹配才步进退避）
  | { type: 'connection'; online: boolean };                     // 断线/重连——恒等转移（负控）

/** 纯转移函数（reduce）：
 *  - local-edit：lastLocalEditSeq+1、syncPhase='local'（旧回执失效由 resolveSaveUiState 判据自然回退）；
 *  - barrier-receipt：**先按 sessionEpoch 同 session 比较**（event.sessionEpoch≠state.sessionEpoch=
 *    旧 session 迟到回执——reload 后 clientSeq 重置，旧连接回执即使 nonce 未换也禁误判 Durable〔§4.2〕
 *    ——整体忽略与陈旧 nonce 同款）；再 nonce 匹配 inFlightBarrier 才生效——落 lastReceipt、清
 *    inFlight、退避归零；nonce 不匹配=陈旧回执（断线新 nonce 后旧回执迟到）整体忽略；
 *  - barrier-error：sessionEpoch/nonce 同款双门——旧 session 整体忽略；匹配才生效——退避步进
 *    （封顶表尾）、清 inFlight、**lastReceipt 不动**（BARRIER_FAILED/maintenance 档永不产生
 *    Durable——§4.2）；
 *  - connection：**恒等**（断线/重连不改保存态——「不因连接/SyncStatus 显示」负控断言面）。 */
export function reduceSaveDriver(state: SaveDriverState, event: SaveDriverEvent): SaveDriverState {
  switch (event.type) {
    case 'local-edit':
      return { ...state, lastLocalEditSeq: state.lastLocalEditSeq + 1, syncPhase: 'local' };
    case 'sync-phase':
      return { ...state, syncPhase: event.phase };
    case 'barrier-sent':
      return { ...state, inFlightBarrier: event.request };
    case 'barrier-receipt':
      if (event.sessionEpoch !== state.sessionEpoch) {
        return state;   // 旧 session 迟到回执——整体忽略（§4.2 回执按同 session 比较；与陈旧 nonce 同款）
      }
      if (state.inFlightBarrier != null && event.receipt.nonce !== state.inFlightBarrier.nonce) {
        return state;   // 陈旧回执——零状态变化
      }
      return { ...state, lastReceipt: event.receipt, inFlightBarrier: null, backoffStep: 0 };
    case 'barrier-error':
      if (event.sessionEpoch !== state.sessionEpoch) {
        return state;   // 旧 session 错误回执——整体忽略（同款双门）
      }
      if (state.inFlightBarrier != null && event.receipt.nonce !== state.inFlightBarrier.nonce) {
        return state;
      }
      return {
        ...state,
        inFlightBarrier: null,
        backoffStep: Math.min(state.backoffStep + 1, SAVE_BARRIER_BACKOFF_STEPS_MS.length - 1),
      };
    case 'connection':
      return state;     // 恒等——保存态不因 WebSocket 连接变化（负控）
  }
}

/** UI 四态出口（resolveSaveUiState 单源直通——本模块不另立判据；Durable 唯一路径=回执覆盖
 *  lastLocalEditSeq，不因连接/SyncStatus 显示）。 */
export function saveDriverUiState(state: SaveDriverState): SaveUiState {
  return resolveSaveUiState({
    syncPhase: state.syncPhase,
    lastLocalEditSeq: state.lastLocalEditSeq,
    receipt: state.lastReceipt,
  });
}

/** 下一次 barrier 重试退避毫秒（T5a 表单源——1s/2s/5s/10s 封顶）。 */
export function nextBarrierBackoffMs(state: SaveDriverState): number {
  return SAVE_BARRIER_BACKOFF_STEPS_MS[state.backoffStep];
}

/** 负控注记（§4.2 UI 四态行：「不因 WebSocket 连接或 SyncStatus 自动显示」——connection 事件
 *  恒等转移即本负控的机器化形态；测试断言 durable 态经断线/重连往返不变）。 */
export const SAVE_DRIVER_NEGATIVE_CONTROL = {
  connection: '断线/重连不改保存态——不因连接显示（connection 事件=恒等转移）',
  syncStatus: '不因 SyncStatus 显示（applied≠durable——SyncStatus(true)=applied 档诚实语义）',
  durableOnlyVia: 'Durable 唯一路径=barrier 回执覆盖 clientSeq（receipt.clientSeq>=lastLocalEditSeq && committedSeq）',
  perTab: 'barrier 语义=per-tab（只覆盖本连接此前帧；回执按 sessionEpoch 同 session+nonce 双门消解——断线新 nonce/reload 新 session）',
} as const;
