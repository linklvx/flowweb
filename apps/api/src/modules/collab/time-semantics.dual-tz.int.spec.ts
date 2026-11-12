// apps/api/src/modules/collab/time-semantics.dual-tz.int.spec.ts —— C1-4（plan v3 Task C1-4；
// spec 2026-11-11-foundation-batch-design.md §3.3-5「双时区集成测试（连接级注入；用例集=全部 claim 面
// 〔lease/probe/materialize/projection-outbox/object-manifest/erasure/runtime-retention/execution-retention/
// heartbeat〕+@default/@updatedAt/round-trip；epochStartedAt 用例=DB 钟比较）」）。
// 形态：同一 spec 内两个独立 PrismaClient——**连接级时区注入**（DATABASE_URL `options=-c timezone=…`，
// Prisma 5.22 实证恒生效：`SHOW timezone` 逐客户端断言；进程内先例 media-fact-roundtrip.int.spec 的
// 「池内 SET 不可靠」注释=SET 连接池不可靠，非本形态）。每面用**真实服务方法**在两时区各跑一遍：
// UTC / Asia/Shanghai 结果必须一致（due=命中、未到期=零触碰）——判别面=同一夹具在两会话下
// 的时间谓词结果分叉。历史回归形态实测两类：①混合墙形态（如 `col < (now() AT TIME ZONE 'utc')`）
// 在 +8 会话把右值再抬 8h（左值 tsz 转会话墙比较）——**8h 内的到期行不再命中**；本 spec 的 due
// 夹具刻意落在 <8h 窗（materialize/execution/lease/probe/outbox=1-4h），object-manifest=26h 门
// （回归右值-24h 后 26h 行不删）、runtime=7d±4h（回归 -7d-8h 后 old 行不删）均跨判别窗；
// ②同向混比形态（UTC 墙 vs +8 墙）由 not-due（+1h/+4h）捕获。沙箱负控（临时把各谓词换回
// `col < (now() AT TIME ZONE 'utc')`，跑本 spec 必红，验证后还原——证据见实现报告）。
// epochStartedAt 断言只用 **DB 钟**（SQL 内 now()/EXTRACT(EPOCH)）——不混 Node 进程钟。
// 取库方式（实测）：本目录 .env 经 import 链加载（无 shell export 亦注入）——`DATABASE_URL` trim 后
// 为空才整文件 skip（`""`/纯空白均安全 skip；CI 未起库/未注入即 skip）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { createIntentFixture, deleteTeamsWithPass, ledgerWipe } from '../../test-utils/intent-fixture';
import { CollabLeaseService } from './collab-lease.service';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import { RuntimeFeedRetentionService } from './runtime-feed.retention.service';
import { MediaProbePoller } from '../media/media-probe.poller';
import { MaterializeJob } from '../artifact-core/materialize-job.service';
import { ObjectManifestService } from '../artifact-core/object-manifest.service';
import { ProjectionOutboxPoller } from '../media-delivery/projection-outbox.poller';
import { ExecutionRequestRetentionService } from '../execution/execution-request.retention.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { CreditLedgerService } from '../team/credit-ledger.service';

const DB_URL = (process.env.DATABASE_URL ?? '').trim();
const hasDb = DB_URL.length > 0;
const TZS = ['UTC', 'Asia/Shanghai'] as const;
type Tz = (typeof TZS)[number];
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const prisma = new PrismaClient();
let TID = '';
let UID = '';
/** 时区 → { client（连接级注入）, projectId }——每面夹具按 project 隔离（runtime/execution retention 面互不串扰）。 */
const byTz = {} as Record<Tz, { client: PrismaClient; projectId: string }>;

