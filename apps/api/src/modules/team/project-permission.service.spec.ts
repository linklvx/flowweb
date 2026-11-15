import { ProjectPermissionService } from './project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('resolveProjectRole（spec 1.2 三级解析链）', () => {
  let svc: ProjectPermissionService;
  const prisma = {
    projectMember: { findUnique: vi.fn() },
    canvasProject: { findUnique: vi.fn() },
    teamMember: { findUnique: vi.fn() },
  };

  beforeEach(() => {
    svc = new ProjectPermissionService(prisma as unknown as PrismaService);
    vi.resetAllMocks();
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1', userId: 'creator1' });
  });

  it('一级：ProjectMember 显式记录优先', async () => {
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'PROJECT_VIEWER' });
    await expect(svc.resolve('p1', 'u1')).resolves.toBe('PROJECT_VIEWER');
  });

  it('二级：项目创建者回退 PROJECT_OWNER（兜底历史数据）', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    await expect(svc.resolve('p1', 'creator1')).resolves.toBe('PROJECT_OWNER');
  });

  it('三级：Team OWNER→PROJECT_OWNER，ADMIN/MEMBER→PROJECT_EDITOR', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    await expect(svc.resolve('p1', 'u2')).resolves.toBe('PROJECT_OWNER');
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(svc.resolve('p1', 'u2')).resolves.toBe('PROJECT_EDITOR');
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    await expect(svc.resolve('p1', 'u2')).resolves.toBe('PROJECT_EDITOR');
  });

  it('非团队成员 → null', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    prisma.teamMember.findUnique.mockResolvedValue(null);
    await expect(svc.resolve('p1', 'u3')).resolves.toBeNull();
  });

  it('项目不存在 → 抛 NotFoundException', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(svc.resolve('p1', 'u1')).rejects.toThrow('项目不存在');
  });

  describe('assertEditor', () => {
    it('非成员（null）→ ForbiddenException', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(null);
      prisma.teamMember.findUnique.mockResolvedValue(null);
      await expect(svc.assertEditor('p1', 'u3')).rejects.toThrow('无项目编辑权限');
    });

    it('PROJECT_VIEWER → ForbiddenException', async () => {
      prisma.projectMember.findUnique.mockResolvedValue({ role: 'PROJECT_VIEWER' });
      await expect(svc.assertEditor('p1', 'u1')).rejects.toThrow('无项目编辑权限');
    });

    it('PROJECT_EDITOR → 放行并返回 role', async () => {
      prisma.projectMember.findUnique.mockResolvedValue({ role: 'PROJECT_EDITOR' });
      await expect(svc.assertEditor('p1', 'u1')).resolves.toBe('PROJECT_EDITOR');
    });
  });
});

describe('TD-33 C1b T14：lifecycleStateOf 行删回退（erasure run→DELETING）', () => {
  const mk = (rows: unknown[], run: unknown) => {
    const p = {
      $queryRaw: vi.fn(async () => rows),
      projectErasureRun: { findFirst: vi.fn(async () => run) },
    };
    return { p, s: new ProjectPermissionService(p as unknown as PrismaService) };
  };

  it('行在→返回列值（原语义）', async () => {
    const { p, s } = mk([{ lifecycleState: 'DELETING' }], null);
    await expect(s.lifecycleStateOf('p1')).resolves.toBe('DELETING');
    expect(p.projectErasureRun.findFirst).not.toHaveBeenCalled();
  });

  it('行已删∧run（project∧dryRun=false）存在→DELETING（重连走 4414 而非 404）', async () => {
    const { p, s } = mk([], { erasureId: 'e1' });
    await expect(s.lifecycleStateOf('p1')).resolves.toBe('DELETING');
    expect(p.projectErasureRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeType: 'project', scopeId: 'p1', dryRun: false },
    }));
  });

  it('行已删∧无 run→null（真缺失→404 档）', async () => {
    const { s } = mk([], null);
    await expect(s.lifecycleStateOf('p1')).resolves.toBeNull();
  });
});
