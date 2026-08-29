import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { getOwnerTeamId } from './team.util';

describe('getOwnerTeamId', () => {
  const makeDb = () => ({
    team: { findFirst: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  });

  it('无 userId 抛未登录', async () => {
    await expect(getOwnerTeamId(makeDb() as any, null)).rejects.toThrow(BadRequestException);
  });

  it('属主团队优先：按 ownerId 解析（既有行为不变）', async () => {
    const db = makeDb();
    db.team.findFirst.mockResolvedValue({ id: 't-owned' });

    const teamId = await getOwnerTeamId(db as any, 'u1');

    expect(db.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1' }, select: { id: true } });
    expect(db.teamMember.findFirst).not.toHaveBeenCalled();
    expect(teamId).toBe('t-owned');
  });

  it('无属主有成员（转让后降级用户）——返回成员团队不抛', async () => {
    const db = makeDb();
    db.team.findFirst.mockResolvedValue(null);
    db.teamMember.findFirst.mockResolvedValue({ teamId: 't-member' });

    const teamId = await getOwnerTeamId(db as any, 'u1');

    expect(db.teamMember.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { joinedAt: 'asc' },
      select: { teamId: true },
    });
    expect(teamId).toBe('t-member');
  });

  it('两者皆无：抛"用户暂无团队"（既有行为不变）', async () => {
    const db = makeDb();
    db.team.findFirst.mockResolvedValue(null);
    db.teamMember.findFirst.mockResolvedValue(null);

    await expect(getOwnerTeamId(db as any, 'u1')).rejects.toThrow('用户暂无团队');
  });
});
