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
    teamMember: { findFirst: vi.fn() },
  });

  it('ACTIVE 团队成员通过（嵌套 team.status 过滤）', async () => {
    const db = makeDb();
    db.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });

    await expect(assertTeamMember(db as any, 't1', 'u1')).resolves.toBeUndefined();

    expect(db.teamMember.findFirst).toHaveBeenCalledWith({
      where: { teamId: 't1', userId: 'u1', team: { status: 'ACTIVE' } },
      select: { role: true },
    });
  });

  it('非成员抛 403 非团队成员', async () => {
    const db = makeDb();
    db.teamMember.findFirst.mockResolvedValue(null);

    await expect(assertTeamMember(db as any, 't1', 'u1')).rejects.toThrow(ForbiddenException);
    await expect(assertTeamMember(db as any, 't1', 'u1')).rejects.toThrow('非团队成员');
  });

  it('DISBANDED 团队成员 → 403（body-teamId 路径无 TeamGuard，须在查询内拦截解散团队）', async () => {
    const db = makeDb();
    // 模拟 DB：where team.status='ACTIVE' 把解散团队的成员行过滤掉 → findFirst 落空。
    // 若实现丢失嵌套过滤（where 无 team.status），mock 会返回成员 → 断言失败（红）。
    db.teamMember.findFirst.mockImplementation(({ where }: any) => {
      if (where.team?.status === 'ACTIVE') return Promise.resolve(null);
      return Promise.resolve({ role: 'MEMBER' });
    });

    await expect(assertTeamMember(db as any, 't1', 'u1')).rejects.toThrow('非团队成员');
  });
});
