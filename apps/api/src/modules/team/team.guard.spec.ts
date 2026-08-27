import { TeamGuard } from './team.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';

function mkCtx(handlerReq: any, handler?: any): ExecutionContext {
  const req = handlerReq as any;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler ?? (() => {}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('TeamGuard', () => {
  let guard: TeamGuard;
  let prisma: any;
  let reflector: any;

  beforeEach(() => {
    prisma = {
      teamMember: { findUnique: vi.fn() },
      team: { findUnique: vi.fn() },
      canvasProject: { findUnique: vi.fn() },
    };
    reflector = { get: vi.fn().mockReturnValue(undefined) };
    guard = new TeamGuard(reflector, prisma);
  });

  it('团队成员：注入 req.teamRole/teamId 放行', async () => {
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.team.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    const req: any = { params: { id: 't1' }, user: { id: 'u1' } };

    await expect(guard.canActivate(mkCtx(req))).resolves.toBe(true);
    expect(req.teamRole).toBe('ADMIN');
    expect(req.teamId).toBe('t1');
    expect(prisma.teamMember.findUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 't1', userId: 'u1' } },
    });
  });

  it('非成员 403', async () => {
    prisma.teamMember.findUnique.mockResolvedValue(null);
    const req: any = { params: { id: 't1' }, user: { id: 'u1' } };
    await expect(guard.canActivate(mkCtx(req))).rejects.toThrow('非团队成员');
  });

  it('DISBANDED 403', async () => {
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.team.findUnique.mockResolvedValue({ status: 'DISBANDED' });
    const req: any = { params: { id: 't1' }, user: { id: 'u1' } };
    await expect(guard.canActivate(mkCtx(req))).rejects.toThrow('团队已解散');
  });

  it('未登录 403', async () => {
    const req: any = { params: { id: 't1' }, user: undefined };
    await expect(guard.canActivate(mkCtx(req))).rejects.toThrow();
  });

  it("project source：:id 是 projectId，查 project.teamId 后校验成员", async () => {
    reflector.get.mockImplementation((key: string) => (key === 'team:id-source' ? 'project' : undefined));
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't9' });
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.team.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    const req: any = { params: { id: 'p1' }, user: { id: 'u1' } };

    await expect(guard.canActivate(mkCtx(req))).resolves.toBe(true);
    expect(req.teamId).toBe('t9');
    expect(req.teamRole).toBe('MEMBER');
  });
});
