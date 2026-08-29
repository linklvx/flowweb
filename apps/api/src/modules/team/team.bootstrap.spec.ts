import { describe, it, expect, vi } from 'vitest';
import { bootstrapPersonalTeam } from './team.bootstrap';

type Tx = Record<string, any>;

function makeDb(overrides: Partial<Tx> = {}): Tx {
  const db = {
    team: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 't1', name: 'Alice的团队', ownerId: 'u1', isDefault: true }),
    },
    teamMember: { create: vi.fn().mockResolvedValue({}) },
    teamBalance: { create: vi.fn().mockResolvedValue({}) },
    teamCreditTransaction: { create: vi.fn().mockResolvedValue({}) },
    materialFolder: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
    $transaction: vi.fn(async (fn: (tx: Tx) => Promise<any>) => fn(db)),
    ...overrides,
  } as unknown as Tx;
  return db;
}

describe('bootstrapPersonalTeam', () => {
  it('已存在 isDefault 团队时直接返回，不重建', async () => {
    const existing = { id: 't0', ownerId: 'u1', isDefault: true };
    const db = makeDb({ team: { findFirst: vi.fn().mockResolvedValue(existing) } as any });
    const team = await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(team).toBe(existing);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('判据为 ownerId+isDefault，与成员身份无关', async () => {
    const db = makeDb();
    await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(db.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true } });
  });

  it('事务内创建 Team(isDefault)+OWNER+Balance(100)+流水+默认素材文件夹', async () => {
    const db = makeDb();
    await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(db.team.create).toHaveBeenCalledWith({
      data: { name: 'Alice的团队', ownerId: 'u1', status: 'ACTIVE', isDefault: true },
    });
    expect(db.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 't1', userId: 'u1', role: 'OWNER' },
    });
    expect(db.teamBalance.create).toHaveBeenCalledWith({ data: { teamId: 't1', credits: 100 } });
    expect(db.teamCreditTransaction.create).toHaveBeenCalledWith({
      data: { teamId: 't1', operatorUserId: 'u1', amount: 100, type: 'register_grant', creditType: 'regular', balanceAfter: 100 },
    });
    expect(db.materialFolder.createMany).toHaveBeenCalledWith({
      data: ['角色', '场景', '道具', '风格', '音效'].map((name, i) => ({
        name, teamId: 't1', userId: 'u1', isDefault: true, sortOrder: i,
      })),
    });
  });

  it('并发撞唯一索引（P2002）时重查返回既有团队', async () => {
    const existing = { id: 't-old', ownerId: 'u1', isDefault: true };
    const db = makeDb({
      team: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)   // 首查无
          .mockResolvedValueOnce(existing), // 冲突后重查
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      } as any,
    });
    const team = await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(team).toBe(existing);
  });
});
