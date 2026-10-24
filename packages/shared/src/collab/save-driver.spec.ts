// packages/shared/src/collab/save-driver.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §4.2/§3.4）：saved 四态驱动契约的契约测试
// ——clientSeq+sessionEpoch 判 Durable（回执按同 session 比较=reducer 双门执法）；断线/重连不改
// 保存态（「不因连接/SyncStatus 显示」负控）。先红→绿（Minor#8 sessionEpoch 消费红先行）。
import { describe, expect, it } from 'vitest';
import { SAVE_BARRIER_BACKOFF_STEPS_MS, BarrierRequest } from './doc-protocol';
import {
  SaveDriverState, SaveDriverEvent, reduceSaveDriver, saveDriverUiState, nextBarrierBackoffMs,
  SAVE_DRIVER_NEGATIVE_CONTROL,
} from './save-driver';

const initial = (): SaveDriverState => ({
  lastLocalEditSeq: 0,
  sessionEpoch: 1,
  syncPhase: 'applied',
  lastReceipt: null,
  inFlightBarrier: null,
  backoffStep: 0,
});

const barrier = (nonce: string, clientSeq: number, sessionEpoch = 1): BarrierRequest => ({
  nonce, clientSeq, tabId: 'tab-1', sessionEpoch,
});

describe('Y1c T5c 契约冻结：本地编辑→Local（脏态推进）', () => {
  it('local-edit 自增 clientSeq（lastLocalEditSeq）+syncPhase 回 local', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'local-edit' });
    expect(s.lastLocalEditSeq).toBe(1);
    expect(s.syncPhase).toBe('local');
    s = reduceSaveDriver(s, { type: 'local-edit' });
    expect(s.lastLocalEditSeq).toBe(2);
    expect(saveDriverUiState(s)).toBe('local');   // 旧回执失效——新编辑使 Durable 回退
  });
  it('sync-phase 事件承载客户端观测面（local/spooled/applied——SyncStatus(true)=applied）', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'sync-phase', phase: 'spooled' });
    expect(s.syncPhase).toBe('spooled');
    s = reduceSaveDriver(s, { type: 'sync-phase', phase: 'applied' });
    expect(s.syncPhase).toBe('applied');
  });
});

describe('Y1c T5c 契约冻结：barrier 回执→按 committedSeq/clientSeq 映射（Durable 唯一路径）', () => {
  it('回执覆盖 clientSeq（receipt.clientSeq>=lastLocalEditSeq）→Durable——唯一 Durable 路径', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'local-edit' });               // seq=1
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('n1', 1) });
    s = reduceSaveDriver(s, { type: 'sync-phase', phase: 'applied' });
    expect(saveDriverUiState(s)).toBe('applied');                  // 回执未到≠Durable
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'n1', clientSeq: 1, committedSeq: '42' }, sessionEpoch: 1 });
    expect(s.lastReceipt).toEqual({ nonce: 'n1', clientSeq: 1, committedSeq: '42' });
    expect(s.inFlightBarrier).toBeNull();                          // 回执消解在飞 barrier
    expect(s.backoffStep).toBe(0);
    expect(saveDriverUiState(s)).toBe('durable');
  });
  it('回执落后于新编辑（receipt.clientSeq<lastLocalEditSeq）→UI 回退到 syncPhase（不显示 Durable）', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'local-edit' });               // seq=1
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('n1', 1) });
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'n1', clientSeq: 1, committedSeq: '42' }, sessionEpoch: 1 });
    expect(saveDriverUiState(s)).toBe('durable');
    s = reduceSaveDriver(s, { type: 'local-edit' });               // seq=2——旧回执失效
    expect(saveDriverUiState(s)).toBe('local');
  });
  it('nonce 不匹配的回执=陈旧回执（断线新 nonce 后旧回执到达）——整体忽略零状态变化', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('n-new', 5) });
    const before = { ...s };
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'n-old', clientSeq: 4, committedSeq: '41' }, sessionEpoch: 1 });
    expect(s).toEqual(before);   // 陈旧回执不落 lastReceipt 不消解在飞
  });
  it('错误回执（BARRIER_FAILED/maintenance）永不产生 Durable——lastReceipt 不更新+退避步进', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'local-edit' });
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('n1', 1) });
    s = reduceSaveDriver(s, { type: 'barrier-error', receipt: { nonce: 'n1', error: 'BARRIER_FAILED', committedSeq: '40' }, sessionEpoch: 1 });
    expect(s.lastReceipt).toBeNull();                              // 错误回执≠持久化回执
    expect(s.inFlightBarrier).toBeNull();
    expect(s.backoffStep).toBe(1);
    expect(saveDriverUiState(s)).not.toBe('durable');
    // maintenance 档同型（freeze 期回 maintenance 档不产生 Durable——§4.2）
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('n2', 1) });
    s = reduceSaveDriver(s, { type: 'barrier-error', receipt: { nonce: 'n2', error: 'maintenance', committedSeq: '40' }, sessionEpoch: 1 });
    expect(s.backoffStep).toBe(2);
    expect(s.lastReceipt).toBeNull();
  });
});

