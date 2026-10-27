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
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabSpoolService } from './collab-spool.service';
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
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, repo,
      createLeaseStub({}, { repo: repo as any, spool: spool as any }) as any,
      perm as any, port, 10_000, undefined, undefined, spool,
    );
    await gateway.onModuleInit();
    residency = new CollabResidencyService(gateway);
    const docSvc = new CollabDocumentService(gateway, repo, residency);
    svc = new CollabRecoveryImportService(docSvc, prisma as unknown as PrismaService);
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

  it('replace 用户选（冲突节点替换——nodeId 稳定不重映射）', async () => {
    const env = envelopeOf([{ id: 'n-exist' }], [], { draftId: 'draft-t25-replace' });
    const out = await svc.importEnvelope(PID, UID, env, { 'n-exist': 'replace' });
    expect(out.dispositions[0]).toEqual({ nodeId: 'n-exist', disposition: 'replace' });
    await flush(PID);
    // replace 帧含删+增双 op：维护通道 debounce/落库为最终一致——断言本体轮询（≤5s；写已入 live
    // session doc〔上断言 dispositions 证〕，此处只等 PG 投影追平——非掩盖性重试）
    const promptOf = async (): Promise<unknown> => {
      const r = await reviveFromPg(PID);
      const data = (r.getMap('nodes').get('n-exist') as Y.Map<any> | undefined)?.get('data');
      const prompt = data instanceof Y.Map ? data.get('prompt') : undefined;
      return prompt && typeof (prompt as Y.Map<any>).toJSON === 'function' ? (prompt as Y.Map<any>).toJSON() : undefined;
    };
    await pollUntil(async () => JSON.stringify(await promptOf()) === JSON.stringify({ text: 'recover' }), 5_000, 150);
    expect(await promptOf()).toEqual({ text: 'recover' });
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
});

