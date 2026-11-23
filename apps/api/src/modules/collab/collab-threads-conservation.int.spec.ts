// apps/api/src/modules/collab/collab-threads-conservation.int.spec.ts
// Y4b T8（plan 2026-11-22-y4b-annotation-security Task 8——spec §0 条 2/7）：schema 5→6 硬切
// api 侧+threads 守恒三面（canary/维护 hash/oracle）+装载缝物化 int 池。
//  六档（brief Step 1 逐字）：
//  ①版本门拒载档：行值 sv=5 拒+消息正则 schemaVersion=5+被拒文档断言节点数 0（拒载先于重放
//    ——被拒文档上不该有 threads 根）；放行档：share.has('threads') 与现有 share.has('timelines')
//    并排（通过档维持读常量）。
//  ②装载缝：loadDocument 后 share.has('threads')（现状红——水合走 applyUpdate 不经 fillDoc，
//    T7 fillDoc 物化只盖种子/重建面）。
//  ③守恒负控 A7′+Review Focus 4：双 doc 同 threads 内容→副本少一条评论 ⇒ vacuumEquivalent
//    false+canonicalDocView 摘要不+；副本仅一条线程 resolved 翻转（不删条目）⇒ 等价仍 false
//    （防手挑字段实现——resolved 必须进守恒面）。
//  ④oracle：SCAN_ROOTS 断言含 threads（现状红=threads 根不进扫描域——threads 域 UUID 形态
//    string 叶〔评论 id 直值——整串匹配口径 body 内嵌子串不采〕不采即删除保护漏腿）。
//  ⑤actor：threads observeDeep 物化档——非法 threads 事件可达 L2（现状红=无观察者——threads
//    事件零缓冲=validateAppliedL2 恒不见，fail-closed 谓词不可达=threads 毒帧静默落 doc）。
//  ⑥c3a SQL 断言归 c3a-schema.int.spec（同池同批）。
// 装置：真 gateway 直构（load-rescan.int 先例——residency.withSession 生产读面装载）+
//   rebuildDocFaithful/vacuumEquivalent DR 直调（t12-vacuum.int buildKit 先例）+oracle
//   scanProject 真扫（oracle-worker.int ⑦ 同族形态）+FrameEffectsCollector 单元镜像
//   （binding-delta.spec applyFrame 先例）。
// 运行：DATABASE_URL=postgresql://… pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabSpoolService } from './collab-spool.service';
import { spoolForTest } from '../../test-utils/erasure-fixtures';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { createCanvasDoc } from './canvas-doc.factory';
import { canonicalDocView, stableStringify, exportThreadsView } from './collab-canary-semantic';
import { OracleWorkerService } from './oracle-worker.service';
import { FrameEffectsCollector } from './collab-project-actor.service';
import { buildThreadEntry, buildThreadComment, validateAppliedL2, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { mkdtemp, rm } from 'node:fs/promises';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const UID = 'u-y4b-t8';
const TID = 'y4b-t8-team';
const PID = 'y4b-t8-conservation';

/** 线程夹具（T6 工厂单源——kind='node' 两锚缺席档；held-ref 形态：工厂 entry 先持后挂根）。
 *  base 形态：一线程 t1 两评论（c1/c2）——A7′ 负控=副本少 c2。 */
function threadsBaseDoc(resolved: boolean): Y.Doc {
  const doc = createCanvasDoc();
  seedThreads(doc, resolved);
  return doc;
}

/** threads 根播种（T7 held-ref 形态：自建 comments 容器覆写工厂预建〔同引用持有——detached
 *  Y.Map.get 不可达〕，评论先写后 attach 根）。base 形态：一线程 t1 两评论（c1/c2）。 */
function seedThreads(doc: Y.Doc, resolved: boolean): void {
  const comments = new Y.Map<unknown>();
  const entry = buildThreadEntry({
    id: 't1', nodeId: 'n1', kind: 'node', resolved, createdAt: 1_000, createdBy: UID,
  });
  entry.set('comments', comments);   // 覆写工厂预建容器=同引用持有（frame-deny.spec legalThreadMap 同款）
  comments.set('c1', buildThreadComment({ id: 'c1', authorId: UID, body: '第一条评论', createdAt: 1_001 }));
  comments.set('c2', buildThreadComment({ id: 'c2', authorId: UID, body: '第二条评论', createdAt: 1_002 }));
  doc.getMap('threads').set('t1', entry);
}

maybe('Y4b T8：schema 5→6 硬切+threads 守恒三面（真 gateway+真 PG）', () => {
  let prisma: PrismaClient;
  let repo: CanvasDocUpdateRepository;
  let gateway: CollabGateway;
  let residency: CollabResidencyService;
  let spoolDir = '';

  const loadDoc = async (pid: string): Promise<Y.Doc> =>
    residency.withSession(pid, (doc) => doc, { mode: 'read' });

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as never);
    await prisma.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, name: 'y4bt8', email: 'y4bt8@local.test', emailVerified: true } });
    await prisma.team.upsert({ where: { id: TID }, update: {}, create: { id: TID, name: 'y4b-t8', ownerId: UID } });
    await prisma.teamMember.upsert({ where: { teamId_userId: { teamId: TID, userId: UID } }, update: {}, create: { teamId: TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.upsert({ where: { id: PID }, update: {}, create: { id: PID, name: 'y4b-t8', userId: UID, teamId: TID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await ensureLeaseFixture(prisma, repo, 'stub-owner-1');
    spoolDir = await mkdtemp(join(tmpdir(), 'y4b-t8-cons-'));
    const spool = spoolForTest(spoolDir);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: TID }),
    };
    gateway = new CollabGateway(
      prisma as never, new EventEmitter2() as never, repo,
      createLeaseStub({}, { repo: repo as never, spool: spool as never }) as never,
      perm as never, 0, 10_000, undefined, undefined, spool,
    );
    await gateway.onModuleInit();
    residency = new CollabResidencyService(gateway);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => undefined);
    await (gateway as never as { server?: { destroy(): Promise<void> } })?.server?.destroy?.().catch?.(() => undefined);
    await rm(spoolDir, { recursive: true, force: true }).catch(() => undefined);
    await prisma?.canvasDocUpdate.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.canvasDocSnapshot.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.canvasDoc.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.canvasProject.deleteMany({ where: { id: PID } }).catch(() => undefined);
    await prisma?.teamMember.deleteMany({ where: { teamId: TID, userId: UID } }).catch(() => undefined);
    await prisma?.team.deleteMany({ where: { id: TID } }).catch(() => undefined);
    await prisma?.user.deleteMany({ where: { id: UID } }).catch(() => undefined);
    await restoreLeaseRow(prisma).catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
  }, 30_000);

  // ── ①+②：版本门 sv=5 拒载档+放行档 threads 物化（装载缝）──
  it('①版本门：行值 sv=5（Y4a 档——bump 6 后即旧）拒载+消息正则 schemaVersion=5+被拒文档零重放残留（节点数 0——拒载先于重放，被拒文档无 threads 根）', async () => {
    // 布景：sv=5 旧行+带节点 state（拒绝档判于 replay 前——节点不 apply）
    const legacy = createCanvasDoc();
    try {
      legacy.getMap('nodes').set('n-old', new Y.Map([['type', 'textInput']]));
      await repo.appendBatch(PID, [seedRow(Y.encodeStateAsUpdate(legacy), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
      await prisma.canvasDoc.update({ where: { projectId: PID }, data: { schemaVersion: 5 } });
    } finally { legacy.destroy(); }
    const refused = new Y.Doc();
    try {
      await expect(gateway.docRegistry.loadDocument({ document: refused, documentName: `project:${PID}` } as never))
        .rejects.toMatchObject({ reason: 'schema-outdated', schemaRefusal: true });
      // 消息正则：列门判据=PG 行值 5（非 doc meta）
      await expect(gateway.docRegistry.loadDocument({ document: refused, documentName: `project:${PID}` } as never))
        .rejects.toThrow(/CanvasDoc\.schemaVersion=5/);
      // 被拒文档零重放残留：state 含 n-old 但未 apply；被拒文档上不该有 threads 根（拒载先于重放
      // 与装载物化两段——version-gate.spec :150/:183 零残留断言同款）
      expect([...refused.getMap('nodes').keys()]).toHaveLength(0);
      expect(refused.share.has('threads')).toBe(false);
    } finally { refused.destroy(); }
  }, 60_000);

  it('②装载缝：行值=6（当前——回写布景）放行且装载后 threads 根物化（share.has 与 timelines 并排——SERVER_TRANSACT_ORIGIN 空事务补根）', async () => {
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { schemaVersion: CANVAS_DOC_SCHEMA_VERSION } });
    const doc = await loadDoc(PID);
    // 放行档：装载链补 threads 根（现状红——T8 装载缝落位前 share 只有五根）
    expect(doc.share.has('threads')).toBe(true);
    // 现有 timelines 物化锚并排保留（Y4a T2 装载缝不破——回归锁）
    expect(doc.share.has('timelines')).toBe(true);
    // 水合内容照常（n-old 在——装载拒绝档已解除）
    expect([...doc.getMap('nodes').keys()]).toContain('n-old');
    await residency.releaseSessionFor(PID).catch(() => undefined);
  }, 60_000);

  // ── ③守恒负控 A7′+Review Focus 4：vacuumEquivalent threads 内容深比+canonicalDocView threads 腿 ──
  it('③守恒负控：副本少一条评论 ⇒ vacuumEquivalent false+canonicalDocView 摘要不+；仅 resolved 翻转 ⇒ 等价仍 false（防手挑字段——resolved 必须进守恒面）', async () => {
    const a = threadsBaseDoc(false);
    try {
      // A7′ 1：rebuild 拷贝器产 clean 对照组（等价基线——内容比较不引入假红）
      const clean = gateway.rebuildDocFaithful(a);
      expect(clean).not.toBeNull();
      try {
        expect(gateway.vacuumEquivalent(a, clean!)).toBe(true);
        // canonicalDocView threads 腿（摘要面——a 与 clean 同内容必等；「摘要不+」判据=副本变异后）
      } finally { clean!.destroy(); }
      // A7′ 2：副本少一条评论（c2 被漏拷形态——深拷贝漏拷片段同族负控）⇒ 等价 false+摘要不+
      const dropOne = gateway.rebuildDocFaithful(a)!;
      try {
        ((dropOne.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).delete('c2');
        expect(gateway.vacuumEquivalent(a, dropOne), '少一条评论=语义不等（修前 threads 不在守恒面 ⇒ true=红）').toBe(false);
        expect(canonicalDocView(a) === canonicalDocView(dropOne)).toBe(false);
      } finally { dropOne.destroy(); }
      // A7′ 3：仅 resolved 翻转（不删条目——防手挑字段实现：resolved 必须进守恒面）
      const flip = gateway.rebuildDocFaithful(a)!;
      try {
        (flip.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', true);
        expect(gateway.vacuumEquivalent(a, flip), 'resolved 翻转=语义不等（手挑字段实现漏 resolved ⇒ true=红）').toBe(false);
        expect(canonicalDocView(a) === canonicalDocView(flip)).toBe(false);
      } finally { flip.destroy(); }
      // 对照组：同内容副本恒等价——内容比较无假阳性（clean rebuild 第二份〔同 threads 内容〕
      // ——side-effect 派生根〔toReadModel 物化 nodes/edges〕两侧同经本函数规约化，shapeOf 恒等）。
      const clean2 = gateway.rebuildDocFaithful(a)!;
      try {
        expect(stableStringify(exportThreadsView(a.getMap('threads')))).toBe(stableStringify(exportThreadsView(clean2.getMap('threads'))));
        expect(gateway.vacuumEquivalent(a, clean2)).toBe(true);
      } finally { clean2.destroy(); }
    } finally { a.destroy(); }
  }, 60_000);
});

// ══ ④oracle：SCAN_ROOTS 扩 threads（spec §3.2 表 oracle 行——新增可写根必须同步扩扫描域）═══
//  装置：oracle-worker.int.spec ⑦ 同族形态（真 PG scanProject 真扫+oracle 行 JOIN 过滤断言面）。
const PID_ORACLE = 'y4b-t8-oracle';
const THREAD_MEDIA_UUID = '3f1a2b4c-1111-4222-8333-444455556666';   // UUID 形态 media id（threads 评论 body 叶捕获断言面——JOIN 须有 Media 行）
const O_UID = 'u-y4bt8-oracle';
const O_TID = 'y4bt8-oracle-team';

maybe('Y4b T8 ④：oracle SCAN_ROOTS 含 threads（threads 域 string 叶照采——悬空 media 引用删除保护腿）', () => {
  let prisma: PrismaClient;
  let repo: CanvasDocUpdateRepository;
  let svc: OracleWorkerService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as never);
    svc = new OracleWorkerService(prisma as never, repo as never);
    await prisma.user.upsert({ where: { id: O_UID }, update: {}, create: { id: O_UID, name: 'y4bt8-o', email: 'y4bt8-o@local.test', emailVerified: true } });
    await prisma.team.upsert({ where: { id: O_TID }, update: {}, create: { id: O_TID, name: 'y4bt8-o', ownerId: O_UID } });
    await prisma.teamMember.upsert({ where: { teamId_userId: { teamId: O_TID, userId: O_UID } }, update: {}, create: { teamId: O_TID, userId: O_UID, role: 'OWNER' } });
    await prisma.canvasProject.upsert({ where: { id: PID_ORACLE }, update: {}, create: { id: PID_ORACLE, name: 'y4bt8-o', userId: O_UID, teamId: O_TID } });
    await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma.canvasDoc.create({ data: { projectId: PID_ORACLE, generation: 1, schemaVersion: CANVAS_DOC_SCHEMA_VERSION, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false } });
    await prisma.media.deleteMany({ where: { id: THREAD_MEDIA_UUID } }).catch(() => undefined);
    await prisma.media.create({ data: { id: THREAD_MEDIA_UUID, userId: O_UID, teamId: O_TID, key: `y4b-t8/${THREAD_MEDIA_UUID}`, originalName: 'm.png', mimeType: 'image/png', size: 1n, type: 'uploaded' } });
    await ensureLeaseFixture(prisma, repo);
    // 帧：nodes 根零内容、threads.t1 第三条评论 id=UUID 形态且有 Media 行（threads 域 string 叶
    // ——nodeId/createdBy/auth 或 id 皆合法承载；整串匹配口径=body 内嵌子串不采故用 id 叶直值）。
    const doc = createCanvasDoc();
    try {
      seedThreads(doc, false);
      ((doc.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).set(
        THREAD_MEDIA_UUID,
        buildThreadComment({ id: THREAD_MEDIA_UUID, authorId: O_UID, body: '第三条评论（id 为 UUID 形态）', createdAt: 1_003 }),
      );
      await repo.appendBatch(PID_ORACLE, [seedRow(Y.encodeStateAsUpdate(doc), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    } finally { doc.destroy(); }
  }, 60_000);

  afterAll(async () => {
    await prisma?.canvasReferenceOracle.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma?.canvasReferenceOracleScan.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma?.canvasDocUpdate.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma?.canvasDocSnapshot.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma?.canvasDoc.deleteMany({ where: { projectId: PID_ORACLE } }).catch(() => undefined);
    await prisma?.media.deleteMany({ where: { id: THREAD_MEDIA_UUID } }).catch(() => undefined);
    await prisma?.canvasProject.deleteMany({ where: { id: PID_ORACLE } }).catch(() => undefined);
    await prisma?.teamMember.deleteMany({ where: { teamId: O_TID, userId: O_UID } }).catch(() => undefined);
    await prisma?.team.deleteMany({ where: { id: O_TID } }).catch(() => undefined);
    await prisma?.user.deleteMany({ where: { id: O_UID } }).catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
  }, 30_000);

  it('④SCAN_ROOTS 覆盖 threads 根：threads 域 UUID 形态 string 叶（评论 id 直值）入 oracle 行（仅 threads 引用也保护——现状红=threads 不在扫描域）', async () => {
    const r = await svc.scanProject(PID_ORACLE);
    expect(r).toMatchObject({ outcome: 'complete' });
    const rows = await prisma.canvasReferenceOracle.findMany({ where: { projectId: PID_ORACLE } });
    // 修前红：SCAN_ROOTS=['nodes','edges','timelines'] 不扫 threads ⇒ rows 不含 THREAD_MEDIA_UUID
    expect(rows.map((x) => x.mediaId)).toContain(THREAD_MEDIA_UUID);
  }, 60_000);
});

// ══ ⑤actor：threads observeDeep 物化档——非法 threads 事件可达 L2（fail-closed 谓词接线前置）═══
//  装置：FrameEffectsCollector 单元镜像（binding-delta.spec applyFrame 先例——begin→apply→takeEvents
//  →validateAppliedL2）。现状红=收集器无 threads 观察者 ⇒ 事件零缓冲 ⇒ L2 恒不见 threads 事件
//  （fail-closed 谓词〔T7 已建 threadEventErr〕不可达=threads 毒帧静默落 doc）。
describe('Y4b T8 ⑤：actor threads observeDeep 物化档（非法 threads 事件可达 L2）', () => {
  /** 事务帧构造（binding-delta.spec frameOf 同款——单事务增量 update）。 */
  function frameOf(mutate: (src: Y.Doc) => void, base?: Uint8Array): Uint8Array {
    const src = new Y.Doc();
    try {
      if (base !== undefined) Y.applyUpdate(src, base);
      const ups: Uint8Array[] = [];
      src.on('update', (u: Uint8Array) => { ups.push(u); });
      src.transact(() => { mutate(src); });
      return Y.mergeUpdates(ups);
    } finally { src.destroy(); }
  }

  it('⑤threads 事件进收集器事件缓冲 ⇒ 非法帧（已有评论改 body）被 validateAppliedL2 拒（现状红=无观察者——事件零缓冲、L2 放行 {ok:true}）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    // 基帧：合法线程 t1（T7 held-ref 形态——自建 comments 覆写工厂预建同引用持有）
    const base = frameOf((src) => {
      const comments = new Y.Map<unknown>();
      const entry = buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 1_000, createdBy: 'u1' });
      entry.set('comments', comments);
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: 'u1', body: '首条', createdAt: 1_001 }));
      src.getMap('threads').set('t1', entry);
    });
    c.begin(1n);
    Y.applyUpdate(doc, base);
    expect(c.takeEvents().length).toBeGreaterThan(0);   // 装置自证：threads 根级 add 事件已入缓冲
    // 非法帧：已有评论 c1 上 set body（L2 path=[t1,comments,c1] 再深档——动作矩阵全拒）
    const poison = frameOf((src) => {
      (((src.getMap('threads').get('t1') as Y.Map<unknown>).get('comments') as Y.Map<unknown>).get('c1') as Y.Map<unknown>).set('body', '篡改正文');
    }, base);
    c.begin(2n);
    Y.applyUpdate(doc, poison);
    const events = c.takeEvents();
    expect(events.length, 'threads 事件必须进缓冲（现状红=无观察者零缓冲）').toBeGreaterThan(0);
    const verdict = validateAppliedL2(doc, events, { actorUserId: 'u1' });
    expect(verdict.ok, '非法 threads 事件可达 L2 ⇒ fail-closed 谓词拒（现状红=L2 恒不见事件放行 {ok:true}）').toBe(false);
  });

  it('⑤对照档：合法 resolved 翻转帧被 validateAppliedL2 放行（事件缓冲面不引入假阳性）', () => {
    const c = new FrameEffectsCollector();
    const doc = new Y.Doc();
    c.install(doc);
    const base = frameOf((src) => {
      const comments = new Y.Map<unknown>();
      const entry = buildThreadEntry({ id: 't1', nodeId: 'n1', kind: 'node', resolved: false, createdAt: 1_000, createdBy: 'u1' });
      entry.set('comments', comments);
      comments.set('c1', buildThreadComment({ id: 'c1', authorId: 'u1', body: '首条', createdAt: 1_001 }));
      src.getMap('threads').set('t1', entry);
    });
    c.begin(1n);
    Y.applyUpdate(doc, base);
    c.takeEvents();
    const legal = frameOf((src) => {
      (src.getMap('threads').get('t1') as Y.Map<unknown>).set('resolved', true);
    }, base);
    c.begin(2n);
    Y.applyUpdate(doc, legal);
    const verdict = validateAppliedL2(doc, c.takeEvents(), { actorUserId: 'u1' });
    expect(verdict.ok).toBe(true);
  });
});
