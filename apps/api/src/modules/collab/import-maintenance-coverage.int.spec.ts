// apps/api/src/modules/collab/import-maintenance-coverage.int.spec.ts
// C3a-8 修复批 C1（spec 评审 Critical——import enqueue 早于维护 flush 落 PG → 假覆盖）真库红测：
// 链路=origin='import' 的 update 入 persistence 维护队列 → 维护 flush（真 actor sink→appendBatch）。
// 修前：闭包空 delta 恒返 {bindingCovered:true} ⇒ 帧水位推进且媒体引用未投影=假覆盖（dirty 被
// 提前 enqueue 的 rebuild 清掉）。修后：persistence 给 import 维护帧申报 bindingUncovered ⇒ 闭包
// 置 dirty+covered=false（禁推 binding 水位；懒建档 covered=false→dirty=true+mediaBindingSeq=0）；
// 队列清空后 bindingRecoveryFace.enqueue 一次 → rebuild 收敛。
//
// 用例：
//   ①有头行（pgSeq=0/dirty=false）：import apply→flush→dirty=true ∧ mediaBindingSeq=0 ∧ 无 binding 行
//     → rebuild 后 binding 行在 ∧ dirty=false ∧ mediaBindingSeq==pgSeq；
//   ②无头行（懒建档）：flush 后行在 ∧ dirty=true ∧ mediaBindingSeq=0 → rebuild 收敛；
//   ③直接 actor.submitMaintenance(pid, diff, {bindingUncovered:true})（sink 签名透传面）→ 同上未覆盖态；
//   ④普通维护写（非 import）不改变覆盖语义（covered=true→水位推进、dirty 保持 false）——负控。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { CollabPersistenceService, type CollabPersistenceHost } from './collab-persistence.service';
import { CollabSpoolService } from './collab-spool.service';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { BindingRebuildService } from './binding-rebuild.service';
import { ProjectionBackfillRunner } from './projection-backfill.runner';
import { canvasDocName } from './doc-name.util';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_HEAD = '0c3a8-c1-head';
const PID_LAZY = '0c3a8-c1-lazy';
const PID_DIRECT = '0c3a8-c1-direct';
const PID_PLAIN = '0c3a8-c1-plain';
const PID_MIX = '0c3a8-c1-mixed';
const M = 'c3a8-c1-media';

/** connection 帧内容（node n-conn data.referenceImage=M——mediaLww 现役写权键）。 */
function connFrame(nodeId = 'n-conn'): Uint8Array {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const data = new Y.Map<unknown>();
  data.set('referenceImage', M);
  node.set('type', 'imageGen');
  node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
  return Y.encodeStateAsUpdate(d);
}

/** import 内容 diff（node n-imp data.fileId=M）。 */
function importDiff(nodeId = 'n-imp'): Uint8Array {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const data = new Y.Map<unknown>();
  data.set('fileId', M);
  node.set('type', 'image');
  node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
  return Y.encodeStateAsUpdate(d);
}

/** 普通维护写 diff（无媒体引用）。 */
function plainDiff(nodeId = 'n-plain'): Uint8Array {
  const d = new Y.Doc();
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, new Y.Map([['type', 'textInput']]));
  return Y.encodeStateAsUpdate(d);
}

