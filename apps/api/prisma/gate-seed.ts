// A0-0 门禁 fixtures（Playwright globalSetup 调用）：USER 账号 + 最小画布（gate-node-1/2 保留 +
// O0b-0 一次到位：auto 组 1+分镜组 1——形状验收断言见 src/gate-canvas-state.spec.ts）+
// 工作空间模板行 + 最小视频作品。
// 幂等：USER 存在即跳过、其余 upsert；重跑零增量残留。
// 常量契约：apps/web/e2e/global-setup.ts（账号）与 apps/web/e2e/a0-0-env.spec.ts（projectId）引用同值。
// O0b-0 格式批：buildGateCanvasState 经 shared docShape（fillDoc——O0a-2 裁定 load-bearing：
// applyRecordToYMap 不写 data 键，种子走它会复现 F29 丢数据；禁自建 Y.Map 绕咽喉）。
// T18：meta 戳删除（版本承载=CanvasDoc.schemaVersion PG 列——建行 @default(3)，doc 内容零版本键）。
// O0c-3：二进制构造抽 src/gate-canvas-state.ts 纯模块（零 prisma/auth 副作用——验收断言直解二进制）。
// tsx 直跑消费 dist——片尾必须 pnpm --filter @flowweb/shared build（scripts/check-shared-dist.mjs 可校验）。
import { createHash } from 'node:crypto';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getAuth } from '../src/auth/auth';   // T34：betterAuth 惰性单例
import { buildGateCanvasState } from '../src/gate-canvas-state';

const prisma = new PrismaClient();

const GATE = {
  email: 'gate@flowweb.local',
  password: 'gate12345678', // better-auth minPasswordLength=8
  name: 'Gate User',
  projectId: 'gate-canvas-1',
  templateId: 'gate-template-1',
  videoWorkId: 'gate-video-1',
};

async function main() {
  // 门禁 USER：与管理员同路径（seed.ts:218-228）——signUpEmail 建号（argon2 哈希 + databaseHooks bootstrap 个人团队），不提权
  let user = await prisma.user.findUnique({ where: { email: GATE.email } });
  if (!user) {
    await getAuth().api.signUpEmail({ body: { email: GATE.email, password: GATE.password, name: GATE.name } });
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
  const state = buildGateCanvasState();
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId: GATE.projectId } });
  await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: GATE.projectId } });
  await prisma.canvasDoc.upsert({
    where: { projectId: GATE.projectId },
    update: {},
    create: { projectId: GATE.projectId },
  });
  // Y1c T11（快照权威）：doc 态种子落 CanvasDocSnapshot(g,0,0)（头行零 doc 态列；指针
  // currentSnapshotRev=0 默认与 (g,0) 对齐——装载=快照+增量尾）；stateHash=SHA-256（genesis 同口径）
  await prisma.canvasDocSnapshot.upsert({
    where: { projectId_generation_snapshotRev: { projectId: GATE.projectId, generation: 0, snapshotRev: 0n } },
    create: {
      projectId: GATE.projectId, generation: 0, snapshotRev: 0n, stateSeq: 0n, state,
      stateHash: createHash('sha256').update(state).digest('hex'),
      vacuumEpoch: 0, schemaVersion: 3,
    },
    update: {},
  });


  // 工作空间个人页网格行（/works 列表经 getTemplates type=my：userId OR project.teamId）
  await prisma.template.upsert({
    where: { id: GATE.templateId },
    update: {},
    create: { id: GATE.templateId, name: 'A0-0 门禁画布', userId: user.id, teamId: team.id, projectId: GATE.projectId },
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
    process.exit(0); // auth.ts 顶层 authPrisma 客户端会让进程挂起，必须显式退出（seed.ts 同款——T34 起 ioredis 惰性）
  });
