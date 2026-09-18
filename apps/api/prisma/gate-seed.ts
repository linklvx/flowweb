// A0-0 门禁 fixtures（Playwright globalSetup 调用）：USER 账号 + 最小画布（含 2 节点 yjs doc）+ 工作空间模板行 + 最小视频作品。
// 幂等：USER 存在即跳过、其余 upsert；重跑零增量残留。
// 常量契约：apps/web/e2e/global-setup.ts（账号）与 apps/web/e2e/a0-0-env.spec.ts（projectId）引用同值。
import 'dotenv/config';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/auth';

const prisma = new PrismaClient();

const GATE = {
  email: 'gate@flowweb.local',
  password: 'gate12345678', // better-auth minPasswordLength=8
  name: 'Gate User',
  projectId: 'gate-canvas-1',
  templateId: 'gate-template-1',
  videoWorkId: 'gate-video-1',
};

/** 画布 yjs 快照——结构契约对齐前端 ydocBuilder.fillDoc（nodes/edges → Y.Map），
 *  collab.gateway.loadDocument 直接 applyUpdate 本二进制。 */
function buildCanvasState(): Buffer {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  for (const [id, x, y] of [['gate-node-1', 0, 0], ['gate-node-2', 360, 120]] as const) {
    const m = new Y.Map();
    m.set('type', 'videoGen');
    const pos = new Y.Map();
    pos.set('x', x);
    pos.set('y', y);
    m.set('position', pos);
    m.set('data', new Y.Map());
    nodes.set(id, m);
  }
  const edge = new Y.Map();
  edge.set('source', 'gate-node-1');
  edge.set('target', 'gate-node-2');
  doc.getMap('edges').set('gate-edge-1', edge);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function main() {
  // 门禁 USER：与管理员同路径（seed.ts:218-228）——signUpEmail 建号（argon2 哈希 + databaseHooks bootstrap 个人团队），不提权
  let user = await prisma.user.findUnique({ where: { email: GATE.email } });
  if (!user) {
    await auth.api.signUpEmail({ body: { email: GATE.email, password: GATE.password, name: GATE.name } });
    console.log(`Gate user created: ${GATE.email}`);
  }
  user = await prisma.user.findUniqueOrThrow({ where: { email: GATE.email } });
  const team = await prisma.team.findFirst({ where: { ownerId: user.id, isDefault: true } });
  if (!team) throw new Error('gate user default team missing (bootstrapPersonalTeam failed?)');

  // 画布：CanvasProject + CanvasDoc 快照重写 + CanvasDocUpdate 增量行清残——自愈无条件成立：
  // 载入 = 快照 + 全量 update 重放（collab.gateway.loadDocument），只重写快照不清残时，
  // 残留增量会在干净快照上重放出污染（Yjs 墓碑复活再删 fixture 节点）
  await prisma.canvasProject.upsert({
    where: { id: GATE.projectId },
    update: {},
    create: { id: GATE.projectId, name: 'A0-0 门禁画布', userId: user.id, teamId: team.id },
  });
  const state = buildCanvasState();
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId: GATE.projectId } });
  await prisma.canvasDoc.upsert({
    where: { projectId: GATE.projectId },
    update: { state },
    create: { projectId: GATE.projectId, state },
  });

  // 工作空间个人页网格行（/works 列表经 getTemplates type=my：userId OR project.teamId）
  await prisma.template.upsert({
    where: { id: GATE.templateId },
    update: {},
    create: { id: GATE.templateId, name: 'A0-0 门禁画布', userId: user.id, teamId: team.id, projectId: GATE.projectId, status: 'SAVED' },
  });

  // /videos 公开列表最小行（VideoWork 无归属字段——平台公开作品）
  await prisma.videoWork.upsert({
    where: { id: GATE.videoWorkId },
    update: {},
    create: {
      id: GATE.videoWorkId, title: 'A0-0 门禁样例视频', authorName: GATE.name,
      videoKey: 'gate-fixtures/sample.mp4', status: 'PUBLISHED', publishedAt: new Date(), durationSec: 5,
    },
  });

  console.log('Gate fixtures ready: user/canvas/template/videoWork');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0); // auth.ts 顶层 ioredis 连接会让进程挂起，必须显式退出（seed.ts 同款）
  });