function tzUrl(url: string, tz: Tz): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}options=-c%20timezone%3D${encodeURIComponent(tz)}`;
}

/** 全局 claim（probe/materialize/outbox）批量有限——反复 claim 直至命中目标行或排空。 */
async function claimUntilSeen(
  claim: () => Promise<Array<{ id: string }>>, id: string, maxRounds = 30,
): Promise<boolean> {
  for (let i = 0; i < maxRounds; i += 1) {
    const rows = await claim();
    if (rows.some((r) => r.id === id)) return true;
    if (rows.length === 0) return false;
  }
  return false;
}

const asPrisma = (c: PrismaClient) => c as unknown as PrismaService;

beforeAll(async () => {
  const url = DB_URL;
  for (const tz of TZS) {
    byTz[tz] = {
      client: new PrismaClient({ datasources: { db: { url: tzUrl(url, tz) } } }),
      projectId: `int-c14tz-${tz.replace('/', '-')}-${Date.now()}`,
    };
  }
  UID = `int-c14tz-owner-${Date.now()}`;
  await prisma.user.upsert({
    where: { id: UID },
    create: { id: UID, name: 'int-c14tz', email: `${UID}@test.local`, emailVerified: false },
    update: {},
  });
  const team = await prisma.team.create({ data: { name: `int-c14tz-${Date.now()}`, ownerId: UID } });
  TID = team.id;
  for (const tz of TZS) {
    await prisma.canvasProject.create({ data: { id: byTz[tz].projectId, name: byTz[tz].projectId, teamId: TID, userId: UID } });
  }
}, 30_000);

afterAll(async () => {
  const pids = TZS.map((tz) => byTz[tz].projectId);
  await prisma.materializeRun.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.artifactProjection.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.executionRequest.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.runtimeEvent.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.generationIntent.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.projectErasureRun.deleteMany({ where: { scopeId: { startsWith: 'int-c14tz-' } } });
  await prisma.objectManifest.deleteMany({ where: { objectKey: { startsWith: `tz-c14-${TID}` } } });
  await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } });
  // CollabLease 单行全局资源——复原（restoreLeaseRow 同款形态）
  await prisma.$executeRaw`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary'`.catch(() => undefined);
  await ledgerWipe(new CreditLedgerService(asPrisma(prisma)), { teamId: TID });
  await deleteTeamsWithPass(asPrisma(prisma), [TID]);   // 级联 media/TeamBalance
  await prisma.user.deleteMany({ where: { id: UID } });
  for (const tz of TZS) await byTz[tz].client.$disconnect();
  await prisma.$disconnect();
}, 60_000);

