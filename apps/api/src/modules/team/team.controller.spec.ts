import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

describe('TeamController.getDefault', () => {
  const mkController = (teamService: Partial<TeamService>) =>
    new TeamController(
      {} as any,
      teamService as TeamService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('委托 ensureDefaultTeam 并返回 {id,name,isDefault:true}', async () => {
    const teamService = { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 't1', name: '张三的团队' }) };
    const controller = mkController(teamService);

    const result = await controller.getDefault({ user: { id: 'u1' } } as any);

    expect(teamService.ensureDefaultTeam).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 't1', name: '张三的团队', isDefault: true });
  });

  it('无 userId 抛 Unauthorized', () => {
    const controller = mkController({ ensureDefaultTeam: vi.fn() });
    expect(() => controller.getDefault({} as any)).toThrow(UnauthorizedException);
  });
});

describe('GET /api/team/plans（成员只读上架套餐）', () => {
  const mkController = (prisma: any) =>
    new TeamController(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);

  it('只查 isActive:true、按 sort 排序、BigInt 转 Number', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'p1', name: '月卡', storageLimitBytes: 107374182400n, isActive: true, sort: 1 },
    ]);
    const c = mkController({ teamPlan: { findMany } });
    const plans = await (c as any).listActivePlans();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { sort: 'asc' } }),
    );
    expect(plans[0].storageLimitBytes).toBe(107374182400); // Number 非 BigInt
    expect(typeof plans[0].storageLimitBytes).toBe('number');
  });
});
