import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectMemberController } from './project-member.controller';
import { ProjectMemberService } from './project-member.service';
import { TeamGuard } from './team.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 接线层测试：TeamGuard 用 reflector.get(TEAM_SOURCE, handler) 读元数据，
 * 只读 handler 级。真实 Reflector + 真实 guard + handler 指向 controller
 * 原型方法——装饰器位置错误（类级）在此处表现为 team 回退，可直接捕获。
 */
function mkCtx(req: any, handler: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => ProjectMemberController,
  } as unknown as ExecutionContext;
}

const HANDLERS = ['list', 'add', 'changeRole', 'remove'] as const;

describe('ProjectMemberController TeamSource 接线', () => {
  let guard: TeamGuard;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
      teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
      team: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    };
    guard = new TeamGuard(new Reflector(), prisma as PrismaService);
  });

  it("4 个 handler 均走 project 解析链：先查 canvasProject 再用 project.teamId 查成员", async () => {
    for (const name of HANDLERS) {
      prisma.canvasProject.findUnique.mockClear();
      prisma.teamMember.findUnique.mockClear();
      const req: any = { params: { id: 'p1' }, user: { id: 'u1' } };

      const handler = ProjectMemberController.prototype[name] as any;
      await expect(guard.canActivate(mkCtx(req, handler))).resolves.toBe(true);

      expect(prisma.canvasProject.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        select: { teamId: true },
      });
      expect(prisma.teamMember.findUnique).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'u1' } },
      });
      expect(req.teamId).toBe('t1');
      expect(req.teamRole).toBe('MEMBER');
    }
  });

  it('handler 委托 service：list 透传 projectId 与 userId', async () => {
    const svc = { list: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new ProjectMemberController(svc as unknown as ProjectMemberService);

    const result = await controller.list('p1', { user: { id: 'u1' } } as any);

    expect(svc.list).toHaveBeenCalledWith('p1', 'u1');
    expect(result).toEqual({ items: [] });
  });
});
