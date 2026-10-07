// Y0a-1：int 用例 FK 链 fixture——CanvasDocUpdate.projectId→CanvasProject→Team(ownerId)→User
// （既有 int 惯例 generation-intent.int.spec.ts 不建链因其表无 FK；本批表有 Cascade FK，必须全链）
// Y0a-2（V7b）：演练与 int 共用面——增导出 FIXTURE_USER/FIXTURE_TEAM+collab 全链 fixture
// （User+Team+CanvasProject+TeamMember+Session，缺 TeamMember 则 WS authenticate FORBIDDEN）。
import { PrismaClient, type TeamRole } from '@prisma/client';

export const FIXTURE_USER = 'y0a-fixture-user';
export const FIXTURE_TEAM = 'y0a-fixture-team';

export async function ensureProjectFixture(prisma: PrismaClient, projectId: string, name = 'y0a-int'): Promise<void> {
  await prisma.user.upsert({
    where: { id: FIXTURE_USER },
    update: {},
    create: { id: FIXTURE_USER, name: 'y0a-fixture', email: 'y0a-fixture@local.test', emailVerified: true },
  });
  await prisma.team.upsert({
    where: { id: FIXTURE_TEAM },
    update: {},
    create: { id: FIXTURE_TEAM, name: 'y0a-fixture-team', ownerId: FIXTURE_USER },
  });
  await prisma.canvasProject.upsert({
    where: { id: projectId },
    update: {},
    create: { id: projectId, name, teamId: FIXTURE_TEAM },
  });
}

export async function cleanupProjectFixture(prisma: PrismaClient, projectId: string): Promise<void> {
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
  await prisma.canvasDoc.deleteMany({ where: { projectId } });
  await prisma.canvasProject.deleteMany({ where: { id: projectId } });
}

/** Y0a-2（V7b）：演练/端到端用完整 fixture——User+Team+CanvasProject+TeamMember（缺它 authenticate
 *  FORBIDDEN）+Session（token @unique 直插即过 WS 鉴权；expiresAt 1h 窗）。 */
export async function ensureCollabSessionFixture(
  prisma: PrismaClient, projectId: string, token: string, role: TeamRole = 'MEMBER',
): Promise<void> {
  await ensureProjectFixture(prisma, projectId);
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: FIXTURE_TEAM, userId: FIXTURE_USER } },
    update: { role },
    create: { teamId: FIXTURE_TEAM, userId: FIXTURE_USER, role },
  });
  await prisma.session.deleteMany({ where: { token } });
  await prisma.session.create({
    data: { id: `sess-${token}`, userId: FIXTURE_USER, token, expiresAt: new Date(Date.now() + 3_600_000) },
  });
}

export async function cleanupCollabSessionFixture(prisma: PrismaClient, projectId: string, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });   // V25/M4：session 行清理
  await cleanupProjectFixture(prisma, projectId);
}
