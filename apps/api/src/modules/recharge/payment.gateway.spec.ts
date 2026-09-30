import { describe, it, expect, vi } from 'vitest';
import { WsException } from '@nestjs/websockets';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';
import { PaymentGateway } from './payment.gateway';

function makeClient(userId: string | null) {
  return { data: { userId }, join: vi.fn() } as any;
}

function makeGateway({ subOrder = null, teamOrder = null }: { subOrder?: unknown; teamOrder?: unknown } = {}) {
  const prisma = {
    subscriptionOrder: { findUnique: vi.fn().mockResolvedValue(subOrder) },
    teamRechargeOrder: { findUnique: vi.fn().mockResolvedValue(teamOrder) },
  };
  return { gateway: new PaymentGateway(prisma as any), prisma };
}

describe('PaymentGateway.handleJoinOrder（团队充值订单）', () => {
  it('团队订单付款人可 join 订单房间', async () => {
    const { gateway } = makeGateway({ teamOrder: { payerUserId: 'u1' } });
    const client = makeClient('u1');

    await gateway.handleJoinOrder(client, { orderNo: 'TEAM1' });

    expect(client.join).toHaveBeenCalledWith('order:TEAM1');
  });

  it('非付款人拒绝 join', async () => {
    const { gateway } = makeGateway({ teamOrder: { payerUserId: 'owner' } });
    const client = makeClient('intruder');

    await expect(gateway.handleJoinOrder(client, { orderNo: 'TEAM1' }))
      .rejects.toThrow(WsException);
    expect(client.join).not.toHaveBeenCalled();
  });
});

describe('PaymentGateway × 全局 ThrottlerGuard（批0c 质量修复2 回归锚）', () => {
  it('join:order 在 @SkipThrottle() 豁免下：ThrottlerGuard 对 WS context 不抛 res.header TypeError', async () => {
    // 复刻 app.module APP_GUARD 注册形态（ThrottlerModule.forRoot 同参）
    const guard = new ThrottlerGuard(
      [{ ttl: 60000, limit: 300 }],
      new ThrottlerStorageService(),
      new Reflector(),
    );
    await guard.onModuleInit();

    // Nest WS context：args=[client, data]，switchToHttp().getResponse() → 消息 payload（无 .header 方法）。
    // 未豁免时 throttler handleRequest 无条件 res.header(...)（@nestjs/throttler 6.5.0 throttler.guard.js:135）
    // → TypeError → join:order 每次调用即抛、支付状态推送断链。
    const wsContext = {
      getType: () => 'ws',
      getArgs: () => [{ data: { userId: 'u1' } }, { orderNo: 'TEAM1' }],
      switchToHttp: () => ({
        getRequest: () => ({ handshake: { address: '127.0.0.1' } }),
        getResponse: () => ({ orderNo: 'TEAM1' }),
      }),
      getClass: () => PaymentGateway,
      getHandler: () => PaymentGateway.prototype.handleJoinOrder,
    } as any;

    await expect(guard.canActivate(wsContext)).resolves.toBe(true);
  });
});
