// apps/api/src/modules/collab/collab-residency-durability.int.spec.ts
// Y0c T22（片 A2 出口——spec Z144 耐久双向+Z129 收敛路径）：端到端耐久用例双向断言（真 PG）。
// 单向「释放后必在 PG」会被 tryRelease 拒绝路径假绿——本套件两行覆盖守卫的两种结果：
//   ①耐久路径：写入 k1 ⇒ pendingQueues 空（flush settle）⇒ tryRelease('reaper')=released ⇒
//     读 PG（repo 装载重放）≡ 写入内容（内容+SV 双断言——非 mock，真库行）；
//   ②收敛路径：批在去抖窗（pendingQueues 非空——debounce 10s 确定性构造）⇒ tryRelease
//     拒绝（rejected-pending）∧ yjs_release_with_pending_total{motive='reaper'}+1 ⇒
//     强制 flush（flushPendingStores——关停步骤 3 同 API）⇒ 内容达 PG。
// 先红构造（Z144 字面，红证据归任务报告、committed 形态=绿）：临时把 releaseAttempt 改为
//   `await residency.releaseSessionFor(pid); return 'released';`
// （=去掉①的判据、直接 disconnect 不经 tryRelease）⇒ ②拒绝分支不可达（得到 'released'、
//   计数零增）用例红——判据必须覆盖守卫两种结果，否则测的是守卫非守卫保护的性质。
// 装置=真库 int 形态（canvas-doc-hydration.int.spec 同款 DB fixture + kit 同款 gateway 直构）：
// 真 PrismaClient+真 CanvasDocUpdateRepository（append/装载全落真 PG），auth/perm 面 stub
// （DirectConnection 不经 WS 鉴权——库 openDirectConnection 直达 loadDocument，Z80 锚同入口）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService, type TryReleaseOutcome } from './collab-residency.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { pollUntil } from '../../test-utils/poll-until';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_A = 'y0c-z144-durable-a';   // ①耐久路径专属 pid（两用例隔离——不共享 doc 行）
const PID_B = 'y0c-z144-converge-b';  // ②收敛路径专属 pid
const DEBOUNCE_MS = 10_000;           // 长去抖窗：②「批在窗内」确定性构造（tryRelease 在写入后毫秒级发出，10s 窗不可能已 flush）
/** lease stub tryAcquireFast 写入的 in-memory owner（createLeaseStub 契约三件套①）——DB 行同值才不 fenced。 */
const LEASE_STUB_OWNER = 'stub-owner-1';

/** yjs_release_with_pending_total{motive='reaper'} 现值（register 全局单例——恒用增量断言）。 */
async function releaseWithPendingReaper(): Promise<number> {
  const m = register.getSingleMetric('yjs_release_with_pending_total') as any;
  const vals = (await m.get()).values;
  return vals.find((v: any) => v.labels?.motive === 'reaper')?.value ?? 0;
}

/** 释放入口单点（Z144 判别力锚——两用例共用，红构造只改这一处）。生产语义=tryRelease('reaper')
 *  （Z141 两前置守卫所在：pendingQueues 非空∧无在飞 store ⇒ 拒绝+计数）。 */
async function releaseAttempt(pid: string): Promise<TryReleaseOutcome> {
  return residency!.tryRelease(pid, 'reaper');
}

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let residency: CollabResidencyService;
let spoolDir: string;

