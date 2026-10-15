// apps/api/src/modules/collab/collab-write-idempotency.int.spec.ts
// Y0c T27（G1——spec Z76 随裁 1/Z133 修正判据）：同 idemKey 并发双发 ⇒ doc 终态内容收敛+净增行
// ≤2×N_chunks（compact 前两行都在）+exec attempts 单调。此用例是 Z76 的唯一证明（没有它 Z76 是
// 一句期望）——幂等=「端口只收幂等 op」原则（Z133）：writeNodeData/writeExecStatus 键级 set 语义，
// CRDT 重放同值收敛，零读判据不在最热路径加装载；端点显式不承诺跨请求去重（重试多落 delta 行=
// 有界/compact 坍缩/retry 可观测——禁内存去重表）。
// 判据三面（Z133(b) 修正——「逐字节一致」与「净增行非 2×」互斥故废）：
//  ①内容收敛=重放后状态语义等价（绝对期望+control 对照双断言——绝对期望是先红构造的判别锚：
//    whole-block replace 会把 control 与 double 同步打坏，仅 control 对照会假绿）；
//  ②净增行 ≤2×N_chunks（N=同内容单发对照的实际落行数；两 send 的 delta 行都在=上界恰 2×）；
//  ③attempts 单调=同代重放收敛 attempts===1+older-attempts（0 代）重放被代次守卫拒（written:false）。
// 装置=真 PG int 形态（collab-residency-durability.int.spec 同款 kit——Z144 邻近复用）：真
// PrismaClient+真 CanvasDocUpdateRepository+真 CollabGateway（lease stub fast path⇒serving）+
// CollabDocWriterService.writeBatch（write-batch 端点的进程内同款面——端点只加进门校验与鉴权，
// 幂等语义全在 writer 原语层）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabDocWriterService, type WriteOpResult } from './collab-doc-writer.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { pollUntil } from '../../test-utils/poll-until';
import type { DocWriteOp } from '@flowweb/shared';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_CTRL = 'y0c-g1-ctrl';   // 单发对照（N_chunks 基线）
const PID_DBL = 'y0c-g1-dbl';     // 同 idemKey 并发双发
const DEBOUNCE_MS = 10_000;
const LEASE_STUB_OWNER = 'stub-owner-1';

/** 同 idemKey 的批内容（write-batch 端点合法面——writeNodeData 键域/值域全过 manifest 执法档）。 */
const BATCH: DocWriteOp[] = [
  { op: 'writeNodeData', nodeId: 'n1', patch: { fileId: 'f-1', resultUrl: 'https://x/1.png' } },
  { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'running', attempts: 1, jobId: 'j-1' } },
];
/** 终态绝对期望（内容收敛判别锚——sibling 键 content 必须被键级 set 保留）。 */
const EXPECT_DATA = { content: 'seed', fileId: 'f-1', resultUrl: 'https://x/1.png' };
const EXPECT_EXEC = { status: 'running', attempts: 1, jobId: 'j-1' };

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let residency: CollabResidencyService;
let writer: CollabDocWriterService;
let spoolDir: string;

async function rowsOf(pid: string): Promise<number> {
  return prisma.canvasDocUpdate.count({ where: { projectId: pid } });
}

/** 种子：n1 节点+data sibling 键 content（键级 set 防线的判别锚——整块 replace 会丢它）。 */
async function seedNode(pid: string): Promise<void> {
  await residency.withSession(pid, (doc) => {
    const n1 = new Y.Map();
    n1.set('data', new Y.Map([['content', 'seed']]));
    doc.getMap('nodes').set('n1', n1);
  }, { mode: 'write' });
  await flush(pid);
}

/** 强制冲刷+三态空等待（关停步骤 3 同 API——durability int 同款）。 */
async function flush(pid: string): Promise<void> {
  gateway.server.hocuspocus.flushPendingStores();
  await pollUntil(() => gateway.isPersistedComplete(pid), 5_000);
}

