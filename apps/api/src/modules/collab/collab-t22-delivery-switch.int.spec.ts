// apps/api/src/modules/collab/collab-t22-delivery-switch.int.spec.ts
// Y1c T22 G5 先红①③④（plan v1.7 Task 22——不变量⑦「serving 期零业务 doc 写」+D9 同切片）：
// ①serving 期服务端写 doc（deliverArtifact 现状=withSession(write) data.fileId/exec done）=红；
// ③T22 切换后旧 UI 读 stale doc.exec（projectExecToStore 读源）=红前置（本 spec 锚服务端半链：
//   doc exec map 零新写——web 半链=execStatusView 数据源切换 spec 在 web 侧）；
// ④服务端派生字段任何形式进 doc（display-cache 回写）=红——deliverArtifact/writeExecStatus 后
//   doc 节点 data.{fileId|result|status} 不变+exec map 恒空+RuntimeEvent 两事件在档（新权威）。
// 绿形=T22 切交付：deliverArtifact 改 PG 写（fence 权威=deliveryFenceCheckInTx——T26 裁定面
// unregistered/stale 三场景 fail-closed 拒档；ACTIVE 放行写 exec.artifact+exec.status）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fillDoc, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { toDocLike } from './doc-like.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabLifecycleObserverService } from './collab-lifecycle-observer.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { CollabDocumentService, type WriteNodeDataResult } from './collab-document.service';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const repo = new CanvasDocUpdateRepository(prisma as unknown as PrismaService);
const observer = new CollabLifecycleObserverService(prisma as unknown as PrismaService);
const feed = new RuntimeFeedService(prisma as unknown as PrismaService);
// 直构 gateway stub（withSession 门不触达——T22 后两方法不再走 withSession；受理门走 residency
// 自建形态=gateway.isLeaseServing/isDegradatedStale 三真值面）
const gatewayStub = {
  isLeaseServing: () => true,
  isWritableOrDegraded: () => 'ok' as const,
  server: { hocuspocus: { documents: new Map() } },
} as never;
const docs = new CollabDocumentService(gatewayStub, repo, undefined, feed, observer);

const PID = `int-t22-dlv-${Date.now()}`;
const UID = `int-t22-dlv-owner-${Date.now()}`;

let TID = '';
async function seedDoc() {
  const team = await prisma.team.create({ data: { name: `t22-dlv-${Date.now()}`, ownerId: UID } });
  TID = team.id;
  await prisma.canvasProject.create({ data: { id: PID, name: PID, teamId: TID, userId: UID } });
  const doc = new Y.Doc();
  fillDoc(toDocLike(doc), [{ id: 'n1', type: 'imageGen', data: { prompt: 'p' } }], []);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  await prisma.canvasDocSnapshot.create({ data: { projectId: PID, generation: 0, snapshotRev: 0n, stateSeq: 0n, state, stateHash: '0'.repeat(64), vacuumEpoch: 0, schemaVersion: CANVAS_DOC_SCHEMA_VERSION } });
  await prisma.canvasDoc.create({ data: { projectId: PID, generation: 0, pgSeq: 0n, walCheckpointSeq: 0n, currentSnapshotRev: 0n } });
  doc.destroy();
}

/** 从 PG 前缀重建 doc（readSnapshotOnly 同构——readCanvas 活读会话不进本 spec）。 */
async function hydrateDoc(): Promise<Y.Doc> {
  const { state, updates } = await repo.readSnapshotOnly(PID);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
  return doc;
}

/** seed ACTIVE fence（T26 观察器同构行——isCurrent ACTIVE+fenceSeq 匹配）。 */
async function seedActiveFence(nodeId: string): Promise<void> {
  await prisma.nodeLifecycle.create({ data: { projectId: PID, nodeId, lifecycleSeq: 1n, isCurrent: true, state: 'ACTIVE', walSeq: 0n } });
  await prisma.deliveryFence.create({ data: { projectId: PID, nodeId, fenceSeq: 1n, state: 'ACTIVE' } });
}

const execDonePatch = { status: 'done', attempts: 1 } as const;

