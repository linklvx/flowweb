import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { getOwnerTeamId, assertTeamMember } from './team.util';

describe('getOwnerTeamId', () => {
  const makeDb = () => ({
    team: { findFirst: vi.fn() },
  });

  it('无 userId 抛未登录', async () => {
    await expect(getOwnerTeamId(makeDb() as any, null)).rejects.toThrow(BadRequestException);
  });

  it('判据为 ownerId+isDefault，命中返回团队 id', async () => {
    const db = makeDb();
    db.team.findFirst.mockResolvedValue({ id: 't-owned' });

    const teamId = await getOwnerTeamId(db as any, 'u1');

    expect(db.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true }, select: { id: true } });
    expect(teamId).toBe('t-owned');
  });

  it('无个人团队时抛"用户暂无个人团队"（不兜底成员团队）', async () => {
    const db = makeDb();
    db.team.findFirst.mockResolvedValue(null);

    await expect(getOwnerTeamId(db as any, 'u1')).rejects.toThrow('用户暂无个人团队');
  });
});

describe('assertTeamMember', () => {
  const makeDb = () => ({
    teamMember: { findUnique: vi.fn() },
  });

  it('成员通过（按 teamId_userId 查询）', async () => {
    const db = makeDb();
    db.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });

    await expect(assertTeamMember(db as any, 't1', 'u1')).resolves.toBeUndefined();

    expect(db.teamMember.findUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 't1', userId: 'u1' } },
      select: { role: true },
    });
  });

  it('非成员抛 403 非团队成员', async () => {
    const db = makeDb();
    db.teamMember.findUnique.mockResolvedValue(null);

    await expect(assertTeamMember(db as any, 't1', 'u1')).rejects.toThrow(ForbiddenException);
    await expect(assertTeamMember(db as any, 't1', 'u1')).rejects.toThrow('非团队成员');
  });
});
