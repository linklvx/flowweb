// TD-33/C1b T11：FrameRejectError.reason 字段名锁定——frame gate 透传 actor 的拒绝原因
// （旧实现字段名为 frameReason 而 gate 读 e.reason → 恒落 'frame-malformed'，原因面丢失）。
import { describe, it, expect, vi } from 'vitest';
import { CollabFrameGateService } from './collab-frame-gate.service';
import { FrameRejectError } from './collab-project-actor.service';

const gateWith = (submit: () => Promise<void>): CollabFrameGateService => {
  const dr = { activeQuota: { maxTxBytes: 1_048_576, maxDocBytes: 1_048_576 }, admitFrameQuota: vi.fn() };
  const gate = new CollabFrameGateService(dr as never, { submit } as never, undefined);
  gate.bindHost({ logger: { error: vi.fn(), warn: vi.fn(), log: vi.fn() } as never, hardClose: vi.fn(), consumeBytesBucket: () => true });
  return gate;
};

describe('TD-33 T11：FrameRejectError.reason', () => {
  it('字段即 reason（无 getter 垫片）', () => {
    const e = new FrameRejectError(4411, 'l2:poison');
    expect(e.reason).toBe('l2:poison');
    expect(e.code).toBe(4411);
    expect(JSON.stringify({ ...e })).toContain('"reason":"l2:poison"');   // 序列化直带（getter 形态不带出）
  });

  it('frame gate 透传 actor 拒绝码+reason（旧实现 reason 恒 frame-malformed=红）', async () => {
    const gate = gateWith(async () => { throw new FrameRejectError(4411, 'l2:poison'); });
    await expect(gate.guardSyncFrame({
      type: 2, payload: new Uint8Array([1, 2, 3]), document: { name: 'project:p1' }, connection: {},
    } as never)).rejects.toMatchObject({ code: 4411, reason: 'l2:poison' });
  });
});
