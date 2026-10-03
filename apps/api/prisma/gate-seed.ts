// A0-0 门禁 fixtures（Playwright globalSetup 调用）：USER 账号 + 最小画布（gate-node-1/2 保留 +
// O0b-0 一次到位：auto 组 1+分镜组 1——O0c-3 只留断言）+ 工作空间模板行 + 最小视频作品。
// 幂等：USER 存在即跳过、其余 upsert；重跑零增量残留。
// 常量契约：apps/web/e2e/global-setup.ts（账号）与 apps/web/e2e/a0-0-env.spec.ts（projectId）引用同值。
// O0b-0 格式批：buildCanvasState 经 shared docShape（fillDoc——O0a-2 裁定 load-bearing：
// applyRecordToYMap 不写 data 键，种子走它会复现 F29 丢数据；禁自建 Y.Map 绕咽喉）+显式
// stampDocSchema（fillDoc 不写 meta——戳源唯一化，WS loadDocument 版本门 v2.1 放行前提）。
// tsx 直跑消费 dist——片尾必须 pnpm --filter @flowweb/shared build（scripts/check-shared-dist.mjs 可校验）。
import 'dotenv/config';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { fillDoc, stampDocSchema, type DocLike, type DocMapLike } from '@flowweb/shared';
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

/** Y.Doc→DocLike 结构性适配（doc-like.util 同构——gate-seed 不 import api src 编译面外的模块） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

/** 画布 yjs 快照（O0b-0 一次到位——doc=abs 空间 v2 档）：
 *  - gate-node-1/2 保留不动（a0-0-env.spec:27-28 兼容）
 *  - auto 组 1（组+2 子：组无帧三键[键集表]、子带 abs position）
 *  - 分镜组 1（组带 position+storyboard 完整 config+cells；分镜子无 position 带 width/height）
 *  - meta 戳（stampDocSchema——WS loadDocument 版本门放行）
 *  collab.gateway.loadDocument 直接 applyUpdate 本二进制。 */
function buildCanvasState(): Buffer {
  const doc = new Y.Doc();
  const docLike = toDocLike(doc);
  fillDoc(docLike, [
    // gate-node-1/2（a0-0 兼容——顶层 abs）
    { id: 'gate-node-1', type: 'videoGen', position: { x: 0, y: 0 }, data: {} },
    { id: 'gate-node-2', type: 'videoGen', position: { x: 360, y: 120 }, data: {} },
    // auto 组 1（组无帧三键——键集表"auto/collapsed 组=0 帧键"；子带 abs position）
    { id: 'gate-auto-group', type: 'group', data: { groupType: 'normal', name: 'Gate Auto 组' } },
    { id: 'gate-auto-child-1', type: 'textInput', parentId: 'gate-auto-group', position: { x: 40, y: 70 }, width: 200, height: 80, data: { content: 'auto child 1' } },
    { id: 'gate-auto-child-2', type: 'textInput', parentId: 'gate-auto-group', position: { x: 280, y: 70 }, width: 200, height: 80, data: { content: 'auto child 2' } },
    // 分镜组 1（组带 position；storyboard 完整 config+cells；分镜子无 position 带 width/height）
    { id: 'gate-sb-group', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', cells: ['gate-sb-cell-1', 'gate-sb-cell-2'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' } } },
    { id: 'gate-sb-cell-1', type: 'imageGen', parentId: 'gate-sb-group', width: 320, height: 180, data: { status: 'done' } },
    { id: 'gate-sb-cell-2', type: 'imageGen', parentId: 'gate-sb-group', width: 320, height: 180, data: { status: 'idle' } },
  ], [
    { id: 'gate-edge-1', source: 'gate-node-1', target: 'gate-node-2' },
  ]);
  stampDocSchema(docLike);   // O0b-0：v2 戳（戳源唯一化——fillDoc 不写 meta）
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
    process.exit(0); // auth.ts 顶层 ioredis 连接会让进程挂起，必须显式退出（seed.ts 同款）
  });
