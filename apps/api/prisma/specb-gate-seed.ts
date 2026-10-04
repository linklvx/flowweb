// Spec B B7-2 e2e fixtures（collab-global-setup 在 collab-gate-seed 之后调用）：
//   ① collab-c 账号（teamA MEMBER）——三端用例的 C 端（测试时经 collab-db set-viewer 降只读）；
//   ② specb-public-canvas + specb-public-work——公开页 e2e（匿名 /videos/:id 查看制作过程）：
//      分镜组 1×3 宫格（2 完成图 + 1 空槽），缩略图=真实 PNG 对象上 MinIO（宫格有图判据要真加载）；
//   ③ specb-perf-canvas——性能冒烟 nightly（500 节点/20 组，auto 组零帧键 + textInput 子 abs 定位）。
// 幂等：账号/作品/画布 upsert、doc 快照重写 + 增量行清残（collab-gate-seed 同款自愈）、MinIO putObject 幂等。
// 契约：apps/web/e2e/collab-specb-public.e2e.spec.ts / collab-specb-perf.e2e.spec.ts 引用同值 id。
import 'dotenv/config';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { auth } from '../src/auth/auth';
import {
  fillDoc as fillDocShapes, stampDocSchema,
  type DocLike, type DocMapLike, type DocNodeRecord,
} from '@flowweb/shared';

/** Y.Doc→DocLike 结构性适配（ydocBuilder.toDocLike 同款——api 侧不可 import web 源，结构性复刻） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

const prisma = new PrismaClient();

export const SPECB_GATE = {
  cEmail: 'collab-c@flowweb.local',
  password: 'collab12345678',
  aEmail: 'collab-a@flowweb.local',
  publicCanvasId: 'specb-public-canvas',
  publicWorkId: 'specb-public-work',
  perfCanvasId: 'specb-perf-canvas',
};

/** 1×1 红色 PNG（真实可加载对象——宫格「有图」判据要 img naturalWidth>0） */
function tinyRedPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

function s3(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000',
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    },
    forcePathStyle: true,
    tls: process.env.MINIO_USE_SSL === 'true',
  });
}

async function putThumbs(): Promise<string[]> {
  const client = s3();
  const bucket = process.env.MINIO_BUCKET ?? 'flowai';
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => {/* 已存在竞态 */});
  }
  const keys = ['seed/specb/thumb-1.png', 'seed/specb/thumb-2.png'];
  for (const key of keys) {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: tinyRedPng(), ContentType: 'image/png',
    }));
  }
  return keys;
}

/** 画布 doc 快照自愈（collab-gate-seed 同款：快照重写 + 增量行清残） */
async function ensureCanvas(projectId: string, doc: Y.Doc, userId: string, teamId: string, name: string): Promise<void> {
  await prisma.canvasProject.upsert({
    where: { id: projectId },
    update: {},
    create: { id: projectId, name, userId, teamId },
  });
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
  await prisma.canvasDoc.upsert({
    where: { projectId },
    update: { state },
    create: { projectId, state },
  });
}

/** Y.Map 节点构造零手写（R1a 信封门禁）：doc 装配走 shared docShape fillDoc 单源
 *  （position 子 Map 构造唯一在位者——seed 手抄形态被 envelope-serialization-guard 拦）。 */