maybe('C3a-8 修复批 C1：import 维护批次申报未覆盖（真 PG+真 actor sink）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const rebuild = new BindingRebuildService(prisma as never, repo as never);
  const runner = new ProjectionBackfillRunner(prisma as never, rebuild as never);
  let dir: string;
  let cleanupDir: () => Promise<void>;
  let spool: CollabSpoolService;

  const hostOf = (doc: Y.Doc, name: string): CollabPersistenceHost => ({
    logger: new Logger('c3a8-c1'),
    getDocument: () => doc as never,
    docStats: () => ({ loadedDocs: 0, connections: 0, directConns: 0 }),
    onUpdateDelta: () => {},
    onFencedByWrite: vi.fn(async () => {}),
    calibrateTruth: () => undefined,
    observeDocBytes: () => {},
    isIsolated: () => false,
    isServingState: () => true,
    isShuttingDownFlag: () => false,
    onSpoolRecoveredFlip: () => {},
    currentLeaseEpoch: () => null,
  } as CollabPersistenceHost);

  /** 真 actor 装配（维护 sink；最小 host=projector int 同款）。generation=doc 名代（1→detached 维护
   *  路径〔doc 不在库键〕；0→normal 路径〔doc 在库 documents Map〕——两路径皆须透传 bindingUncovered）。 */
  function makeActor(doc: Y.Doc, name: string, generation = 0): CollabProjectActorService {
    const actor = new CollabProjectActorService(spool as never, repo as never);
    (actor as unknown as { bindHost(h: unknown): void }).bindHost({
      logger: new Logger('c3a8-c1-actor'),
      documents: () => new Map([[canvasDocName(pidOf(name), generation), doc]]),
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => generation,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    });
    return actor;
  }

type MaintSubmit = (projectId: string, payload: Uint8Array, opts?: { bindingUncovered?: boolean }) => Promise<unknown>;

  function makePersistence(doc: Y.Doc, name: string, actor: CollabProjectActorService, enqueue: ReturnType<typeof vi.fn>) {
    const svc = new CollabPersistenceService(repo as never, spool as never);
    svc.bindHost(hostOf(doc, name));
    // sink 透传第三参（修后签名扩展；本 cast 使红测在修前亦可编译运行=行为红非类型红）
    const submit: MaintSubmit = (pid, payload, opts) =>
      (actor as unknown as { submitMaintenance: MaintSubmit }).submitMaintenance(pid, payload, opts);
    (svc as unknown as { setMaintenanceSink(fn: MaintSubmit): void }).setMaintenanceSink(submit);
    svc.setBindingRecoveryFace({ markDirty: async (pid) => runner.markDirty(pid), enqueue });
    svc.observeDocument(doc, pidOf(name), name);
    return svc;
  }

  const pidOf = (name: string) => name.slice('project:'.length);
  const docName = (pid: string) => `project:${pid}`;

  const docState = (pid: string) => prisma.canvasDoc.findUnique({
    where: { projectId: pid },
    select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true, generation: true },
  });

  async function seedHead(pid: string): Promise<void> {
    await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
    await prisma.canvasDoc.create({
      data: { projectId: pid, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
    });
  }

  beforeAll(async () => {
    for (const pid of [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX]) await ensureProjectFixture(prisma, pid);
    await prisma.media.deleteMany({ where: { id: M } });
    await prisma.media.create({
      data: { id: M, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a8/${M}`, originalName: 'm.png', mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
    ({ dir, cleanup: cleanupDir } = await makeSpoolDir('c3a8-c1-'));
  });

  beforeEach(async () => {
    spool = new CollabSpoolService(dir);
    spool.setOwner('c3a8-c1-owner');
    await ensureLeaseFixture(prisma, repo);
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
  });

  afterEach(async () => { /* runner 无定时器（onModuleInit 未调）——无需 shutdown；suite 级复用 */ });

  afterAll(async () => {
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: { in: [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX] } } });
    await prisma.media.deleteMany({ where: { id: M } });
    await restoreLeaseRow(prisma);
    for (const pid of [PID_HEAD, PID_LAZY, PID_DIRECT, PID_PLAIN, PID_MIX]) await cleanupProjectFixture(prisma, pid);
    await cleanupDir();
    await prisma.$disconnect();
  });

  it('①有头行：import apply→维护 flush→dirty=true∧mediaBindingSeq=0∧无 binding 行（假覆盖根修）→rebuild 收敛', async () => {
    await seedHead(PID_HEAD);
    const doc = new Y.Doc();
    const name = docName(PID_HEAD);
    const actor = makeActor(doc, name, 1);   // detached 维护路径（doc 不在库键）
    const enqueue = vi.fn();
    const svc = makePersistence(doc, name, actor, enqueue);
    // 模拟 recovery import：origin='import' 直写 live doc（真 Y.Doc update 监听入维护队列）
    Y.applyUpdate(doc, importDiff(), 'import');
    expect(svc.hasPendingWrites(PID_HEAD)).toBe(true);
    expect(await svc.storeDocumentUnlocked({ document: doc as never, documentName: name }, 'maintenance')).toBe(true);
    // 修前：dirty=false ∧ mediaBindingSeq=1（覆盖假声明）——本断言即红
    const s = await docState(PID_HEAD);
    expect(s).toMatchObject({ pgSeq: 1n, mediaBindingSeq: 0n, bindingsDirty: true });
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_HEAD } })).toBe(0);   // 导入引用未投影
    expect(enqueue).toHaveBeenCalledTimes(1);   // 队列清空后入队（enqueue 归 flush 路径）
    // 消费前 rebuild：binding 收敛 + dirty 清 + 水位齐
    expect(await runner.runProject(PID_HEAD)).toBe('done');
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_HEAD, nodeId: 'n-imp', targetField: 'fileId', mediaId: M } })).toBe(1);
    expect(await docState(PID_HEAD)).toMatchObject({ pgSeq: 1n, mediaBindingSeq: 1n, bindingsDirty: false });
    doc.destroy();
  }, 60_000);

  it('②无头行（懒建档）：import 维护帧→行建 ∧ dirty=true ∧ mediaBindingSeq=0（修前 covered=true 形态红）→rebuild 收敛', async () => {
    const doc = new Y.Doc();
    const name = docName(PID_LAZY);
    const actor = makeActor(doc, name, 1);   // detached 维护路径（懒建档）
    const enqueue = vi.fn();
    const svc = makePersistence(doc, name, actor, enqueue);
    Y.applyUpdate(doc, importDiff('n-lazy'), 'import');
    expect(await svc.storeDocumentUnlocked({ document: doc as never, documentName: name }, 'maintenance')).toBe(true);
    const s = await docState(PID_LAZY);
    expect(s).toMatchObject({ pgSeq: 1n, mediaBindingSeq: 0n, bindingsDirty: true });   // 懒建档 covered=false 两列落定
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_LAZY } })).toBe(0);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await runner.runProject(PID_LAZY)).toBe('done');
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_LAZY, nodeId: 'n-lazy', targetField: 'fileId', mediaId: M } })).toBe(1);
    expect(await docState(PID_LAZY)).toMatchObject({ pgSeq: 1n, mediaBindingSeq: 1n, bindingsDirty: false });
    doc.destroy();
  }, 60_000);

  it('③sink 签名透传：actor.submitMaintenance(pid,diff,{bindingUncovered:true})→未覆盖态（脏+水位不动）；普通维护帧负控=covered（水位推进）', async () => {
    await seedHead(PID_DIRECT);
    const doc = new Y.Doc();
    const name = docName(PID_DIRECT);
    const actor = makeActor(doc, name);
    // 直接经 sink 面（gateway 接线等价形态）：申报未覆盖
    await (actor as unknown as { submitMaintenance(p: string, u: Uint8Array, o?: { bindingUncovered?: boolean }): Promise<unknown> })
      .submitMaintenance(PID_DIRECT, importDiff('n-direct'), { bindingUncovered: true });
    expect(await docState(PID_DIRECT)).toMatchObject({ pgSeq: 1n, mediaBindingSeq: 0n, bindingsDirty: true });
    expect(await runner.runProject(PID_DIRECT)).toBe('done');
    expect(await docState(PID_DIRECT)).toMatchObject({ mediaBindingSeq: 1n, bindingsDirty: false });

    // 负控：普通维护帧（非 import）保持 covered=true（禁把服务端投递写全部改脏）
    await seedHead(PID_PLAIN);
    const doc2 = new Y.Doc();
    const name2 = docName(PID_PLAIN);
    const actor2 = makeActor(doc2, name2);
    await (actor2 as unknown as { submitMaintenance(p: string, u: Uint8Array, o?: { bindingUncovered?: boolean }): Promise<unknown> })
      .submitMaintenance(PID_PLAIN, plainDiff(), {});
    expect(await docState(PID_PLAIN)).toMatchObject({ pgSeq: 1n, mediaBindingSeq: 1n, bindingsDirty: false });
    doc.destroy(); doc2.destroy();
  }, 60_000);

  it('④混批前缀（coordinator 补充）：connection 帧（媒体 delta）+import 维护帧同批→delta 正常投影（n-conn 行在）∧dirty=true∧水位不动∧rebuild 收敛（n-imp 行出现）', async () => {
    await seedHead(PID_MIX);
    const doc = new Y.Doc();
    const name = docName(PID_MIX);
    const actor = makeActor(doc, name);   // normal 路径（doc 在库键；generation=0）
    const conn = { socketId: 'c3a8-mix-conn', readOnly: false, sendStateless: vi.fn() };
    // 同 tick 双提交 → drain 微任务合批（mixed prefix：connection 帧 + 未覆盖维护帧）
    const pConn = actor.submit(PID_MIX, connFrame('n-conn'), conn as never, 'update');
    const pMaint = (actor as unknown as { submitMaintenance(p: string, u: Uint8Array, o?: { bindingUncovered?: boolean }): Promise<unknown> })
      .submitMaintenance(PID_MIX, importDiff('n-imp'), { bindingUncovered: true });
    await Promise.all([pConn, pMaint]);
    // 混批：connection delta 照常投影（n-conn 行在）；未覆盖申报→dirty=true ∧ 帧水位推进但 binding 水位不推
    const s = await docState(PID_MIX);
    expect(s).toMatchObject({ pgSeq: 2n, mediaBindingSeq: 0n, bindingsDirty: true });
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_MIX, nodeId: 'n-conn', targetField: 'referenceImage', mediaId: M } })).toBe(1);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_MIX, nodeId: 'n-imp' } })).toBe(0);
    // rebuild 收敛：导入引用出现 + 水位齐 + dirty 清
    expect(await runner.runProject(PID_MIX)).toBe('done');
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_MIX, nodeId: 'n-imp', targetField: 'fileId', mediaId: M } })).toBe(1);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID_MIX, nodeId: 'n-conn', targetField: 'referenceImage', mediaId: M } })).toBe(1);
    expect(await docState(PID_MIX)).toMatchObject({ pgSeq: 2n, mediaBindingSeq: 2n, bindingsDirty: false });
    doc.destroy();
  }, 60_000);
});
