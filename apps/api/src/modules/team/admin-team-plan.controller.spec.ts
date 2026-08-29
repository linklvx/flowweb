import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminTeamPlanController } from './admin-team-plan.controller';
import { PrismaService } from '../../prisma/prisma.service';

// 回归：TeamPlan.storageLimitBytes 为 BigInt，直接返回行经 Express JSON.stringify
// 抛 "Do not know how to serialize a BigInt" → GET /api/admin/team-plans 500（TeamBillingPage 套餐区空白根因）
describe('AdminTeamPlanController', () => {
  let controller: AdminTeamPlanController;
  let prisma: {
    teamPlan: {
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      teamPlan: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', name: '基础版', monthlyCredits: 300, seatLimit: 5, priceMonthly: 9900, storageLimitBytes: BigInt(6 * 1024 ** 3), isActive: true, sort: 1 },
        ]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    controller = new AdminTeamPlanController(prisma as unknown as PrismaService);
  });

  it('list 返回可 JSON 序列化的行（storageLimitBytes 转 Number 非 BigInt）', async () => {
    const rows = await controller.list();
    expect(rows[0].storageLimitBytes).toBe(6 * 1024 ** 3);
    expect(typeof rows[0].storageLimitBytes).toBe('number');
    // JSON 序列化不再抛错（回归 500 根因）
    expect(() => JSON.stringify(rows)).not.toThrow();
  });

  it('create 返回行 storageLimitBytes 转 Number，入参仍转 BigInt 存库', async () => {
    prisma.teamPlan.create.mockResolvedValue({ id: 'p2', name: '专业版', monthlyCredits: 1000, seatLimit: 20, priceMonthly: 29900, storageLimitBytes: BigInt(20 * 1024 ** 3), isActive: true, sort: 2 });
    const row = await controller.create({ name: '专业版', monthlyCredits: 1000, storageLimitBytes: 20 * 1024 ** 3, seatLimit: 20, priceMonthly: 29900 });
    expect(prisma.teamPlan.create).toHaveBeenCalledWith({ data: { name: '专业版', monthlyCredits: 1000, storageLimitBytes: BigInt(20 * 1024 ** 3), seatLimit: 20, priceMonthly: 29900 } });
    expect(row.storageLimitBytes).toBe(20 * 1024 ** 3);
    expect(typeof row.storageLimitBytes).toBe('number');
    expect(() => JSON.stringify(row)).not.toThrow();
  });

  it('update 返回行 storageLimitBytes 转 Number（body 未带存储字段时同样安全）', async () => {
    prisma.teamPlan.update.mockResolvedValue({ id: 'p1', name: '基础版改', monthlyCredits: 500, seatLimit: 5, priceMonthly: 9900, storageLimitBytes: BigInt(6 * 1024 ** 3), isActive: true, sort: 1 });
    const row = await controller.update('p1', { name: '基础版改' });
    expect(row.storageLimitBytes).toBe(6 * 1024 ** 3);
    expect(typeof row.storageLimitBytes).toBe('number');
    expect(() => JSON.stringify(row)).not.toThrow();
  });
});