(hasDb ? describe : describe.skip)('C1-4 双时区（连接级注入 UTC / Asia/Shanghai——全部 claim 面语义一致）', () => {
  it('连接级注入生效：两客户端 SHOW timezone 各自 = UTC / Asia/Shanghai（非空转前提）', async () => {
    for (const tz of TZS) {
      const rows = await byTz[tz].client.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW timezone');
      expect(rows[0]?.TimeZone, `${tz} 会话时区未注入`).toBe(tz);
    }
  });

  it('lease（CollabLeaseService）：无主/租约过期=两时区均可获取；他主未过期=两时区均拒绝', async () => {
    const leaseRow = (sql: Prisma.Sql) => prisma.$executeRaw(sql);
    const reset = () => prisma.$executeRaw`UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL WHERE scope = 'primary'`;
    const services = new Map<Tz, CollabLeaseService>();
    for (const tz of TZS) {
      services.set(tz, new CollabLeaseService(
        asPrisma(byTz[tz].client),
        { setLeaseOwner: () => undefined } as never,
        { setOwner: () => undefined } as never,
      ));
    }
    try {
      // ①无主：UTC 获取→释放（回到 owner=NULL）
      await reset();
      expect(await services.get('UTC')!.tryAcquireFast(), 'UTC: 无主行应可获取').toBe(true);
      await services.get('UTC')!.release();
      // ②他主 + 租约 30s 后到期：两时区均拒（会话时区不得平移 8h 让 +8 提前抢占）
      await leaseRow(Prisma.sql`UPDATE "CollabLease" SET owner = ${`tz-other-${Date.now()}`}, "expiresAt" = now() + interval '30 seconds', "renewedAt" = now() WHERE scope = 'primary'`);
      for (const tz of TZS) {
        expect(await services.get(tz)!.tryAcquireFast(), `${tz}: 他主未过期应拒绝`).toBe(false);
      }
      // ③租约已过期：UTC 可接管；随后**不复位**重置为「他主+1s 前过期」，+8 会话必须同样接管
      //（历史回归形态 `expiresAt < (now() AT TIME ZONE 'utc')` 在 +8 会话把阈值再降 8h → 拒绝）
      await leaseRow(Prisma.sql`UPDATE "CollabLease" SET owner = ${`tz-expired-${Date.now()}`}, "expiresAt" = now() - interval '1 second', "renewedAt" = now() WHERE scope = 'primary'`);
      expect(await services.get('UTC')!.tryAcquireFast(), 'UTC: 租约过期应可接管').toBe(true);
      await services.get('UTC')!.release();
      await leaseRow(Prisma.sql`UPDATE "CollabLease" SET owner = ${`tz-expired2-${Date.now()}`}, "expiresAt" = now() - interval '1 second', "renewedAt" = now() WHERE scope = 'primary'`);
      expect(await services.get('Asia/Shanghai')!.tryAcquireFast(), '+8: 租约过期应可接管（不得被 8h 墙掩盖）').toBe(true);
      await services.get('Asia/Shanghai')!.release();
    } finally {
      for (const s of services.values()) s.halt();
      await reset();
    }
  }, 30_000);

  it('probe（MediaProbePoller.claimImageBatch）：lease 3h 前到期=两时区均认领；nextProbeAt 未来=零触碰', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const poller = new MediaProbePoller(asPrisma(client), {} as never);
      const due = await prisma.media.create({ data: {
        userId: UID, teamId: TID, projectId, nodeId: `probe-due-${tz}`,
        key: `uploads/${TID}/tz-c14-probe-due-${tz}-${randomUUID()}.png`, originalName: 'a.png',
        mimeType: 'image/png', sniffedMimeType: 'image/png', size: 1n, type: 'uploaded',
        status: 'completed', probeState: 'running', probeLeaseUntil: new Date(Date.now() - 3 * HOUR), nextProbeAt: null,
      } });
      const notDue = await prisma.media.create({ data: {
        userId: UID, teamId: TID, projectId, nodeId: `probe-future-${tz}`,
        key: `uploads/${TID}/tz-c14-probe-future-${tz}-${randomUUID()}.png`, originalName: 'b.png',
        mimeType: 'image/png', sniffedMimeType: 'image/png', size: 1n, type: 'uploaded',
        status: 'completed', probeState: 'pending', nextProbeAt: new Date(Date.now() + HOUR),
      } });
      expect(await claimUntilSeen(() => poller.claimImageBatch(), due.id), `${tz}: probe 过期 lease 行应被认领`).toBe(true);
      const untouched = await prisma.media.findUniqueOrThrow({ where: { id: notDue.id } });
      expect(untouched.probeState, `${tz}: 未到期行零触碰`).toBe('pending');
      expect(untouched.probeLeaseUntil).toBeNull();
    }
  }, 60_000);

  it('materialize（MaterializeJob.claim）：到期=两时区均认领；nextMaterializeAt 未来=零触碰', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const job = new MaterializeJob(
        asPrisma(client), {} as never, {} as never, {} as never, {} as never, {} as never,
      );
      const base = {
        userId: UID, teamId: TID, projectId, mimeType: 'video/mp4', size: 1n,
        type: 'generated', status: 'processing',
      } as const;
      const due = await prisma.media.create({ data: {
        ...base, nodeId: `mz-due-${tz}`, key: `artifacts/${TID}/tz-c14-mz-due-${tz}-${randomUUID()}/0`,
        originalName: 'v.mp4',
        // I-1：两条时间分支都执行（原 all-NULL 使谓词空转）——nextMaterializeAt/lease 均 1h 前到期，
        // 历史回归形态（右值再降 8h）下 +8 会话两分支皆假 → 不认领=红
        nextMaterializeAt: new Date(Date.now() - HOUR), processingLeaseUntil: new Date(Date.now() - HOUR),
      } });
      const notDue = await prisma.media.create({ data: {
        ...base, nodeId: `mz-future-${tz}`, key: `artifacts/${TID}/tz-c14-mz-future-${tz}-${randomUUID()}/0`,
        originalName: 'v2.mp4', nextMaterializeAt: new Date(Date.now() + HOUR), processingLeaseUntil: null,
      } });
      expect(await claimUntilSeen(() => job.claim(), due.id), `${tz}: materialize 到期行应被认领`).toBe(true);
      const untouched = await prisma.media.findUniqueOrThrow({ where: { id: notDue.id } });
      expect(untouched.processingLeaseUntil, `${tz}: 未到期行零触碰`).toBeNull();
      expect(untouched.nextMaterializeAt?.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    }
  }, 60_000);

  it('projection-outbox（ProjectionOutboxPoller.claim）：nextAttemptAt 到期=两时区均认领；未来=零触碰', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const poller = new ProjectionOutboxPoller(asPrisma(client), {} as never, {} as never, {} as never, {} as never);
      const seed = (suffix: string, nextAttemptAt: Date) => prisma.artifactProjection.create({ data: {
        artifactId: `tz-c14-${TID}-${suffix}-${randomUUID()}`, artifactRev: 1, projectId,
        nodeId: `outbox-${suffix}-${tz}`, targetField: 'fileId', targetItemId: '',
        state: 'pending', nextAttemptAt, leaseUntil: null,
      } });
      const due = await seed('due', new Date(Date.now() - 3 * HOUR));
      const notDue = await seed('future', new Date(Date.now() + HOUR));
      expect(await claimUntilSeen(() => poller.claim(), due.id, 3), `${tz}: outbox 到期行应被认领`).toBe(true);
      const untouched = await prisma.artifactProjection.findUniqueOrThrow({ where: { id: notDue.id } });
      expect(untouched.state, `${tz}: 未到期行零触碰`).toBe('pending');
      expect(untouched.leaseUntil).toBeNull();
    }
  }, 60_000);

  it('object-manifest（ObjectManifestService.sweepOrphans）：未 claim 行龄门（DB now()）两时区一致', async () => {
    for (const tz of TZS) {
      const { client } = byTz[tz];
      const minio = { delete: async () => undefined };
      const manifests = new ObjectManifestService(asPrisma(client), minio as never);
      // I-1：26h 前（>24h 行龄门）——正确语义应删；历史回归形态右值再降 8h 后 = 32h 门，26h 行不删
      const dueKey = `tz-c14-${TID}-orphan-due-${tz}-${randomUUID()}`;
      const freshKey = `tz-c14-${TID}-orphan-fresh-${tz}-${randomUUID()}`;
      await prisma.objectManifest.create({ data: { objectKey: dueKey, state: 'LIVE', createdAt: new Date(Date.now() - 26 * HOUR) } });
      await prisma.objectManifest.create({ data: { objectKey: freshKey, state: 'LIVE', createdAt: new Date(Date.now() - HOUR) } });
      for (let i = 0; i < 10; i += 1) {
        await manifests.sweepOrphans();
        const row = await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: dueKey } });
        if (row.state === 'DELETED') break;
      }
      expect((await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: dueKey } })).state, `${tz}: 26h 前未 claim 行应被清扫`).toBe('DELETED');
      expect((await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: freshKey } })).state, `${tz}: 行龄门内行零触碰`).toBe('LIVE');
    }
  }, 60_000);

  it('erasure（ProjectErasureRunPoller.claim）：租约过期=两时区均认领；他主未过期=两时区均让位', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const poller = new ProjectErasureRunPoller(asPrisma(client), {} as never, {} as never);
      const claim = (id: string) => (poller as unknown as {
        claim(erasureId: string): Promise<unknown | null>;
      }).claim(id);
      const mkRun = (state: string, leaseUntil: Date | null, claimOwner: string | null) => prisma.projectErasureRun.create({ data: {
        // scopeId 唯一化：运行行 partial unique（scopeType+scopeId 活跃域）——本 spec 同项目需并行两行
        scopeType: 'project', scopeId: `${projectId}-${randomUUID()}`, requestedBy: UID, dryRun: false,
        state, leaseUntil, claimOwner,
      } });
      const expired = await mkRun('PENDING', new Date(Date.now() - 3 * HOUR), null);
      expect(await claim(expired.erasureId), `${tz}: 租约过期 run 应被认领`).not.toBeNull();
      const held = await mkRun('PENDING', new Date(Date.now() + 3 * HOUR), 'other-worker');
      expect(await claim(held.erasureId), `${tz}: 他主未过期 run 应让位`).toBeNull();
      expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: held.erasureId } })).claimOwner).toBe('other-worker');
    }
  }, 60_000);

  it('runtime-retention（RuntimeFeedRetentionService.sweepEventsInTx）：7d 时间窗两时区一致', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const svc = new RuntimeFeedRetentionService(asPrisma(client));
      await prisma.runtimeFeedCursor.create({ data: { projectId, lastSeq: 2n } });
      // I-1：距 7d 门 ±4h（跨判别窗）——历史回归形态右值再降 8h（=7d+8h 门）后 old 行不删
      const oldEvent = await prisma.runtimeEvent.create({ data: {
        projectId, generation: 0, feedSeq: 1n, kind: 't', payload: { x: 1 }, createdAt: new Date(Date.now() - (7 * DAY + 4 * HOUR)),
      } });
      const recentEvent = await prisma.runtimeEvent.create({ data: {
        projectId, generation: 0, feedSeq: 2n, kind: 't', payload: { x: 2 }, createdAt: new Date(Date.now() - (7 * DAY - 4 * HOUR)),
      } });
      await client.$transaction((tx) => svc.sweepEventsInTx(tx, 200, [projectId]));
      expect(await prisma.runtimeEvent.findUnique({ where: { id: oldEvent.id } }), `${tz}: 7d+4h 前事件应被清理`).toBeNull();
      expect(await prisma.runtimeEvent.findUnique({ where: { id: recentEvent.id } }), `${tz}: 7d-4h 前事件应保留`).not.toBeNull();
    }
  }, 60_000);

  it('execution-retention（ExecutionRequestRetentionService.sweepExpiredInTx）：expiresAt<now() 两时区一致', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const claimedIds: string[] = [];
      // claim 选择面证据：void 桩记录 claim 逐行 id（真实 void 面归 execution-request.retention.int.spec）
      const creditStub = {
        voidForExecutionRequestInTx: async (_tx: Prisma.TransactionClient, id: string) => { claimedIds.push(id); return false; },
      };
      const svc = new ExecutionRequestRetentionService(asPrisma(client), creditStub as never);
      const mkRequest = async (state: string, expiresAt: Date) => prisma.executionRequest.create({ data: {
        requestId: `req-${randomUUID()}`, projectId, generation: 0, historyId: 'tz-c14',
        docSeq: 0n, frozenDocSeq: 0n, userId: UID, teamId: TID, kind: 'text', state,
        reservedCredit: 0, totalCredit: 0, planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt,
      } });
      // I-1：due 改 4h 前（<8h 判别窗——历史回归形态右值再降 8h 后不 claim）；加 30d 最老锚（不参与断言）
      await mkRequest('ADMITTED', new Date(Date.now() - 30 * DAY));
      const due = await mkRequest('ADMITTED', new Date(Date.now() - 4 * HOUR));
      const notDue = await mkRequest('ADMITTED', new Date(Date.now() + 4 * HOUR));
      // 共享 dev 库残留可能占据前若干批（stub 不消费状态）——多次 sweep 直到命中或清空
      for (let i = 0; i < 3 && !claimedIds.includes(due.id); i += 1) {
        const before = claimedIds.length;
        await client.$transaction((tx) => svc.sweepExpiredInTx(tx));
        if (claimedIds.length === before) break;   // 无新 claim=共享库已空/全在窗内
      }
      expect(claimedIds, `${tz}: 4h 前过期 ADMITTED 行应被 claim`).toContain(due.id);
      expect(claimedIds, `${tz}: 未过期行零触碰`).not.toContain(notDue.id);
      expect((await prisma.executionRequest.findUniqueOrThrow({ where: { id: notDue.id } })).state).toBe('ADMITTED');
    }
  }, 60_000);

  it('heartbeat（GenerationIntentService.tickFence 写 now()）：心跳 instant 两时区一致 ∧ DB 钟邻近', async () => {
    for (const tz of TZS) {
      const { client, projectId } = byTz[tz];
      const intent = await createIntentFixture(asPrisma(prisma), {
        projectId, nodeId: `hb-${tz}`, userId: UID, teamId: TID,
        intentId: `iid-${randomUUID()}`, kind: 'text', paramsHash: 'a'.repeat(64), creditCost: 0,
      });
      const svc = new GenerationIntentService(asPrisma(client), {} as never, {} as never);
      expect(await svc.tickFence(intent.id, intent.execSeq), `${tz}: RUNNING∧同代应命中`).toBeUndefined();
      const readBack = async (c: PrismaClient) => {
        const rows = await c.$queryRaw<Array<{ heartbeatAt: Date; dbNow: Date }>>`
          SELECT "heartbeatAt", now() AS "dbNow" FROM "GenerationIntent" WHERE "id" = ${intent.id}::text`;
        return rows[0];
      };
      const own = await readBack(client);
      const cross = await readBack(byTz[tz === 'UTC' ? 'Asia/Shanghai' : 'UTC'].client);
      expect(cross.heartbeatAt.getTime(), `${tz}: 跨时区读回 instant 必须相等`).toBe(own.heartbeatAt.getTime());
      const ageFromDbClock = own.dbNow.getTime() - own.heartbeatAt.getTime();   // DB 钟比较（非 Node 钟）
      expect(ageFromDbClock).toBeGreaterThanOrEqual(0);
      expect(ageFromDbClock).toBeLessThan(60_000);                               // 8h 偏斜必红
    }
  }, 60_000);

  it('@default/@updatedAt/round-trip（CanvasProject）：两时区读回 instant 相等 ∧ 列型 tsz ∧ @updatedAt 前进', async () => {
    const created = await prisma.canvasProject.create({ data: { name: `tz-rt-${Date.now()}`, teamId: TID, userId: UID } });
    const read = (c: PrismaClient) => c.$queryRaw<Array<{
      createdAt: Date; updatedAt: Date; dbNow: Date; createdAtType: string; updatedAtType: string;
    }>>`
      SELECT "createdAt", "updatedAt", now() AS "dbNow",
             pg_typeof("createdAt")::text AS "createdAtType", pg_typeof("updatedAt")::text AS "updatedAtType"
      FROM "CanvasProject" WHERE "id" = ${created.id}::text`;
    const utcBefore = (await read(byTz.UTC.client))[0];
    const shBefore = (await read(byTz['Asia/Shanghai'].client))[0];
    // 判别面（评审核 C1-4 Minor-3）：列型非 tsz（naive）即红——DB 钟 age 正负不独证无偏斜
    expect(utcBefore.createdAtType, 'createdAt 列型须为 timestamptz').toBe('timestamp with time zone');
    expect(utcBefore.updatedAtType, 'updatedAt 列型须为 timestamptz').toBe('timestamp with time zone');
    expect(shBefore.createdAt.getTime()).toBe(utcBefore.createdAt.getTime());
    expect(shBefore.updatedAt.getTime()).toBe(utcBefore.updatedAt.getTime());
    expect(utcBefore.dbNow.getTime() - utcBefore.createdAt.getTime()).toBeGreaterThanOrEqual(0);   // @default(now()) DB 钟
    expect(utcBefore.dbNow.getTime() - utcBefore.createdAt.getTime()).toBeLessThan(60_000);
    await prisma.canvasProject.update({ where: { id: created.id }, data: { name: `${created.name}-2` } });
    const utcAfter = (await read(byTz.UTC.client))[0];
    const shAfter = (await read(byTz['Asia/Shanghai'].client))[0];
    expect(shAfter.updatedAt.getTime()).toBe(utcAfter.updatedAt.getTime());
    expect(utcAfter.updatedAt.getTime()).toBeGreaterThan(utcBefore.updatedAt.getTime());       // @updatedAt/触发器均前进
    expect(utcAfter.dbNow.getTime() - utcAfter.updatedAt.getTime()).toBeGreaterThanOrEqual(0);
    expect(utcAfter.dbNow.getTime() - utcAfter.updatedAt.getTime()).toBeLessThan(60_000);
    // 本用例新建的 CanvasProject 行随 team cascade 清理（afterAll deleteTeamsWithPass——非 byTz project 域）
  }, 30_000);

  it('epochStartedAt（SystemHistory）：DB 钟比较（SQL 内 now()/EXTRACT）——两时区同 instant，无 8h 平移', async () => {
    const query = (c: PrismaClient) => c.$queryRaw<Array<{ epochMs: number; ageSeconds: number }>>`
      SELECT (EXTRACT(EPOCH FROM "epochStartedAt") * 1000)::float8 AS "epochMs",
             EXTRACT(EPOCH FROM (now() - "epochStartedAt"))::float8 AS "ageSeconds"
      FROM "SystemHistory" WHERE id = 1`;
    const utc = (await query(byTz.UTC.client))[0];
    const sh = (await query(byTz['Asia/Shanghai'].client))[0];
    expect(utc, 'SystemHistory id=1 权威行缺失').toBeTruthy();
    // 判别面（M8）：`EXTRACT(EPOCH FROM timestamp)` 本身会话无关——本用例的判别来自
    // ① `now() - "epochStartedAt"` 混合减法（naive 列按会话时区重解释 → age 8h 分叉）；
    // ② 两会话 epochMs 相等（naive 列经 pg 客户端读回按进程时区解析，与 DB 内 EXTRACT 值不一致）。
    expect(sh.epochMs).toBe(utc.epochMs);
    expect(Math.abs(sh.ageSeconds - utc.ageSeconds)).toBeLessThan(1);   // 会话无关的 DB 钟差
    expect(utc.ageSeconds).toBeGreaterThanOrEqual(0);                   // 纪元不晚于 DB 现在（DB 钟判据，不混 Node 钟）
  }, 30_000);
});
