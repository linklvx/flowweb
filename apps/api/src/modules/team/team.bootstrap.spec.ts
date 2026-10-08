import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapPersonalTeam } from './team.bootstrap';

type Tx = Record<string, any>;

// Y0b-1 Z23：钱包建行+register_grant 经 CreditLedgerService（ensureBalance/lockBalance/mutate）
function makeLedger(): Tx {
  return {
    tx: (raw: any) => raw,
    ensureBalance: vi.fn().mockResolvedValue(undefined),
    lockBalance: vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 100 }),
  } as unknown as Tx;
}

function makeDb(overrides: Partial<Tx> = {}): Tx {
  const db = {
    team: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 't1', name: 'Alice的团队', ownerId: 'u1', isDefault: true }),
    },
    teamMember: { create: vi.fn().mockResolvedValue({}) },
    materialFolder: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
    $transaction: vi.fn(async (fn: (tx: Tx) => Promise<any>) => fn(db)),
    ...overrides,
  } as unknown as Tx;
  return db;
}

describe('bootstrapPersonalTeam', () => {
  let ledger: Tx;

  beforeEach(() => {
    ledger = makeLedger();
  });

  it('已存在 isDefault 团队时直接返回，不重建', async () => {
    const existing = { id: 't0', ownerId: 'u1', isDefault: true };
    const db = makeDb({ team: { findFirst: vi.fn().mockResolvedValue(existing) } as any });
    const team = await bootstrapPersonalTeam(db as any, ledger as any, 'u1', 'Alice');
    expect(team).toBe(existing);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('判据为 ownerId+isDefault，与成员身份无关', async () => {
    const db = makeDb();
    await bootstrapPersonalTeam(db as any, ledger as any, 'u1', 'Alice');
    expect(db.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true } });
  });

  it('事务内创建 Team(isDefault)+OWNER+钱包 ensureBalance/lockBalance+register_grant 经 mutate+默认素材文件夹', async () => {
    const db = makeDb();
    await bootstrapPersonalTeam(db as any, ledger as any, 'u1', 'Alice');
    expect(db.team.create).toHaveBeenCalledWith({
      data: { name: 'Alice的团队', ownerId: 'u1', status: 'ACTIVE', isDefault: true },
    });
    expect(db.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 't1', userId: 'u1', role: 'OWNER' },
    });
    // Z23 锁序：ensureBalance（唯一建行口）→ lockBalance → mutate（referenceId=register:<teamId>）
    expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't1');
    expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't1');
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
      teamId: 't1', operatorUserId: 'u1', type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: 'register:t1',
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
    const team = await bootstrapPersonalTeam(db as any, ledger as any, 'u1', 'Alice');
    expect(team).toBe(existing);
  });
});
