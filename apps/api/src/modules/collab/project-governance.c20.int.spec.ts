// C2-0（plan Task C2-0——生产就绪收尾批）：governance 前置红⓪（真 PG——int 池）。
// 断言面裁定（compact 现状实证）：compact 尚未消费 OpsGate（两行校验/freeze 归 C2-1）⇒
// 「compact 可运行」在本卡的前置等价形态=两创建路径各建项目后 OpsGate 行齐（项目行 OPEN+全局
// 哨兵行在=C2-1 两行校验的前提面）+origin 谱系落列+governance 幂等可重入（重复调用零副作用——
// 漏接=该路径项目 compact 永久 fail-closed 停摆根除）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ProjectService } from '../project/project.service';
import { CanvasService } from '../canvas/canvas.service';
import { ensureProjectGovernance, OPS_GATE_COMPACT } from './project-governance.service';
import { CANVAS_PROJECT_ORIGIN_USER } from '@flowweb/shared';
import { FIXTURE_USER, FIXTURE_TEAM } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C2-0 governance 前置（真 PG——两创建路径）', () => {
  const prisma = new PrismaClient();
  /** ensureDefaultTeam stub（真 TeamService 依赖链重——create 路径仅消费「返回团队 id」面；
   *  同款 stub 先例=canvas.service.spec.ts TeamService provider stub）。 */
  const teamService = { ensureDefaultTeam: async () => ({ id: FIXTURE_TEAM }) } as any;
  const projectService = new ProjectService(prisma as any, teamService, {} as any, {} as any);
  const canvasService = new CanvasService(prisma as any, {} as any, { clearCache: () => {} } as any, teamService);
  const createdIds: string[] = [];

  beforeAll(async () => {
    // User+Team 桩（FIXTURE_* 常量复用——ensureProjectFixture 会建无关项目，本用例自建项目即断言面）
    await prisma.user.upsert({
      where: { id: FIXTURE_USER },
      update: {},
      create: { id: FIXTURE_USER, name: 'c2-0-gov', email: 'c2-0-gov@local.test', emailVerified: true },
    });
    await prisma.team.upsert({
      where: { id: FIXTURE_TEAM },
      update: {},
      create: { id: FIXTURE_TEAM, name: 'c2-0-gov-team', ownerId: FIXTURE_USER },
    });
  });

  afterAll(async () => {
    // gate/pin/cursor 三表无 FK（worker scope 批删域——schema 头注纪律）——项目清理前显式删行
    await prisma.collabOpsGate.deleteMany({ where: { projectId: { in: createdIds } } });
    await prisma.canaryPin.deleteMany({ where: { projectId: { in: createdIds } } });
    await prisma.collabCanaryCursor.deleteMany({ where: { projectId: { in: createdIds } } });
    for (const id of createdIds) await prisma.canvasProject.deleteMany({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  /** 两路径共用断言面：OpsGate ('compact',pid) 项目行 OPEN/version 0+origin='user'+全局哨兵行在。 */
  async function assertGoverned(projectId: string) {
    const gate = await prisma.collabOpsGate.findUnique({
      where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId } },
    });
    expect(gate, 'OpsGate 项目行在（漏接=该路径项目 compact 永久 fail-closed）').toMatchObject({
      gate: OPS_GATE_COMPACT,
      projectId,
      state: 'OPEN',
      version: 0n,
    });
    const project = await prisma.canvasProject.findUniqueOrThrow({ where: { id: projectId }, select: { origin: true } });
    expect(project.origin).toBe(CANVAS_PROJECT_ORIGIN_USER);
  }

  it('红⓪-a ProjectService.create 路径（/api/projects 第一创建路径）：OpsGate 行/origin 齐+全局哨兵行在', async () => {
    const created = await projectService.create('c2-0-gov-a', FIXTURE_USER);
    createdIds.push(created.id);
    await assertGoverned(created.id);
    // 全局哨兵行（C2-1 两行校验的常驻半边——迁移笔二落，本断言钉其常驻性）
    const sentinel = await prisma.collabOpsGate.findUnique({
      where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId: '' } },
    });
    expect(sentinel).toMatchObject({ gate: OPS_GATE_COMPACT, projectId: '', state: 'OPEN', version: 0n });
  });

  it('红⓪-b CanvasService.create 路径（canvas.service 第二创建路径——直建 project+Template+genesis）：OpsGate 行/origin 齐', async () => {
    const created = await canvasService.create('c2-0-gov-b', null, FIXTURE_USER);
    createdIds.push(created.projectId);
    await assertGoverned(created.projectId);
  });

  it('governance 幂等：重复调用零副作用（行不重复/state 不漂/version 不动）', async () => {
    const created = await projectService.create('c2-0-gov-c', FIXTURE_USER);
    createdIds.push(created.id);
    await assertGoverned(created.id);
    await prisma.$transaction(async (tx) => {
      await ensureProjectGovernance(tx, { projectId: created.id, origin: CANVAS_PROJECT_ORIGIN_USER });
      await ensureProjectGovernance(tx, { projectId: created.id, origin: CANVAS_PROJECT_ORIGIN_USER });
    });
    const gates = await prisma.collabOpsGate.findMany({ where: { gate: OPS_GATE_COMPACT, projectId: created.id } });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ state: 'OPEN', version: 0n });
    const project = await prisma.canvasProject.findUniqueOrThrow({ where: { id: created.id }, select: { origin: true } });
    expect(project.origin).toBe(CANVAS_PROJECT_ORIGIN_USER);
  });
});