(hasDb ? describe : describe.skip)('Y1c T22 G5：同切片切交付（不变量⑦——真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: UID }, create: { id: UID, name: UID, email: `${UID}@t.local`, emailVerified: false }, update: {} });
    await seedDoc();
  }, 20_000);

  afterAll(async () => {
    await prisma.runtimeEvent.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.nodeLifecycle.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.deliveryFence.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: PID } }).catch(() => undefined);
    if (TID) await prisma.team.deleteMany({ where: { id: TID } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: UID } }).catch(() => undefined);
    await prisma.$disconnect();
  }, 20_000);

  it('红④（不变量）：deliverArtifact 后 doc 零派生字段（data.fileId 不变+exec map 恒空）+RuntimeEvent exec.artifact/exec.status 两事件在档（新权威）', async () => {
    await seedActiveFence('n1');
    const before = await hydrateDoc();
    const r = await docs.deliverArtifact(PID, { nodeId: 'n1', targetField: 'fileId', value: 'm-t22-a', exec: { ...execDonePatch, artifactRev: 1, fileId: 'm-t22-a' } });
    expect(r.data.written).toBe(true);   // 交付成功（fence ACTIVE 放行）
    const after = await hydrateDoc();
    const node = after.getMap('nodes').get('n1') as Y.Map<unknown>;
    const data = node.get('data') as Y.Map<unknown>;
    // 红（旧实现 withSession(write) 写 data.fileId）：派生字段任何形式禁入 doc——值不落
    expect(data.get('fileId')).toBeUndefined();
    expect((before.getMap('nodes').get('n1') as Y.Map<unknown>).get('data')).toBeDefined();
    // exec map 恒空（doc.exec 停写——红③服务端半链：旧实现写 exec done 条目）
    expect(after.getMap('exec').size).toBe(0);
    // 新权威=RuntimeEvent（exec.artifact 携 mediaId+exec.status done——同事务原子提交）
    const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
    expect(events.map((e) => e.kind)).toEqual(['exec.artifact', 'exec.status']);
    const artifact = events[0]!.payload as { nodeId: string; mediaId?: string; artifactRev: number; nodeVersion: string };
    expect(artifact).toMatchObject({ nodeId: 'n1', mediaId: 'm-t22-a', artifactRev: 1 });
    expect(artifact.nodeVersion).toBe(events[0]!.feedSeq.toString());   // nodeVersion=自身 feedSeq（单名单义）
    expect((events[1]!.payload as { status: string }).status).toBe('done');
    after.destroy();
    before.destroy();
  });

  it('红①（serving 写=0 延伸）：writeExecStatus 改 PG 写——doc exec map 零条目+RuntimeEvent exec.status 在档', async () => {
    await docs.writeExecStatus(PID, 'n1', { status: 'loading', attempts: 1 });
    const after = await hydrateDoc();
    expect(after.getMap('exec').size).toBe(0);   // 红：旧实现 withSession(write) 建 exec 条目
    const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'exec.status' }, orderBy: { feedSeq: 'asc' } });
    expect(events.some((e) => (e.payload as { status: string }).status === 'loading')).toBe(true);   // 本轮 loading 事件在档（前轮 done 并存）
    after.destroy();
  });

  it('T26 裁定面：fence unregistered（无行——legacy/词表外）⇒ 拒档 written:false node-deleted（fail-closed——开发期无存量兼容）', async () => {
    const r = await docs.deliverArtifact(PID, { nodeId: 'ghost-node', targetField: 'fileId', value: 'm-x', exec: { ...execDonePatch, artifactRev: 1 } });
    expect(r.data.written).toBe(false);
    expect((r.data as WriteNodeDataResult).reason).toBe('node-deleted');
    const ghost = await prisma.runtimeEvent.findMany({ where: { projectId: PID } });
    expect(ghost.every((e) => (e.payload as { nodeId?: string }).nodeId !== 'ghost-node')).toBe(true);   // 零事件（拒档）
  });

  it('T26 裁定面：fence-stale（fenceSeq=0——replayAll 崩溃窗/doc-lag 收养整体 stale）⇒ 拒档（宁拒勿复活 stale-ACTIVE 逃逸）', async () => {
    await seedActiveFence('n-stale');
    await prisma.deliveryFence.update({ where: { projectId_nodeId: { projectId: PID, nodeId: 'n-stale' } }, data: { fenceSeq: 0n } });   // staleProjectFencesInTx 同构态
    const r = await docs.deliverArtifact(PID, { nodeId: 'n-stale', targetField: 'fileId', value: 'm-y', exec: { ...execDonePatch, artifactRev: 1 } });
    expect(r.data.written).toBe(false);
    expect(r.data.reason).toBe('node-deleted');
  });

  it('幂等：同 (nodeId,artifactRev) 二次投递=no-op（事件不重复——poller 重投/ambiguous commit 安全）', async () => {
    const before = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    const r = await docs.deliverArtifact(PID, { nodeId: 'n1', targetField: 'fileId', value: 'm-t22-a', exec: { ...execDonePatch, artifactRev: 1, fileId: 'm-t22-a' } });
    expect(r.data.written).toBe(true);
    const after = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    expect(after).toBe(before);   // 零新事件（幂等前置命中）
  });
});
