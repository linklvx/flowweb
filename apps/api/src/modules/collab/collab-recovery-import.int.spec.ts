// apps/api/src/modules/collab/collab-recovery-import.int.spec.ts
// Y1c T25（plan v1.7 Task 25——spec §3.2/§4.5）：recovery import REST 服务面真库用例。
// ★红对=「g_client>g_server 静默 purge（导出→reload 缺接受路径）」的服务端半边：恢复导入=
// **唯一接受路径**（DraftEnvelope ≤8MiB+OWNER/EDITOR+幂等键+候选 doc 全量校验——唯一允许 clone
// 场所；origin='import' 计数接线=T24 移交#5）。装置承 collab-write-endpoint.int.spec（真 gateway/
// residency/repo+真 PG+装载重放读侧）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabSpoolService } from './collab-spool.service';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabLifecycleObserverService } from './collab-lifecycle-observer.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { CollabRecoveryImportController } from './collab-recovery-import.controller';
import { applyRecoveryImportBodyLimit } from '../../common/recovery-import-body-limit';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabRecoveryImportService } from './collab-recovery-import.service';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { pollUntil } from '../../test-utils/poll-until';
import { PrismaService } from '../../prisma/prisma.service';
import {
  rebuildCanvasDoc, serializeCanvas, CANVAS_DOC_SCHEMA_VERSION,
  DRAFT_ENVELOPE_MAX_BYTES, resolveImportNodeConflicts,
} from '@flowweb/shared';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y1c-t25-recov';
const UID = 'u-t25-owner';

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let residency: CollabResidencyService;
let spoolDir: string;
let svc: CollabRecoveryImportService;
let docs: CollabDocumentService;
let observer: CollabLifecycleObserverService;
let feed: RuntimeFeedService;
let app: INestApplication;
let baseUrl = '';