/** 语义读面：node data+exec 投影 JSON（Y.Map toJSON——语义等价判据，非逐字节）。 */
async function readSemantics(pid: string): Promise<{ data: unknown; exec: unknown }> {
  return residency.withSession(pid, (doc) => ({
    data: (doc.getMap('nodes').get('n1') as Y.Map<any>)?.get('data')?.toJSON?.() ?? null,
    exec: (doc.getMap('exec').get('n1') as Y.Map<any>)?.toJSON?.() ?? null,
  }), { mode: 'read' });
}

maybe('Y0c T27 G1（Z133 修正判据）：同 idemKey 并发双发幂等', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as any);
    for (const pid of [PID_CTRL, PID_DBL]) {
      await ensureProjectFixture(prisma, pid);
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
    }
    await ensureLeaseFixture(prisma, repo, LEASE_STUB_OWNER);
    spoolDir = await mkdtemp(join(tmpdir(), 'g1-int-'));
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
    writer = new CollabDocWriterService(docSvc);
    await seedNode(PID_CTRL);
    await seedNode(PID_DBL);
  }, 30_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid);
    await (gateway as any).server.destroy();
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID_CTRL);
    await cleanupProjectFixture(prisma, PID_DBL);
    await prisma.$disconnect();
  }, 30_000);

  it('①内容收敛+②净增行 ≤2×N_chunks+③attempts 单调（并发双发 ⇒ 语义等价终态）', async () => {
    // ── 对照：同内容单发 ⇒ N_chunks 基线 ──
    const rowsCtrlBefore = await rowsOf(PID_CTRL);
    const ctrl = await writer.writeBatch(PID_CTRL, BATCH);
    await flush(PID_CTRL);
    const nChunks = (await rowsOf(PID_CTRL)) - rowsCtrlBefore;
    expect(nChunks).toBeGreaterThanOrEqual(1);          // N_chunks 实测基线（小批=1 行/送）
    expect(ctrl.every((r) => r.written)).toBe(true);

    // ── 双发：同 idemKey（同批内容）并发两送 ──
    const rowsDblBefore = await rowsOf(PID_DBL);
    const [a, b] = await Promise.all([
      writer.writeBatch(PID_DBL, BATCH),
      writer.writeBatch(PID_DBL, BATCH),
    ]);
    await flush(PID_DBL);
    const deltaRows = (await rowsOf(PID_DBL)) - rowsDblBefore;
    // ②净增行 ≤2×N_chunks（compact 前两 send 的 delta 行都在=上界恰 2×；同去抖窗合并=1 行亦合法）
    expect(deltaRows).toBeGreaterThanOrEqual(1);        // 写确已落（下界）
    expect(deltaRows).toBeLessThanOrEqual(2 * nChunks); // Z133(b) 上界（有界——禁内存去重表的代价面）
    // 双发两结果全 written（键级 set 重放同值收敛=合法写；同代非终态不触发 terminal-superseded）
    expect(a.every((r) => r.written)).toBe(true);
    expect(b.every((r) => r.written)).toBe(true);

    // ── ①内容收敛：绝对期望（判别锚）+control 语义等价 双断言 ──
    const dbl = await readSemantics(PID_DBL);
    expect(dbl.data).toEqual(EXPECT_DATA);              // sibling content 保留=键级 set 防线（先红构造的判别面）
    expect(dbl.exec).toEqual(EXPECT_EXEC);
    const ctrlState = await readSemantics(PID_CTRL);
    expect(dbl).toEqual(ctrlState);                     // 重放后状态语义等价（非逐字节一致——Z133）

    // ── ③attempts 单调：older-attempts（0 代）重放被代次守卫拒 ──
    const older = await writer.writeBatch(PID_DBL, [
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'running', attempts: 0 } },
    ]);
    expect(older[0]).toMatchObject({ written: false, reason: 'older-attempts' });
    expect((await readSemantics(PID_DBL)).exec).toEqual(EXPECT_EXEC);   // 终态不回退
  }, 60_000);

  it('端点面幂等同源：BATCH 过 manifest 执法档（requireIdempotentOps:true 零违规——端点与本用例同款面）', async () => {
    const { validateWriteBatch } = await import('@flowweb/shared');
    expect(validateWriteBatch(BATCH, { requireIdempotentOps: true })).toEqual([]);   // 全幂等 op 才可双发重放
  });
});
