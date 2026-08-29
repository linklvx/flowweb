import { describe, it, expect, vi } from 'vitest';
import { WsException } from '@nestjs/websockets';
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
