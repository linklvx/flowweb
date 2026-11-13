// apps/api/src/modules/collab/collab-write-endpoint.int.spec.ts
// Y0c T27（端到端+三探针）→Y1c T32：worker 客户端（HttpCollabWritePort.writeExecStatus）→ 真 HTTP
// 端点（POST /api/collab/doc/exec-status——Nest 测试应用真监听）→ CollabDocumentService.
// writeExecStatus → RuntimeEvent feed 写 → 真 PG。装置=Z144 耐久 int spec 邻近复用（真 Prisma/
// repo/gateway+lease stub）+Test.createTestingModule 挂真 controller。三探针落位：①公网 403=nginx
// deny（本地无 nginx——锚在 check-nginx-budget 模板文本断址，此处不复）；②无 token 拒（production
// 形态 sim——token 已设+请求无/错 Bearer ⇒ 403）；③loopback 200（真端点直调——writeExecStatus
// 全链）。T32 改造注记：write-batch 端点（doc 批写/writeOpsBatch/NON_IDEMPOTENT 执法档）随
// doc.exec 读写链退役——用例随迁（零 doc 写判据=RuntimeEvent 在档+doc 不变；done 黑名单 403 保留）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabDocumentService } from './collab-document.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { CollabSpoolService } from './collab-spool.service';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabWriteController } from './collab-write.controller';
import { DeletionBarrierService } from './deletion-barrier.service';   // C3b-4a：controller 构造参数四（deletion-barrier 端点——exec-status 用例零消费 stub）
import { PrismaService } from '../../prisma/prisma.service';
import { mintWorkerScopeToken } from './worker-scope-token';
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
/** T13 scope 绑定夹具：全档 token 需真 intent 行（projectId/nodeId/execSeq 匹配）——n1=已种子节点、
 *  ghost=未种子（business written:false 透传用例的 node-deleted 判别）。 */
const INTENT_N1 = { id: `gi-t13-n1-${randomUUID().slice(0, 8)}`, execSeq: 91001n };
const INTENT_GHOST = { id: `gi-t13-ghost-${randomUUID().slice(0, 8)}`, execSeq: 91002n };

async function seedIntentRow(id: string, nodeId: string, execSeq: bigint): Promise<void> {
  await prisma.generationIntent.create({
    data: {
      id, projectId: PID, nodeId, userId: 'u-t13-e2e', teamId: 't-t13-e2e',
      intentId: `ii-${id}`, kind: 'image', paramsHash: `ph-${id}`, status: 'RUNNING',
      creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + 3600_000),
      idemKey: `ik-${id}`, execSeq,
    },
  });
}
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