/** PG 行装载重放（「读 PG ≡ 写入内容」的读侧——repo 装载出口，非 mock）。 */
async function reviveFromPg(pid: string): Promise<Y.Doc> {
  const { state, updates } = await repo.loadForHydration(pid);
  const revived = new Y.Doc();
  if (state) Y.applyUpdate(revived, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
  return revived;
}

maybe('Y0c T22 Z144：耐久用例双向（真 PG——守卫两种结果全覆盖）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as any);
    await ensureProjectFixture(prisma, PID_A);
    await ensureProjectFixture(prisma, PID_B);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [PID_A, PID_B] } } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: { in: [PID_A, PID_B] } } });
    await ensureLeaseFixture(prisma, repo, LEASE_STUB_OWNER);   // DB 行 owner=stub 写入值——真 append 不 fenced
    spoolDir = await mkdtemp(join(tmpdir(), 'z144-int-'));
    const spool = new CollabSpoolService(spoolDir);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
    };
    const port = 20000 + Math.floor(Math.random() * 20000);   // kit 同款随机端口段（port=0 库不回写 configuration.port）
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, repo,
      createLeaseStub({}, { repo: repo as any, spool: spool as any }) as any,
      perm as any, port, DEBOUNCE_MS, undefined, undefined, spool,
    );
    await gateway.onModuleInit();   // lease stub fast path ⇒ serving（listen 完成）
    residency = new CollabResidencyService(gateway);
  }, 30_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid);
    await (gateway as any).server.destroy();
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID_A);
    await cleanupProjectFixture(prisma, PID_B);
    await prisma.$disconnect();
  }, 30_000);

  it('①耐久路径：pendingQueues 空 ⇒ tryRelease released ∧ 释放后读 PG ≡ 写入内容', async () => {
    // 写入 k1（withSession write=会话 acquire+SERVER_TRANSACT_ORIGIN 最外层事务——生产写路径）
    await residency.withSession(PID_A, (doc) => {
      doc.getMap('nodes').set('k1', new Y.Map([['x', 1]]));
    }, { mode: 'write' });
    // flush settle：强制冲刷（关停步骤 3 同 API）+ 轮询三态空（in-flight/pending/spool）
    gateway.server.hocuspocus.flushPendingStores();
    await pollUntil(() => gateway.isPersistedComplete(PID_A), 5_000);
    expect(gateway.hasPendingWrites(PID_A)).toBe(false);   // 前置钉死：判据成立（非空守卫的另一态归②）
    // 释放前捕获服务端 doc SV（释放后库销毁 doc——对拍基准只此一窗）
    const svServer = await residency.withSession(PID_A, (doc) => Y.encodeStateVector(doc), { mode: 'read' });
    const before = await releaseWithPendingReaper();
    const outcome = await releaseAttempt(PID_A);
    expect(outcome).toBe('released');                                  // 释放成功
    expect(await releaseWithPendingReaper()).toBe(before);             // 未走拒绝分支
    expect(residency.sessionState(PID_A)).toBeUndefined();             // 会话条目移除
    await pollUntil(() => !gateway.server.hocuspocus.documents.has(`project:${PID_A}`), 5_000);   // 真卸载
    // 读 PG（repo 装载重放）≡ 写入内容：内容断言+SV 全等（无内容丢失的结构性判据）
    const revived = await reviveFromPg(PID_A);
    expect((revived.getMap('nodes').get('k1') as Y.Map<unknown>)?.get('x')).toBe(1);
    expect(Buffer.from(Y.encodeStateVector(revived)).equals(Buffer.from(svServer))).toBe(true);
  }, 30_000);

  it('②收敛路径：pendingQueues 非空 ⇒ 拒绝释放 ∧ 计数+1 ∧ 强制 flush 后内容达 PG', async () => {
    // 写入 k2——批留在去抖窗（10s 未到，队列非空确定性成立）
    await residency.withSession(PID_B, (doc) => {
      doc.getMap('nodes').set('k2', new Y.Map([['y', 2]]));
    }, { mode: 'write' });
    expect(gateway.hasPendingWrites(PID_B)).toBe(true);    // 前置钉死：批确在队列（Z141 第一前置命中）
    const before = await releaseWithPendingReaper();
    const outcome = await releaseAttempt(PID_B);
    expect(outcome).toBe('rejected-pending');                          // 拒绝释放（非 released——单向断言的假绿面即在此）
    expect(await releaseWithPendingReaper()).toBe(before + 1);         // yjs_release_with_pending_total{motive='reaper'}+1
    expect(residency.sessionState(PID_B)).toBe('held');                // 条目保留（收敛非丢弃）
    expect(gateway.server.hocuspocus.documents.has(`project:${PID_B}`)).toBe(true);   // doc 仍驻留
    // 触发 flush（强制档——flushPendingStores；等待档=10s 自然到期，语义同）⇒ 内容达 PG
    gateway.server.hocuspocus.flushPendingStores();
    await pollUntil(() => gateway.isPersistedComplete(PID_B), 5_000);
    const revived = await reviveFromPg(PID_B);
    expect((revived.getMap('nodes').get('k2') as Y.Map<unknown>)?.get('y')).toBe(2);   // 下一轮 store 后仍达 PG
  }, 30_000);
});
