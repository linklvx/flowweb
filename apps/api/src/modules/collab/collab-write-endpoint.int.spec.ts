// apps/api/src/modules/collab/collab-write-endpoint.int.spec.ts
// Y0c T27（端到端+三探针）：worker 客户端（HttpCollabWritePort.writeOpsBatch）→ 真 HTTP 端点
// （POST /api/collab/doc/write-batch——Nest 测试应用真监听）→ CollabDocWriterService.writeBatch →
// gateway 会话写事务 → 真 PG。装置=Z144 耐久 int spec 邻近复用（真 Prisma/repo/gateway+lease stub）
// +Test.createTestingModule 挂真 controller（provider 直注 kit 构造的真 writer——DI 链=生产同款面）。
// 三探针落位：①公网 403=nginx deny（本地无 nginx——锚在 check-nginx-budget 模板文本断言，此处
// 不复）；②无 token 拒（production 形态 sim——token 已设+请求无/错 Bearer ⇒ 403）；③loopback 200
// （真端点直调——writeOpsBatch 全链）。另钉：Z148① 端点执法档 4xx 实面（raw fetch 400+NON_IDEMPOTENT_OP）
// +业务面 written:false 透传（200 非 4xx——退款终态链凭据不被端点吞）+@NoTransform 裸数组契约
// （TransformInterceptor 在位——包裹壳会使 Array.isArray 假、结果被合成）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabDocWriterService } from './collab-doc-writer.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabWriteController } from './collab-write.controller';
import { HttpCollabWritePort } from './collab-write.port';
import { TransformInterceptor } from '../../interceptors/transform.interceptor';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { pollUntil } from '../../test-utils/poll-until';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0c-t27-e2e';
const TOKEN = 'tok-t27-int';
const DEBOUNCE_MS = 10_000;
const LEASE_STUB_OWNER = 'stub-owner-1';

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let residency: CollabResidencyService;
let spoolDir: string;
let app: INestApplication;
let baseUrl: string;
let workerPort: HttpCollabWritePort;

