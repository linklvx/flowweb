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

  // Y0c T33 D 出口（Z125-4，spec :390）：drain×write-batch 相遇——drain（owner→NULL）窗内 worker
  // 投递 ⇒ (a) 端点瞬态 503 非 200 (b) 预算内重试 (c) 租约恢复后同 op 只落 doc 一次。
  // drain 窗构造=真实 drain 入口 beginDraining（POST /api/drain 的 gateway 调用面——collabState
  // 'draining'⇒X9 受理门 503）+PG 租约行 owner→NULL+repo 契约 16 内存面同步（lease-fence int spec
  // 行级 UPDATE 同款装置形态）；恢复=owner 复位+transition('serving')（beginDraining 60s 自动解除
  // 的同款转移，测试驱动提前——collab-auth-defense「最近合法状态转移链驱动」先例）。
  it('Z125-4 drain×write-batch 相遇：(a) drain 窗端点瞬态 503 非 200 (b) 端口预算内退避重试 (c) 租约恢复后同 op 只落 doc 一次（服务端恰一次 200 受理+窗内投递零物化）', async () => {
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
      (gateway as any).transition('serving', 'z125-4-restore');
      (gateway as any).clearDrainTimer();
    };
    try {
      await setOwner(null);
      repo.setLeaseOwner(null);
      // (a) drain 窗内 worker 投递 ⇒ 端点瞬态 503 非 200（X9 受理门 assertWriteAdmitted 单点）；
      //     probe 用合法白名单键（controller 层 Z148① manifest 校验先于 writer X9 门——非法键 400
      //     会截断 503 判别）+哨兵 resultUrl 值=窗内投递零物化的判别标记（(c) 段断言捕获）
      const probe = await fetch(`${baseUrl}/api/collab/doc/write-batch`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ projectId: PID, ops: [{ op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'https://x/z125-4-probe-must-not-land' } }] }),
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
      const results = await racePort.writeOpsBatch(PID, [
        { op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f-z125-4' } },
      ]);
      await restoreTask;
      // (b) 预算内重试：≥1 次 503 尝试+恰一次 2xx 成功（4 次预算内收敛——非 transient-exhausted 合成档；
      //     2xx 口径=端口三分判据同源〔request :170〕——Nest POST 缺省 201）
      expect(statuses.filter((s) => s === 503).length, `drain 窗内 ≥1 次 503 尝试（实收 ${JSON.stringify(statuses)}）`).toBeGreaterThanOrEqual(1);
      expect(statuses.filter((s) => s >= 200 && s < 300), `预算内恰一次成功受理（实收 ${JSON.stringify(statuses)}）`).toHaveLength(1);
      expect(results, '预算内重试后成功=真端点响应（非耗尽合成 written:true 档）').toEqual([
        expect.objectContaining({ index: 0, op: 'writeNodeData', written: true }),
      ]);
      // (c) 租约恢复后同 op 只落 doc 一次：装载重放读侧终态=恰好该次受理的键级 set；
      //     窗内投递（probe 哨兵 resultUrl）零物化——503 拒在写前（端点门先于事务），
      //     resultUrl 维持 ③ 用例落值（键级 set 互不干扰+probe 未落的双重判别）
      await flush(PID);
      const revived = await reviveFromPg(PID);
      const data = (revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON();
      expect(data).toMatchObject({ content: 'seed', fileId: 'f-z125-4', resultUrl: 'https://x/e2e.png' });
      expect(data.resultUrl, 'drain 窗内投递必须零物化（503 非 200——写前拒绝）').not.toMatch(/z125-4-probe/);
    } finally {
      await restoreLease();   // 断言失败路径同样恢复 serving——不毒化 afterAll/后续面（V31 同款纪律）
    }
  }, 60_000);
});
