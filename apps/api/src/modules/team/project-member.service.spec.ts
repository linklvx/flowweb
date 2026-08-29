import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectMemberService } from './project-member.service';

describe('ProjectMemberService', () => {
  let svc: ProjectMemberService;
  let prisma: any;
  const permSvc = { resolve: vi.fn(), assertEditor: vi.fn() };
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(() => {
    permSvc.resolve.mockReset();
    permSvc.assertEditor.mockReset();
    audit.log.mockReset();
    audit.logTx.mockReset();
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: '操作者' }) },
      canvasProject: { findUnique: vi.fn() },
      team: { findUnique: vi.fn().mockResolvedValue({ isDefault: false }) },
      teamMember: { findUnique: vi.fn(), findMany: vi.fn() },
      projectMember: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
    };
    svc = new ProjectMemberService(prisma, permSvc as any, audit as any);
  });

  it('list：显式记录 + 全团队成员有效角色推导（继承标注）', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1', userId: 'creator1' });
    prisma.teamMember.findMany.mockResolvedValue([
      { userId: 'creator1', user: { id: 'creator1', name: 'c', email: 'c@x' }, role: 'MEMBER' },
      { userId: 'u2', user: { id: 'u2', name: 'b', email: 'b@x' }, role: 'MEMBER' },
    ]);
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'u2', role: 'PROJECT_VIEWER' }]);
    const { items } = await svc.list('p1', 'creator1');
    expect(items.find((i: any) => i.userId === 'creator1')).toMatchObject({ effectiveRole: 'PROJECT_OWNER', source: 'inherited' });
    expect(items.find((i: any) => i.userId === 'u2')).toMatchObject({ effectiveRole: 'PROJECT_VIEWER', source: 'explicit' });
  });

  it('add：非团队成员 400', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1' });
    prisma.teamMember.findUnique.mockResolvedValue(null);
    await expect(svc.add('p1', 'caller1', 'outsider', 'PROJECT_EDITOR')).rejects.toThrow('不是团队成员');
  });

  it('add：设 PROJECT_OWNER 需调用方 PROJECT_OWNER 或 Team OWNER——Team ADMIN 拒绝（防绕过）', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_EDITOR');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1' });
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(svc.add('p1', 'caller1', 'u2', 'PROJECT_OWNER')).rejects.toThrow('仅项目所有者');
  });

  it('add：默认团队（个人项目）画布拒绝添加协作者', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't-default' });
    prisma.team.findUnique.mockResolvedValue({ isDefault: true });
    await expect(svc.add('p1', 'caller1', 'u2', 'PROJECT_EDITOR')).rejects.toThrow('个人项目画布不支持添加协作者');
  });

  it('add：Team ADMIN 可授予 EDITOR + 审计 add_project_member', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1' });
    prisma.teamMember.findUnique.mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ role: 'MEMBER' }); // 第一次=目标成员在团检查，第二次=caller 团队角色
    prisma.projectMember.upsert.mockResolvedValue({});
    await expect(svc.add('p1', 'caller1', 'u2', 'PROJECT_EDITOR')).resolves.toBeTruthy();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: 'caller1', teamId: 't1', targetType: 'PROJECT_MEMBER', targetId: 'u2',
      action: 'add_project_member', afterValue: { role: 'PROJECT_EDITOR' },
    }));
  });

  it('changeRole：审计 change_project_role', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1' });
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    prisma.projectMember.upsert.mockResolvedValue({});
    await svc.changeRole('p1', 'caller1', 'u2', 'PROJECT_VIEWER');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: 'caller1', teamId: 't1', targetType: 'PROJECT_MEMBER', targetId: 'u2',
      action: 'change_project_role', afterValue: { role: 'PROJECT_VIEWER' },
    }));
  });

  it('remove：最后一个显式 PROJECT_OWNER 拒绝', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1' });
    prisma.projectMember.findUnique.mockResolvedValue({ id: 'm1', role: 'PROJECT_OWNER' });
    prisma.projectMember.count.mockResolvedValue(1);
    await expect(svc.remove('p1', 'caller1', 'u2')).rejects.toThrow('最后一个');
  });

  it('remove：非 OWNER 显式记录正常移除 + 审计 remove_project_member', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1' });
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    prisma.projectMember.findUnique.mockResolvedValue({ id: 'm1', role: 'PROJECT_EDITOR' });
    prisma.projectMember.delete.mockResolvedValue({});
    await expect(svc.remove('p1', 'caller1', 'u2')).resolves.toEqual({ ok: true });
    expect(prisma.projectMember.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: 'caller1', teamId: 't1', targetType: 'PROJECT_MEMBER', targetId: 'u2',
      action: 'remove_project_member',
    }));
  });
});