describe('Y1c T5c 契约冻结：失败退避（复用 T5a SAVE_BARRIER_BACKOFF_STEPS_MS 单源）', () => {
  it('退避步进走 T5a 表 1s/2s/5s/10s 封顶；成功回执归零', () => {
    let s = initial();
    for (let i = 0; i < 6; i++) {
      s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier(`n${i}`, s.lastLocalEditSeq) });
      s = reduceSaveDriver(s, { type: 'barrier-error', receipt: { nonce: `n${i}`, error: 'BARRIER_FAILED', committedSeq: '0' }, sessionEpoch: 1 });
    }
    expect(s.backoffStep).toBe(SAVE_BARRIER_BACKOFF_STEPS_MS.length - 1);
    expect(nextBarrierBackoffMs(s)).toBe(SAVE_BARRIER_BACKOFF_STEPS_MS[SAVE_BARRIER_BACKOFF_STEPS_MS.length - 1]);
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('ok', 0) });
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'ok', clientSeq: 0, committedSeq: '99' }, sessionEpoch: 1 });
    expect(s.backoffStep).toBe(0);
    expect(nextBarrierBackoffMs(s)).toBe(SAVE_BARRIER_BACKOFF_STEPS_MS[0]);
  });
});

describe('Y1c T5c 契约冻结：断线/重连不改保存态（负控——「不因连接/SyncStatus 显示」）', () => {
  it('connection 事件=恒等转移（online/offline 双向均原样返回——Durable 只由回执判）', () => {
    let s = initial();
    s = reduceSaveDriver(s, { type: 'local-edit' });
    s = reduceSaveDriver(s, { type: 'barrier-sent', request: barrier('n1', 1) });
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'n1', clientSeq: 1, committedSeq: '42' }, sessionEpoch: 1 });
    const durableState = { ...s };
    expect(saveDriverUiState(s)).toBe('durable');
    for (const online of [false, true, false]) {
      s = reduceSaveDriver(s, { type: 'connection', online });
      expect(s).toEqual(durableState);        // 断线/重连零状态变化——Durable 不因连接消失
      expect(saveDriverUiState(s)).toBe('durable');
    }
  });
  it('负控注记冻结：保存态不因 WebSocket 连接或 SyncStatus 显示（Durable=可验证 pgSeq 回执）', () => {
    expect(SAVE_DRIVER_NEGATIVE_CONTROL.connection).toContain('不因连接');
    expect(SAVE_DRIVER_NEGATIVE_CONTROL.syncStatus).toContain('SyncStatus');
    expect(SAVE_DRIVER_NEGATIVE_CONTROL.durableOnlyVia).toContain('回执');
  });
  it('sessionEpoch 冻结在状态内（clientSeq reload 后重置——回执按同 session 比较的载体）', () => {
    const s = initial();
    expect(s.sessionEpoch).toBe(1);
    const ev: SaveDriverEvent = { type: 'connection', online: true };
    expect(reduceSaveDriver(s, ev).sessionEpoch).toBe(1);   // 连接事件不碰 sessionEpoch
  });
});

describe('Y1c T5c 评审收口 Minor#8：sessionEpoch 消费（§4.2 回执按同 session 比较——reducer 执法）', () => {
  it('旧 session 回执整体忽略（reload 后旧连接迟到回执 nonce 未换禁误判 Durable）——零状态变化；再同 session 正确回执→Durable', () => {
    // 场景：reload 后新纪元 state（sessionEpoch=2——nonce 未换的旧连接回执迟到）
    let s: SaveDriverState = {
      ...initial(), sessionEpoch: 2, lastLocalEditSeq: 1, syncPhase: 'applied',
      inFlightBarrier: barrier('n1', 1, 2),
    };
    const before = { ...s };
    // 旧 session 回执（sessionEpoch 1≠2）——整体忽略（与陈旧 nonce 同款处理）
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'n1', clientSeq: 1, committedSeq: '42' }, sessionEpoch: 1 });
    expect(s).toEqual(before);                       // 零状态变化：不落 lastReceipt/不消解 inFlight/退避不动
    expect(saveDriverUiState(s)).not.toBe('durable'); // 旧 session 回执禁产生 Durable
    // 同 session 正确回执（sessionEpoch 2）——Durable 唯一路径恢复成立
    s = reduceSaveDriver(s, { type: 'barrier-receipt', receipt: { nonce: 'n1', clientSeq: 1, committedSeq: '42' }, sessionEpoch: 2 });
    expect(s.lastReceipt).toEqual({ nonce: 'n1', clientSeq: 1, committedSeq: '42' });
    expect(s.inFlightBarrier).toBeNull();
    expect(saveDriverUiState(s)).toBe('durable');
  });
  it('barrier-error 同款：旧 session 错误回执不步进退避；同 session 正常步进', () => {
    let s: SaveDriverState = { ...initial(), sessionEpoch: 2, inFlightBarrier: barrier('n1', 1, 2) };
    const before = { ...s };
    s = reduceSaveDriver(s, { type: 'barrier-error', receipt: { nonce: 'n1', error: 'BARRIER_FAILED', committedSeq: '40' }, sessionEpoch: 1 });
    expect(s).toEqual(before);                       // 旧 session 错误回执——零状态变化（不步进退避不清 inFlight）
    s = reduceSaveDriver(s, { type: 'barrier-error', receipt: { nonce: 'n1', error: 'BARRIER_FAILED', committedSeq: '40' }, sessionEpoch: 2 });
    expect(s.backoffStep).toBe(1);                   // 同 session——正常退避步进
    expect(s.inFlightBarrier).toBeNull();
  });
});