async function reviveFromPg(pid: string): Promise<Y.Doc> {
  const { state, updates } = await repo.loadForHydration(pid);
  const revived = new Y.Doc();
  if (state) Y.applyUpdate(revived, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
  return revived;
}
async function flush(pid: string): Promise<void> {
  // origin='import' 写走 persistence 维护通道（250ms debounce——flushPendingStores 只强制库
  // debounce 队列不覆盖该面）：先等维护窗到期再强制+轮询（否则 isPersistedComplete 早真=读旧 PG）
  await new Promise((r) => setTimeout(r, 350));
  gateway.server.hocuspocus.flushPendingStores();
  await pollUntil(() => gateway.isPersistedComplete(pid), 5_000);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function envelopeOf(nodes: Array<{ id: string; type?: string }>, edges: Array<{ id: string; source?: string; target?: string }> = [], over: Record<string, unknown> = {}) {
  // canonical 域容器形态（textInput.prompt=Y.Map{text:Y.Text}——$yjs 标签快照；plain string=
  // 域容器异形=L1 container-replacement 正当拒——负控用例另设）
  const PROMPT_CANONICAL = { $yjs: 'map', entries: { text: { $yjs: 'text', delta: [{ insert: 'recover' }] } } };
  const doc = rebuildCanvasDoc({
    nodes: nodes.map((n) => ({
      id: n.id, type: n.type ?? 'textInput', position: { x: 1, y: 2 },
      data: { prompt: PROMPT_CANONICAL },
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    meta: {},
  });
  const canvas = serializeCanvas(doc);
  return {
    draftId: 'draft-t25-1',
    projectId: PID,
    generation: 2,
    schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
    historyId: 'hist-t25',
    capturedAtMs: Date.now(),
    tabId: 'tab-t25',
    nodes: canvas.nodes,
    edges: canvas.edges,
    meta: {},
    hashes: { nodes: sha(JSON.stringify(canvas.nodes)), edges: sha(JSON.stringify(canvas.edges)) },
    ...over,
  };
}

maybe('Y1c T25 recovery import REST 服务面（真 gateway+真 PG——唯一接受路径）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as unknown as PrismaService);
    await ensureProjectFixture(prisma, PID);
    // T26 卫生先例：跨 run 残留行 wipe（RuntimeEvent/feedSeq cursor/生命周期三表——PID 常量共享
    // dev 库，残留 cursor/events 碰 (projectId,feedSeq) 唯一约束）
    await prisma.runtimeEvent.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.nodeLifecycle.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.deliveryFence.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await ensureLeaseFixture(prisma, repo, 'stub-owner-1');   // lease-stub 契约：owner 必须与 createLeaseStub 硬编码 'stub-owner-1' 一致（异值=fenced-by-write 自隔离——write-endpoint 先例同款）
    spoolDir = await mkdtemp(join(tmpdir(), 't25-recov-'));
    const spool = new CollabSpoolService(spoolDir);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
    };
    const port = 20000 + Math.floor(Math.random() * 20000);
    observer = new CollabLifecycleObserverService(prisma as unknown as PrismaService);
    feed = new RuntimeFeedService(prisma as unknown as PrismaService);
    // closeout I-5：actor 经 11 参注入带 observer（module DI 面等价——播种/重对齐链在位）
    const actor = new CollabProjectActorService(spool, repo as never, undefined, observer);
    // 位置参数序：…(10)spool (11)quota (12)pgBreaker (13)persistence (14)docRegistry (15)sessionGuard (16)projectActor
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, repo,
      createLeaseStub({}, { repo: repo as any, spool: spool as any }) as any,
      perm as any, port, 10_000, undefined, undefined, spool,
      undefined, undefined, undefined, undefined, undefined, actor,
    );
    await gateway.onModuleInit();
    residency = new CollabResidencyService(gateway);
    docs = new CollabDocumentService(gateway, repo, residency, feed, observer);
    svc = new CollabRecoveryImportService(docs, prisma as unknown as PrismaService, observer);   // 收口 I-5：观察器接线（staleFence 标记面）
    // closeout C-2：真实 HTTP 解析层（Nest 测试应用真监听——controller 挂真 svc；body limit 装置
    // 与 main.ts 同源 applyRecoveryImportBodyLimit——红测先不加，绿形由实现批补齐后启用）
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabRecoveryImportController],
      providers: [
        { provide: CollabRecoveryImportService, useValue: svc },
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectPermissionService, useValue: { assertEditor: vi.fn(async () => undefined) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    applyRecoveryImportBodyLimit(app);   // 收口 C-2 绿形：与 main.ts 同源 wiring（红=注释本行重跑 3a 得 413）
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    // 种子既有节点 n-exist（真会话写——装载+observeDocument 接线面）
    await residency.withSession(PID, (doc) => {
      const m = new Y.Map();
      m.set('type', 'textInput');
      m.set('data', new Y.Map([['prompt', 'seed']]));
      doc.getMap('nodes').set('n-exist', m);
    }, { mode: 'write' });
    await flush(PID);
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await prisma?.runtimeEvent.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.runtimeFeedCursor.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.nodeLifecycle.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.deliveryFence.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.canvasDocUpdate.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid);
    await (gateway as any)?.server.destroy();
    await rm(spoolDir, { recursive: true, force: true }).catch(() => undefined);
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma?.$disconnect();
  }, 30_000);

  it('★红②服务端半边：DraftEnvelope 导入=接受路径（import-as-new：新节点落 PG+悬挂边丢弃报告+三行确认面+origin=import 计数）', async () => {
    const { register } = await import('prom-client');
    const originMetric: any = register.getSingleMetric('doc_update_origin_total');
    const importCountBefore = (await originMetric.get()).values.find((v: any) => v.labels.origin === 'import')?.value ?? 0;

    const env = envelopeOf(
      [{ id: 'n-new-a' }, { id: 'n-new-b' }],
      [{ id: 'e-ok', source: 'n-new-a', target: 'n-new-b' }, { id: 'e-dangle', source: 'n-new-a', target: 'n-missing' }],
    );
    const out = await svc.importEnvelope(PID, UID, env);
    // 确认面三行（§4.5 C 行——固定三行）
    expect(out.confirmation.contentCounts).toEqual({ nodeCount: 2, edgeCount: 2 });
    expect(out.confirmation.droppedRefs.danglingEdges).toBe(1);
    expect(out.confirmation.notRestored).toEqual({ artifacts: true, executionHistory: true, billingRecords: true });
    // 逐节点三分派（#9 默认 skip——无冲突全 import）
    expect(out.dispositions.filter((d) => d.disposition === 'import').map((d) => d.nodeId).sort())
      .toEqual(['n-new-a', 'n-new-b']);

    await flush(PID);
    const revived = await reviveFromPg(PID);
    expect(revived.getMap('nodes').has('n-new-a')).toBe(true);
    expect(revived.getMap('nodes').has('n-new-b')).toBe(true);
    // 悬挂边丢弃（e-dangle 不落库——「边指向缺失节点丢弃并报告」）
    expect(revived.getMap('edges').has('e-ok')).toBe(true);
    expect(revived.getMap('edges').has('e-dangle')).toBe(false);
    // 既有节点不受波及
    expect((revived.getMap('nodes').get('n-exist') as Y.Map<any>).get('data').get('prompt')).toBe('seed');
    // T24 移交#5：origin=import 计数接线（doc_update_origin_total{origin='import'}——修前零调用面）
    const importCountAfter = (await originMetric.get()).values.find((v: any) => v.labels.origin === 'import')?.value ?? 0;
    expect(importCountAfter).toBeGreaterThan(importCountBefore);
  }, 60_000);

  it('幂等（draftId 键幂等：重试同结果）+nodeId 冲突默认 skip（#9——同 envelope 二次导入零新写）', async () => {
    const env = envelopeOf([{ id: 'n-idem' }], [], { draftId: 'draft-t25-idem' });
    const first = await svc.importEnvelope(PID, UID, env);
    expect(first.dispositions[0]).toEqual({ nodeId: 'n-idem', disposition: 'import' });
    const second = await svc.importEnvelope(PID, UID, env);   // 同 draftId 重试
    expect(second.resultReplayed).toBe(true);                  // 幂等回放（重试同结果）
    await flush(PID);
    const revived = await reviveFromPg(PID);
    expect(revived.getMap('nodes').has('n-idem')).toBe(true);
    // 冲突默认 skip（#9）：新 draftId 同 nodeId——不替换不自动改 ID
    const conflictEnv = envelopeOf([{ id: 'n-idem' }], [], { draftId: 'draft-t25-conflict' });
    const conflict = await svc.importEnvelope(PID, UID, conflictEnv);
    const byId = Object.fromEntries(conflict.dispositions.map((d: any) => [d.nodeId, d.disposition]));
    expect(byId).toEqual({ 'n-idem': 'skip' });
    await flush(PID);
    const after = await reviveFromPg(PID);
    expect((after.getMap('nodes').get('n-idem') as Y.Map<any>).get('data').get('prompt').toJSON()).toEqual({ text: 'recover' });   // 首导入原值（skip 未替换）
  }, 60_000);

  it('★t25b-I3 删除确认经 typed REST 承载（deletionNodeIds：服务端现存节点删除+幂等缺档跳过+edits 报告）——修前参数被忽略节点残留（红）', async () => {
    // 服务端现存 n-del（信封缺席面=用户本地已删的删除确认候选）
    await residency.withSession(PID, (doc) => {
      const m = new Y.Map();
      m.set('type', 'textInput');
      m.set('data', new Y.Map([['prompt', 'to-delete']]));
      doc.getMap('nodes').set('n-del', m);
    }, { mode: 'write' });
    await flush(PID);
    const env = envelopeOf([{ id: 'n-i3-new' }], [], { draftId: 'draft-t25b-i3' });
    const out = await svc.importEnvelope(PID, UID, env, undefined, undefined, ['n-del', 'n-ghost']);
    expect(out.deletions).toEqual({ requested: 2, applied: 1 });   // n-ghost 缺档幂等跳过（修前：无 deletions 报告——红）
    await flush(PID);
    const revived = await reviveFromPg(PID);
    expect(revived.getMap('nodes').has('n-del')).toBe(false);   // 修前：节点残留（红锚）
    expect(revived.getMap('nodes').has('n-i3-new')).toBe(true);   // 新增导入照常
  }, 60_000);

  it('replace 用户选（冲突节点替换——nodeId 稳定不重映射）', async () => {
    const env = envelopeOf([{ id: 'n-exist' }], [], { draftId: 'draft-t25-replace' });
    const out = await svc.importEnvelope(PID, UID, env, { 'n-exist': 'replace' });
    expect(out.dispositions[0]).toEqual({ nodeId: 'n-exist', disposition: 'replace' });
    await flush(PID);   // I-3 收口：同族 flush() 助手（350ms 维护窗等待+强制+isPersistedComplete 轮询——裸 pollUntil 竞态根除）
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n-exist') as Y.Map<any>).get('data').get('prompt').toJSON()).toEqual({ text: 'recover' });
  }, 60_000);

  it('负控：projectId 错配 400/完整性 hash 不匹配 400/超 8MiB 413 fail-closed', async () => {
    const foreign = envelopeOf([{ id: 'n-x' }], [], { projectId: 'other-pid' });
    await expect(svc.importEnvelope(PID, UID, foreign)).rejects.toMatchObject({ status: 400 });
    const tampered = envelopeOf([{ id: 'n-t' }], [], {
      draftId: 'draft-t25-tamper',
      hashes: { nodes: 'f'.repeat(64), edges: 'f'.repeat(64) },   // 非零填充错值（零填充=诚实占位跳过比对——另档）
    });
    await expect(svc.importEnvelope(PID, UID, tampered)).rejects.toMatchObject({ status: 400 });
    const big = envelopeOf([{ id: 'n-big' }], [], { draftId: 'draft-t25-big' });
    big.meta = { padding: 'x'.repeat(DRAFT_ENVELOPE_MAX_BYTES + 1) };   // 载荷超限（>8MiB）
    await expect(svc.importEnvelope(PID, UID, big)).rejects.toMatchObject({ status: 413 });
  }, 30_000);

  it('负控：未知节点类型/未知 data 键=400（候选 doc 全量校验——L1 同表执法非兼容层）', async () => {
    const bad = envelopeOf([{ id: 'n-bad', type: 'nonexistentType' }], [], { draftId: 'draft-t25-bad' });
    await expect(svc.importEnvelope(PID, UID, bad)).rejects.toMatchObject({ status: 400 });
    const served = await reviveFromPg(PID);
    expect(served.getMap('nodes').has('n-bad')).toBe(false);
  }, 30_000);

  // ══════════ closeout 批（Controller T25 双评审裁定——同 describe 共享 beforeAll 装置）═══
  describe('T25 收口批（真 gateway+真 PG——HTTP 解析层/边冲突/生命周期洞）', () => {
  /** 真实 HTTP POST（真实解析层——undici fetch 面非直调）。 */
  const httpPost = async (body: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/collab/doc/${PID}/recovery-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

  it('★closeout-3a >100KB 信封经真实 HTTP 解析层→200（修前=Nest 默认 json 100kb 解析层 413——8MiB 契约档 100KB-8MiB 区间结构性不可用）', async () => {
    const env = envelopeOf([{ id: 'n-http' }], [], { draftId: 'draft-t25-http' });
    env.meta = { padding: 'x'.repeat(200_000) };   // ~200KB（>100kb 默认解析闸——ASCII 计量无歧义）
    const res = await httpPost(JSON.stringify({ envelope: env }));
    expect([200, 201]).toContain(res.status);   // Nest POST 默认 201；修前：body-parser 413 PayloadTooLarge（红）
    const out = await res.json();
    expect(out.confirmation.contentCounts.nodeCount).toBe(1);
    await flush(PID);
    expect((await reviveFromPg(PID)).getMap('nodes').has('n-http')).toBe(true);
  }, 60_000);

  it('★closeout-3b 字节计量：CJK 载荷 charCount<8MiB 但 utf8 字节>8MiB→413（修前 JSON.stringify().length 按 UTF-16 码元低估 ~3×=放行）', async () => {
    const env = envelopeOf([], [], { draftId: 'draft-t25-cjk' });
    env.meta = { padding: '漢'.repeat(3_000_000) };   // charCount≈3M<8_388_608；utf8≈9MB>上限
    await expect(svc.importEnvelope(PID, UID, env)).rejects.toMatchObject({ status: 413 });
  }, 30_000);

  it('★closeout-8 同 id 边冲突默认 skip（#9 默认保守侧——协作者改过的边禁静默覆盖）+edgeDispositions 报告', async () => {
    // 种子既有边 e-conf（n-exist→n-a）
    await residency.withSession(PID, (doc) => {
      const a = new Y.Map(); a.set('type', 'textInput'); a.set('data', new Y.Map([['prompt', 'seed']]));
      doc.getMap('nodes').set('n-a', a);
      const e = new Y.Map(); e.set('source', 'n-exist'); e.set('target', 'n-a');
      doc.getMap('edges').set('e-conf', e);
    }, { mode: 'write' });
    await flush(PID);
    // 信封：新节点 n-edge + 同 id 边 e-conf（分叉端点→指向 n-edge）+ 新边 e-new
    const env = envelopeOf(
      [{ id: 'n-edge' }],
      [{ id: 'e-conf', source: 'n-exist', target: 'n-edge' }, { id: 'e-new', source: 'n-a', target: 'n-edge' }],
      { draftId: 'draft-t25-edgeconf' },
    );
    const out = await svc.importEnvelope(PID, UID, env);
    // 修前：e-conf 被信封端点静默覆盖（红）+无 edgeDispositions
    const edgeById = Object.fromEntries((out.edgeDispositions ?? []).map((d: { edgeId: string; disposition: string }) => [d.edgeId, d.disposition]));
    expect(edgeById).toEqual({ 'e-conf': 'skip', 'e-new': 'import' });
    await flush(PID);
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('edges').get('e-conf') as Y.Map<any>).get('target')).toBe('n-a');   // 既有端点不动
    expect(revived.getMap('edges').has('e-new')).toBe(true);
  }, 60_000);

  it('★closeout-7 import 直写生命周期洞：同 doc 实例窗内导入节点→deliver unregistered 拒（拒因独立 surfaced）→下一 actor 帧批 staleFence 重播种→deliver 放行', async () => {
    // 前置：驱动一帧过 actor（首批播种 presence——lifecycleSeededDocs 在位，后续帧不再默认播种）
    const seedFrame = Y.encodeStateAsUpdate(rebuildCanvasDoc({
      nodes: [{ id: 'n-seeda', type: 'textInput', position: { x: 0, y: 0 }, data: { prompt: { $yjs: 'map', entries: { text: { $yjs: 'text', delta: [{ insert: 's' }] } } } } }],
      edges: [], meta: {},
    }));
    const r0 = await gateway.projectActor.submit(PID, seedFrame, { socketId: 'sock-t25-f0', readOnly: false } as never, 'update');
    await gateway.projectActor.flushThrough(PID, r0.walSeq, { maxWaitMs: 5_000 });

    // 导入 n-gen（withSession 直写——绕过 actor 帧管线=零 FrameEffects/零 NodeLifecycle 行）
    const env = envelopeOf([{ id: 'n-gen' }], [], { draftId: 'draft-t25-lifecycle' });
    await svc.importEnvelope(PID, UID, env);

    // 修前红锚 A：unregistered 拒因归并 'node-deleted'（不可观测分档）
    const first = await docs!.deliverArtifact(PID, {
      nodeId: 'n-gen', targetField: 'fileId', value: 'm-gen-1',
      exec: { status: 'done', attempts: 1, artifactRev: 1 },
    });
    expect(first.data).toMatchObject({ written: false, reason: 'fence-unregistered' });   // 修前 reason='node-deleted'（红）

    // 修前红锚 B：无 staleFence 标记——下一帧批不重对齐（presence 缺 n-gen）→重试交付仍拒
    const healFrame = Y.encodeStateAsUpdate(rebuildCanvasDoc({
      nodes: [{ id: 'n-seedb', type: 'textInput', position: { x: 1, y: 1 }, data: { prompt: { $yjs: 'map', entries: { text: { $yjs: 'text', delta: [{ insert: 't' }] } } } } }],
      edges: [], meta: {},
    }));
    const r1 = await gateway.projectActor.submit(PID, healFrame, { socketId: 'sock-t25-f1', readOnly: false } as never, 'update');
    await gateway.projectActor.flushThrough(PID, r1.walSeq, { maxWaitMs: 5_000 });

    const second = await docs!.deliverArtifact(PID, {
      nodeId: 'n-gen', targetField: 'fileId', value: 'm-gen-1',
      exec: { status: 'done', attempts: 1, artifactRev: 2 },
    });
    expect(second.data).toMatchObject({ written: true });   // 修前：unregistered 恒拒（红）——播种自愈链实证
  }, 60_000);
});

});
