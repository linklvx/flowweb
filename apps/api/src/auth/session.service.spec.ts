import { describe, it, expect, vi } from 'vitest';
import { SessionService } from './session.service';

/** better-auth session 语义锚（auth.ts）：expiresIn=7d / updateAge=1d——touch 与其逐字对齐 */
const DAY = 24 * 3600 * 1000;
const TTL = 7 * DAY;
const UPDATE_AGE = 1 * DAY;

function sessionRow(overrides: { createdAt?: Date; expiresAt?: Date } = {}) {
  return {
    token: 'tok',
    userId: 'u1',
    createdAt: overrides.createdAt ?? new Date(Date.now() - 2 * DAY),   // 默认 age=2d > updateAge
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + TTL),
    user: { id: 'u1', name: '张三' },
  };
}

function buildService(row: any) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn(async (args: any) => ({ ...row, expiresAt: args.data.expiresAt }));
  const service = new SessionService({ session: { findUnique, update } } as any);
  return { service, findUnique, update };
}

describe('SessionService.touch（better-auth 式滑动续期——三处手写 findUnique 的统一收口）', () => {
  it('未过期且 age>updateAge(1d) → update 续期 7d 并返回续期后 session（含 user）', async () => {
    const row = sessionRow();   // createdAt=2d 前
    const { service, update } = buildService(row);
    const out = await service.touch('tok');
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ token: 'tok' });
    expect((arg.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + TTL - 5_000);   // ≈ now+7d
    expect(out!.expiresAt).toEqual(arg.data.expiresAt);
    expect(out!.user.id).toBe('u1');   // include user——guard//me 消费面
  });

  it('未过期且 age<updateAge → 零写（update 不被调），原样返回', async () => {
    const row = sessionRow({ createdAt: new Date(Date.now() - 3_600_000) });   // age=1h
    const { service, update } = buildService(row);
    const out = await service.touch('tok');
    expect(update).not.toHaveBeenCalled();
    expect(out).toBe(row);
  });

  it('过期 → null 且零写（终态禁复活）', async () => {
    const row = sessionRow({ expiresAt: new Date(Date.now() - 1000) });
    const { service, update } = buildService(row);
    await expect(service.touch('tok')).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('token 无效（findUnique null）→ null', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const service = new SessionService({ session: { findUnique, update } } as any);
    await expect(service.touch('bad')).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { token: 'bad' }, include: { user: true } });
    expect(update).not.toHaveBeenCalled();
  });

  describe('touchWithReason（WS 鉴权面：touch 的分型版——批3-1 reason 契约保留）', () => {
    it('token 无效 → { session:null, expired:false }（gateway 折 unauthenticated）', async () => {
      const { service } = buildService(null);
      const r = await service.touchWithReason('tok');
      expect(r).toEqual({ session: null, expired: false });
    });

    it('过期 → { session:null, expired:true }（gateway 折 session-expired）且零写', async () => {
      const row = sessionRow({ expiresAt: new Date(Date.now() - 1000) });
      const { service, update } = buildService(row);
      const r = await service.touchWithReason('tok');
      expect(r).toEqual({ session: null, expired: true });
      expect(update).not.toHaveBeenCalled();
    });

    it('有效且 age>updateAge → 续期 7d 后返回（连接顺带续期）', async () => {
      const row = sessionRow();
      const { service, update } = buildService(row);
      const r = await service.touchWithReason('tok');
      expect(r.expired).toBe(false);
      expect(r.session!.expiresAt).toEqual(update.mock.calls[0][0].data.expiresAt);
    });

    it('有效且 age<updateAge → 零写原样返回', async () => {
      const row = sessionRow({ createdAt: new Date() });
      const { service, update } = buildService(row);
      const r = await service.touchWithReason('tok');
      expect(update).not.toHaveBeenCalled();
      expect(r.session).toBe(row);
    });
  });
});