async function main() {
  // ① collab-c（三端 C 端账号）
  let userC = await prisma.user.findUnique({ where: { email: SPECB_GATE.cEmail } });
  if (!userC) {
    await auth.api.signUpEmail({ body: { email: SPECB_GATE.cEmail, password: SPECB_GATE.password, name: 'Collab Gate C' } });
    userC = await prisma.user.findUniqueOrThrow({ where: { email: SPECB_GATE.cEmail } });
  }
  const userA = await prisma.user.findUniqueOrThrow({ where: { email: SPECB_GATE.aEmail } });
  const teamA = await prisma.team.findFirstOrThrow({ where: { ownerId: userA.id, isDefault: true } });
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: teamA.id, userId: userC.id } },
    update: { role: 'MEMBER' },
    create: { teamId: teamA.id, userId: userC.id, role: 'MEMBER' },
  });

  // ② 公开页画布 + 作品（真实缩略图对象）
  const thumbKeys = await putThumbs();
  const medias = await Promise.all([0, 1].map((i) => prisma.media.upsert({
    where: { id: `specb-thumb-${i + 1}` },
    update: { thumbnailKey: thumbKeys[i], status: 'completed' },
    create: {
      id: `specb-thumb-${i + 1}`,
      user: { connect: { id: userA.id } },
      team: { connect: { id: teamA.id } },
      bucket: process.env.MINIO_BUCKET ?? 'flowai',
      key: thumbKeys[i],
      originalName: `specb-thumb-${i + 1}.png`,
      mimeType: 'image/png',
      size: tinyRedPng().length,
      status: 'completed',
      type: 'generated',
      thumbnailKey: thumbKeys[i],
    },
  })));

  const publicRecords: DocNodeRecord[] = [
    { // 键集表：storyboard 组 position 有键、width/height 无键（帧=calcStoryboardSize 派生）
      id: 'sb1', type: 'group', position: { x: 100, y: 100 },
      data: {
        groupType: 'storyboard',
        name: 'B7-2 公开页分镜',
        cells: ['c1', 'c2', null],   // 第 3 槽空位（公开页空槽无 + 号断言面）
        storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 3, showIndex: false, stitchResolution: '2K' },
      },
    },
    { id: 'c1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: { status: 'done', fileId: medias[0].id } },
    { id: 'c2', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: { status: 'done', fileId: medias[1].id } },
  ];
  const publicDoc = new Y.Doc();
  fillDocShapes(toDocLike(publicDoc), publicRecords, []);
  stampDocSchema(toDocLike(publicDoc));
  await ensureCanvas(SPECB_GATE.publicCanvasId, publicDoc, userA.id, teamA.id, 'B7-2 公开页源画布');

  await prisma.videoWork.upsert({
    where: { id: SPECB_GATE.publicWorkId },
    update: { canvasProjectId: SPECB_GATE.publicCanvasId, allowViewProcess: true, status: 'PUBLISHED' },
    create: {
      id: SPECB_GATE.publicWorkId,
      title: 'B7-2 公开页 e2e 作品',
      authorName: 'Collab Gate A',
      videoKey: 'seed/specb/final.mp4', // 成片对象不落（e2e 断言面=过程页，非播放）
      status: 'PUBLISHED',
      allowViewProcess: true,
      publishedAt: new Date(),
      canvasProjectId: SPECB_GATE.publicCanvasId,
    },
  });

  // ③ 性能冒烟画布：20 组 × 25 子 = 520 节点（auto 组零帧键；子 abs 定位 1/8 格值——非整数坐标档必跑）
  const perfRecords: DocNodeRecord[] = [];
  for (let g = 0; g < 20; g++) {
    const gx = (g % 5) * 2000 + 100.125;
    const gy = Math.floor(g / 5) * 2200 + 100.375;
    perfRecords.push({ id: `pg${g}`, type: 'group', data: { groupType: 'normal', name: `perf-${g}` } });
    for (let j = 0; j < 25; j++) {
      perfRecords.push({
        id: `pc${g}-${j}`, type: 'textInput', parentId: `pg${g}`,
        position: { x: gx + 20.25 + (j % 5) * 320.125, y: gy + 50.5 + Math.floor(j / 5) * 320.125 },
        width: 300, height: 300,
        data: { content: `perf ${g}-${j}` },
      });
    }
  }
  const perfDoc = new Y.Doc();
  fillDocShapes(toDocLike(perfDoc), perfRecords, []);
  stampDocSchema(toDocLike(perfDoc));
  await ensureCanvas(SPECB_GATE.perfCanvasId, perfDoc, userA.id, teamA.id, 'B7-2 性能冒烟 500 节点');

  console.log('SpecB gate fixtures ready: collab-c / public work / perf canvas (520 nodes)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0); // auth.ts 顶层 ioredis 连接会让进程挂起，必须显式退出（collab-gate-seed 同款）
  });
