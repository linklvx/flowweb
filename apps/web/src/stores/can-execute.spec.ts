// apps/web/src/stores/can-execute.spec.ts
// Y0b-2 T7：canExecute 一等谓词（spec §2.6③ 裁定 2——只留硬态：自持未确认标记两方向都会漂，
// pendingLocalEdits 不立字段；钱的方向由服务端 SV 支配门权威兜底）。
// canEdit 基础 ∧ connStatus==='connected' ∧ !writeFrozen；writeFrozen 进 canvasStore 默认 false
// （Z55：Y0b-5 接线既定——gateway 下发位登记 T9 残余）。
import { describe, it, expect } from 'vitest';
import { canExecute } from './syncStatus';
import { useCanvasStore } from './canvasStore';
import type { CanvasState } from './canvasStore';

const st = (over: Partial<CanvasState>): CanvasState => ({
  hydration: 'ready',
  collabReadOnly: false,
  wsAuthNotice: null,
  connStatus: 'connected',
  writeFrozen: false,
  ...over,
} as CanvasState);

describe('Y0b-2 T7：canExecute 硬态四档（裁定 2——零自持标记）', () => {
  it('全清（canEdit∧connected∧!writeFrozen）→ true', () => {
    expect(canExecute(st({}))).toBe(true);
  });

  it('canEdit 基础不满足 → false（hydration 未 ready / 只读 / WS 终态三形态）', () => {
    expect(canExecute(st({ hydration: 'pending' }))).toBe(false);
    expect(canExecute(st({ collabReadOnly: true }))).toBe(false);
    expect(canExecute(st({ wsAuthNotice: { reason: 'session-expired', terminal: true } }))).toBe(false);
  });

  it("connStatus!=='connected' → false（connecting/offline——断连禁执行）", () => {
    expect(canExecute(st({ connStatus: 'connecting' }))).toBe(false);
    expect(canExecute(st({ connStatus: 'offline' }))).toBe(false);
  });

  it('writeFrozen → false（冻结禁执行——冻结契约 12）', () => {
    expect(canExecute(st({ writeFrozen: true }))).toBe(false);
  });
});

describe('Y0b-2 T7：store 字段契约（Z55 落位+pendingLocalEdits 拆除断言）', () => {
  it('writeFrozen 进 CanvasState 且默认 false', () => {
    expect(useCanvasStore.getState().writeFrozen).toBe(false);
  });

  it('无 pendingLocalEdits 字段（裁定 2：自持标记两方向都会漂——不立字段）', () => {
    expect('pendingLocalEdits' in useCanvasStore.getState()).toBe(false);
  });
});
