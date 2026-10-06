// Y0a-1：int 用例 FK 链 fixture——CanvasDocUpdate.projectId→CanvasProject→Team(ownerId)→User
// （既有 int 惯例 generation-intent.int.spec.ts 不建链因其表无 FK；本批表有 Cascade FK，必须全链）
import { PrismaClient } from '@prisma/client';

const FIXTURE_USER = 'y0a-fixture-user';
const FIXTURE_TEAM = 'y0a-fixture-team';

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