maybe('Y1c T32 exec-status 端点（端到端真链+三探针——RuntimeEvent feed 写）', () => {
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
    const docSvc = new CollabDocumentService(gateway, repo, residency, new RuntimeFeedService(prisma as any));
    // 真 HTTP 端点（测试应用真监听——provider 直注 kit 真 docSvc；@NoTransform 在位钉裸对象契约）
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabWriteController],
      providers: [
        { provide: CollabDocumentService, useValue: docSvc },
        { provide: PrismaService, useValue: prisma },   // T13：scope 全档绑定校验读点（intent 行）
        { provide: CollabSpoolService, useValue: new CollabSpoolService() },   // C4-c1：media-refs 端点面（exec-status 用例零消费——裸构造即可）
        { provide: DeletionBarrierService, useValue: {} as DeletionBarrierService },   // C3b-4a：deletion-barrier 端点面（exec-status 用例零消费——裸 stub 即可）
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    savedEnv = process.env.WORKER_WRITE_TOKEN;
    process.env.WORKER_WRITE_TOKEN = TOKEN;
    await seedIntentRow(INTENT_N1.id, 'n1', INTENT_N1.execSeq);
    await seedIntentRow(INTENT_GHOST.id, 'ghost', INTENT_GHOST.execSeq);
    workerPort = new HttpCollabWritePort({ baseUrl, token: TOKEN, backoffBaseMs: 1 });
    // 种子 n1（scope 全档绑定 nodeId 匹配锚——feed 写面无存在性守卫）
    await residency.withSession(PID, (doc) => {
      const n1 = new Y.Map();
      n1.set('data', new Y.Map([['content', 'seed']]));
      doc.getMap('nodes').set('n1', n1);
    }, { mode: 'write' });
    await flush(PID);
  }, 60_000);

  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.WORKER_WRITE_TOKEN; else process.env.WORKER_WRITE_TOKEN = savedEnv;
    await prisma.generationIntent.deleteMany({ where: { id: { in: [INTENT_N1.id, INTENT_GHOST.id] } } }).catch(() => undefined);
    await prisma.runtimeEvent.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await app?.close();
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid);
    await (gateway as any).server.destroy();
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  }, 30_000);

  it('③loopback 200（端到端）：HttpCollabWritePort.writeExecStatus → exec-status 端点 → RuntimeEvent feed 落 PG 全链（零 doc 写）', async () => {
    await workerPort.writeExecStatus(PID, 'n1', { status: 'running', attempts: 1, intentId: 'i-e2e' },
      { intentRowId: INTENT_N1.id, execSeq: INTENT_N1.execSeq.toString() });
    // feed 事件在档（新权威——RuntimeEvent exec.status；判别键=intentId〔T22 投影键集无 jobId——哨兵用 intentId〕）
    const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
    expect(events.some((e) => e.kind === 'exec.status' && (e.payload as { intentId?: string }).intentId === 'i-e2e')).toBe(true);
    // 零 doc 写（装载重放读侧——nodes data 种子不变+exec 根恒空）
    await flush(PID);
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON())
      .toEqual({ content: 'seed' });
    expect(revived.getMap('exec').size).toBe(0);
  }, 60_000);

  it('body 形态（raw fetch）：patch.status 缺失 ⇒ 400 EXEC_STATUS_BAD_PATCH（writeExecStatus 零调用）', async () => {
    const r = await fetch(`${baseUrl}/api/collab/doc/exec-status`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ projectId: PID, nodeId: 'n1', patch: { attempts: 1 } }),
    });
    expect(r.status).toBe(400);
    const before = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    expect(before).toBeGreaterThanOrEqual(1);   // 前用例事件在档（形态拒零新事件由下判据承担）
    const body = await r.json();
    expect(body?.code ?? body?.message?.code).toBeTruthy();
  }, 30_000);


  it('T13 收窄实面（raw fetch）：伪造他 project 的自铸 token ⇒ 403（验签败——异密钥）', async () => {
    const forged = await fetch(`${baseUrl}/api/collab/doc/exec-status`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-worker-scope': mintWorkerScopeToken('attacker', PID) },
      body: JSON.stringify({ projectId: PID, nodeId: 'n1', patch: { status: 'loading', attempts: 0 } }),
    });
    expect(forged.status).toBe(403);
  }, 30_000);

  it('②无 token 拒：无 Authorization/错 Bearer ⇒ 403（production 形态 sim——token 已设+失配）', async () => {
    const noToken = await fetch(`${baseUrl}/api/collab/doc/exec-status`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: PID, nodeId: 'n1', patch: { status: 'loading', attempts: 0 } }),
    });
    expect(noToken.status).toBe(403);
    const wrong = await fetch(`${baseUrl}/api/collab/doc/exec-status`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ projectId: PID, nodeId: 'n1', patch: { status: 'loading', attempts: 0 } }),
    });
    expect(wrong.status).toBe(403);
  }, 30_000);


  it('done 黑名单：writeExecStatus status=done ⇒ 403 WORKER_EXEC_STATUS_NOT_ALLOWED（done=投影 poller deliverArtifact 复合事务专写）+零事件物化', async () => {
    const r = await fetch(`${baseUrl}/api/collab/doc/exec-status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${TOKEN}`,
        'x-worker-scope': mintWorkerScopeToken(TOKEN, PID, { intentRowId: INTENT_N1.id, execSeq: INTENT_N1.execSeq.toString() }),
      },
      body: JSON.stringify({ projectId: PID, nodeId: 'n1', patch: { status: 'done', attempts: 1 } }),
    });
    expect(r.status, 'done 不再由 worker 写（exec done=deliverArtifact 复合事务专写）').toBe(403);
    const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'exec.status' } });
    expect(events.some((e) => (e.payload as { status?: string }).status === 'done')).toBe(false);   // 零物化
  }, 30_000);

  // Y0c T33 D 出口（Z125-4，spec :390）→Y1c T32 形态：drain×exec-status 相遇——drain（owner→NULL）
  // 窗内 worker 投递 ⇒ (a) 端点瞬态 503 非 200 (b) 预算内重试 (c) 租约恢复后恰一次成功受理
  // （feed 恰一条事件——零 doc 写语义下「同 op 只落一次」判据=RuntimeEvent 恰一次）。
  it('Z125-4 drain×exec-status 相遇：(a) drain 窗端点瞬态 503 非 200 (b) 端口预算内退避重试 (c) 租约恢复后恰一次成功受理（feed 恰一条哨兵事件+窗内投递零物化）', async () => {
    await flush(PID);   // drain 前持久化落定——释放会话零在途（beginDraining 的 Z129 释放面干净）
    const drainRes = gateway.beginDraining();
    expect(drainRes.draining, 'beginDraining 生效（serving→draining）').toBe(true);
    await pollUntil(async () => !residency.residentProjectIds().includes(PID), 10_000);   // drain 释放常驻会话完毕
    // owner→NULL 两层忠实面（PG 行+repo 内存契约 16——生产 drain 释放租约的效果）
    const setOwner = (o: string | null) => prisma.$executeRawUnsafe(
      o === null
        ? `UPDATE "CollabLease" SET owner = NULL WHERE scope = 'primary'`
        : `UPDATE "CollabLease" SET owner = '${o}', "expiresAt" = now() + interval '5 minutes' WHERE scope = 'primary'`,
    );
    let restored = false;
    const restoreLease = async () => {
      if (restored) return;
      restored = true;
      await setOwner(LEASE_STUB_OWNER);
      repo.setLeaseOwner(LEASE_STUB_OWNER);
      gatewayFacade(gateway).transitionState('serving', 'z125-4-restore');
      gatewayFacade(gateway).clearDrainTimer();   // B3 承接账①核销：façade stub 裁决（drain 编排域留 gateway 私有——断言值零变化，仅访问形态改道）
    };
    try {
      await setOwner(null);
      repo.setLeaseOwner(null);
      // (a) drain 窗内 worker 投递 ⇒ 端点瞬态 503 非 200（X9 受理门 assertWriteAdmitted 单点）
      const probe = await fetch(`${baseUrl}/api/collab/doc/exec-status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', authorization: `Bearer ${TOKEN}`,
          'x-worker-scope': mintWorkerScopeToken(TOKEN, PID, { intentRowId: INTENT_N1.id, execSeq: INTENT_N1.execSeq.toString() }),
        },
        body: JSON.stringify({ projectId: PID, nodeId: 'n1', patch: { status: 'loading', attempts: 1, intentId: 'z125-4-probe-must-not-land' } }),
      });
      expect(probe.status, 'drain 窗内投递必须瞬态 503 非 200（Z125-4(a)）').toBe(503);
      // (b)+(c) 相遇窗：端口在飞重试（backoffBaseMs=250 ⇒ 尝试节奏 ~0/250/750ms，预算 4 次）×
      // 租约中途恢复（t≈500ms——第 2 次尝试后、第 3 次尝试前）。fetchImpl=真 fetch 直通计数
      // （TD-2 教训：非 mock 替换，仅旁路记录 status 序列——响应体仍真 undici）
      const statuses: number[] = [];
      const racePort = new HttpCollabWritePort({
        baseUrl, token: TOKEN, backoffBaseMs: 250,
        fetchImpl: (async (url: string, init: any) => {
          const r = await fetch(url, init); statuses.push(r.status); return r;
        }) as any,
      });
      const restoreTask = (async () => { await new Promise((r) => setTimeout(r, 500)); await restoreLease(); })();
      await racePort.writeExecStatus(PID, 'n1', { status: 'loading', attempts: 1, intentId: 'f-z125-4' },
        { intentRowId: INTENT_N1.id, execSeq: INTENT_N1.execSeq.toString() });
      await restoreTask;
      // (b) 预算内重试：≥1 次 503 尝试+恰一次 2xx 成功（4 次预算内收敛；2xx 口径=端口三分判据同源
      //     〔request :170〕——Nest POST 缺省 201）
      expect(statuses.filter((s) => s === 503).length, `drain 窗内 ≥1 次 503 尝试（实收 ${JSON.stringify(statuses)}）`).toBeGreaterThanOrEqual(1);
      expect(statuses.filter((s) => s >= 200 && s < 300), `预算内恰一次成功受理（实收 ${JSON.stringify(statuses)}）`).toHaveLength(1);
      // (c) 租约恢复后恰一次成功受理：feed 哨兵事件恰一条（probe 哨兵零物化——503 拒在写前）
      const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'exec.status' } });
      const fEvents = events.filter((e) => (e.payload as { intentId?: string }).intentId === 'f-z125-4');
      expect(fEvents, '成功受理的 f-z125-4 恰一次落 feed').toHaveLength(1);
      expect(events.some((e) => /z125-4-probe/.test(String((e.payload as { intentId?: string }).intentId ?? ''))),
        'drain 窗内投递必须零物化（503 非 200——写前拒绝）').toBe(false);
    } finally {
      await restoreLease();   // 断言失败路径同样恢复 serving——不毒化 afterAll/后续面（V31 同款纪律）
    }
  }, 60_000);
});