/** PG 行装载重放（Z144 装置——「写达 PG」的读侧，非 gateway 内存）。 */
async function reviveFromPg(pid: string): Promise<Y.Doc> {
  const { state, updates } = await repo.loadForHydration(pid);
  const revived = new Y.Doc();
  if (state) Y.applyUpdate(revived, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
  return revived;
}

async function flush(pid: string): Promise<void> {
  gateway.server.hocuspocus.flushPendingStores();
  await pollUntil(() => gateway.isPersistedComplete(pid), 5_000);
}

maybe('Y0c T27 write-batch 端点（端到端真链+三探针）', () => {
  let savedEnv: string | undefined;

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as any);
    await ensureProjectFixture(prisma, PID);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await ensureLeaseFixture(prisma, repo, LEASE_STUB_OWNER);
    spoolDir = await mkdtemp(join(tmpdir(), 't27-e2e-'));
    const spool = new CollabSpoolService(spoolDir);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
    };
    const port = 20000 + Math.floor(Math.random() * 20000);
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, repo,
      createLeaseStub({}, { repo: repo as any, spool: spool as any }) as any,
      perm as any, port, DEBOUNCE_MS, undefined, undefined, spool,
    );
    await gateway.onModuleInit();
    residency = new CollabResidencyService(gateway);
    const docSvc = new CollabDocumentService(gateway, repo, residency);
    const writer = new CollabDocWriterService(docSvc);
    // 真 HTTP 端点（测试应用真监听——provider 直注 kit 真 writer；TransformInterceptor 在位钉
    // @NoTransform 契约：包裹壳会使 HttpCollabWritePort.writeOpsBatch 的 Array.isArray 假）
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabWriteController],
      providers: [{ provide: CollabDocWriterService, useValue: writer }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    savedEnv = process.env.WORKER_WRITE_TOKEN;
    process.env.WORKER_WRITE_TOKEN = TOKEN;
    workerPort = new HttpCollabWritePort({ baseUrl, token: TOKEN, backoffBaseMs: 1 });
    // 种子 n1（writeNodeData 存在性守卫前置）
    await residency.withSession(PID, (doc) => {
      const n1 = new Y.Map();
      n1.set('data', new Y.Map([['content', 'seed']]));
      doc.getMap('nodes').set('n1', n1);
    }, { mode: 'write' });
    await flush(PID);
  }, 60_000);

  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.WORKER_WRITE_TOKEN; else process.env.WORKER_WRITE_TOKEN = savedEnv;
    await app?.close();
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid);
    await (gateway as any).server.destroy();
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  }, 30_000);

  it('③loopback 200（端到端）：HttpCollabWritePort.writeOpsBatch → 端点 → writer → PG 全链', async () => {
    const { register } = await import('prom-client');
    const outcomeMetric: any = register.getSingleMetric('collab_write_http_outcome_total');
    const readBadBody = async () =>
      (await outcomeMetric.get()).values.find((v: any) => v.labels.method === 'writeBatch' && v.labels.outcome === 'permanent:bad-body')?.value ?? 0;
    const badBodyBefore = await readBadBody();
    const results = await workerPort.writeOpsBatch(PID, [
      { op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f-e2e', resultUrl: 'https://x/e2e.png' } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'running', attempts: 1, jobId: 'j-e2e' } },
    ]);
    // 裸数组契约（@NoTransform——非 {code,data} 包裹壳）+一一对应（A1 冻结契约）
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ index: 0, op: 'writeNodeData', written: true });
    expect(results[1]).toMatchObject({ index: 1, op: 'writeExecStatus', written: true });
    // 真 undici 响应面回归锚：permanent:bad-body 零增（解绑 r.json 根修前——真链必 bad-body、结果被
    // 合成 written:true 吞，mock fetch 箭头闭包测不出——TD-2 mock 脱节实例）
    expect(await readBadBody()).toBe(badBodyBefore);
    // 写达 PG（装载重放读侧——Z144 装置）
    await flush(PID);
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON())
      .toEqual({ content: 'seed', fileId: 'f-e2e', resultUrl: 'https://x/e2e.png' });   // 键级 set：sibling 保留
    expect((revived.getMap('exec').get('n1') as Y.Map<any>).toJSON())
      .toEqual({ status: 'running', attempts: 1, jobId: 'j-e2e' });
  }, 60_000);

  it('业务面 written:false 透传（200 非 4xx）：未种节点 writeNodeData ⇒ written:false node-deleted（退款终态链凭据）', async () => {
    const results = await workerPort.writeOpsBatch(PID, [
      { op: 'writeNodeData', nodeId: 'ghost', patch: { fileId: 'x' } },
    ]);
    expect(results).toEqual([{ index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' }]);
  }, 30_000);

  it('②无 token 拒：无 Authorization/错 Bearer ⇒ 403（production 形态 sim——token 已设+失配）', async () => {
    const noToken = await fetch(`${baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: PID, ops: [{ op: 'deleteExecOrphans' }] }),
    });
    expect(noToken.status).toBe(403);
    const wrong = await fetch(`${baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ projectId: PID, ops: [{ op: 'deleteExecOrphans' }] }),
    });
    expect(wrong.status).toBe(403);
  }, 30_000);

  it('Z148① 端点执法档实面（raw fetch）：idempotent:false 的 op（fillDoc）⇒ 400+NON_IDEMPOTENT_OP（「端口只收幂等 op」）', async () => {
    const r = await fetch(`${baseUrl}/api/collab/doc/write-batch`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ projectId: PID, ops: [{ op: 'fillDoc', nodes: [], edges: [] }] }),
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { violations?: Array<{ code: string }> };
    expect(body.violations?.some((v) => v.code === 'NON_IDEMPOTENT_OP')).toBe(true);
  }, 30_000);
});
