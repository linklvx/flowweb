// apps/api/src/modules/collab/updated-at-triggers.int.spec.ts —— C1-5（地基修复批·C1 卡）updatedAt
// 触发器语义四条钉（spec 2026-11-11 foundation-batch §3.3-2：UPDATE 始终 now()／INSERT 仅 NULL 设／
// restore 运维通道 SET LOCAL app.skip_updated_at 首行 GUC 检查；plan v3 Task C1-5）。
//   ① UPDATE 自动 now：raw UPDATE 不带 updatedAt → 触发器写 now()（严格 > 原值；无触发器则行值不动——红证）。
//   ② GUC restore 通道：`SET LOCAL app.skip_updated_at='on'` 下 UPDATE 显式历史值不被改写——判别面=
//      **GUC 检查先于 TG_OP 分支**（若分支在前，UPDATE 分支恒 now() 必盖掉历史值）；附加首行语义证：
//      同 GUC 下 INSERT 显式 NULL 落 NOT NULL 拒（INSERT 分支亦被跳过）——非"仅跳 UPDATE"。
//   ③ INSERT 语义两分：显式历史值保留（restore/backfill/测试布景）；显式 NULL → now()（BEFORE 触发器
//      先于 NOT NULL 约束，故省略/显式 NULL 均能建档——无触发器时 INSERT 直接 23502 拒）。
//   ④ appendBatch canary 窗：canary pin 存活窗内 appendBatch 的 raw 水面（懒建档 INSERT 显式 now()+水位
//      raw UPDATE 不带 updatedAt）经触发器正确落 updatedAt；且 pin 窗机制不受影响——pin 坐标四列零变
//      （appendBatch 不触 CanaryPin）+readAt(pin 坐标) 仍恰重放 pin 帧前缀（pgSeqAt 之外新帧不入面）。
//      读码结论：appendBatch 水位 UPDATE（canvas-doc-update.repository.ts:303-312 两形态）不写 updatedAt
//      ——updatedAt 的真值源=本触发器；pin 只被 poller 清扫/worker compare-and-delete/vacuum·purge 谓词读。
// 既有面不重复：c3a-schema.int.spec.ts ③ 已钉 ProjectionBackfillState 的 INSERT 显式保留+UPDATE 严格前进
// （Prisma delegate 面）；本文件补齐 raw SQL 面（触发器对 raw 写路径=唯一 updatedAt 写者）+GUC 首行+canary 窗。
// 无 DATABASE_URL（CI 未起库）自动 skip（int 池惯例）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

/** 本文件独占项目宇宙（int 池串行但共享 dev 库——PID/表名前缀隔离，afterAll 清零）。 */
const PID = 'c15-updated-at-triggers';
// VideoTag.name=VarChar(32)——短前缀（c15-+base36 时间戳≈12 字符，后缀均 <32）。
const TAG = `c15-${Date.now().toString(36)}`;
const CLOCK_TOLERANCE_MS = 5_000;   // now() 落定断言窗（**本机同钟前提**：DB 与 Node 同宿主）

/** 节点相异载荷（同字节帧被 updateHash 幂等吞——④ 需两帧内容可区分）。 */
const frameOf = (key: string, model: string): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', model);
  node.set('type', 'textInput'); node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(key, node);
  return Y.encodeStateAsUpdate(d);
};

maybe('C1-5：updatedAt 触发器语义（真 PG——spec §3.3-2）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID, 'c15-updated-at');
  }, 20_000);

  afterAll(async () => {
    await prisma.canaryPin.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.videoTag.deleteMany({ where: { name: { startsWith: TAG } } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  }, 20_000);

  it('① UPDATE 自动 now：raw UPDATE 不带 updatedAt → 列变 now()（严格 > 原值）', async () => {
    const name = `${TAG}-upd`;
    const hist = new Date(Date.now() - 60_000);
    await prisma.$executeRaw`
      INSERT INTO "VideoTag" ("id", "name", "createdAt", "updatedAt")
      VALUES (${name}, ${name}, now(), ${hist}::timestamptz)`;
    const inserted = await prisma.videoTag.findUniqueOrThrow({ where: { name } });
    expect(inserted.updatedAt.getTime()).toBe(hist.getTime());   // INSERT 显式值保留（③ 同面——此处作基线）

    // 不带 updatedAt 的 raw UPDATE（UPDATE 分支恒 now——无触发器时行值保持 hist，严格 > 必红）
    await prisma.$executeRaw`UPDATE "VideoTag" SET "sortOrder" = "sortOrder" + 1 WHERE "name" = ${name}`;
    const updated = await prisma.videoTag.findUniqueOrThrow({ where: { name } });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(hist.getTime());
    expect(Math.abs(updated.updatedAt.getTime() - Date.now())).toBeLessThan(CLOCK_TOLERANCE_MS);
  });

  it('② GUC restore 通道：SET LOCAL app.skip_updated_at=on 下 UPDATE 显式历史值不被改写（GUC 检查先于 TG_OP 分支）', async () => {
    const name = `${TAG}-guc`;
    const hist = new Date(Date.now() - 3_600_000);
    await prisma.$executeRaw`
      INSERT INTO "VideoTag" ("id", "name", "createdAt", "updatedAt")
      VALUES (${name}, ${name}, now(), ${hist}::timestamptz)`;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.skip_updated_at = 'on'`);
      // 显式历史值 + 一次真实内容变更（restore/backfill 形态）：GUC 首行检查 ⇒ RETURN NEW 直通，
      // UPDATE 分支的 NEW.updatedAt=now() 不执行；若 GUC 检查在 TG_OP 分支之后 ⇒ 历史值被盖成 now（红）。
      await tx.$executeRaw`
        UPDATE "VideoTag" SET "updatedAt" = ${hist}::timestamptz, "sortOrder" = "sortOrder" + 1 WHERE "name" = ${name}`;
    }, { timeout: 10_000, maxWait: 2_000 });
    const restored = await prisma.videoTag.findUniqueOrThrow({ where: { name } });
    expect(restored.updatedAt.getTime()).toBe(hist.getTime());   // 历史值原样（未被 now 覆盖）
    expect(restored.sortOrder).toBe(1);                          // 内容变更真实落库（非整行 no-op）

    // 首行语义附加证：同 GUC 下 INSERT 分支亦被跳过（显式 NULL 不被补 now）——落 NOT NULL 拒。
    // 若 GUC 只跳 UPDATE（检查位在分支内/后），INSERT 会被补 now 而成功——本断言即红。
    const nullName = `${TAG}-gucnull`;
    const failure = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.skip_updated_at = 'on'`);
      await tx.$executeRaw`
        INSERT INTO "VideoTag" ("id", "name", "updatedAt") VALUES (${nullName}, ${nullName}, NULL::timestamptz)`;
    }, { timeout: 10_000, maxWait: 2_000 }).then(() => null, (e: Error) => e);
    expect(failure, 'GUC 首行通道下 INSERT 分支须被跳过（NULL 不被补 now）——补 now 即成功=红').not.toBeNull();
    expect(failure!.message).toContain('23502');   // NOT NULL 违反（SQLSTATE 断言——PG 消息本地化无关）
    expect(await prisma.videoTag.count({ where: { name: nullName } })).toBe(0);
  });

  it('③ INSERT 两分：显式历史值保留（restore/backfill）；显式 NULL → now()', async () => {
    const explicitName = `${TAG}-ins`;
    const hist = new Date(Date.now() - 86_400_000);
    await prisma.$executeRaw`
      INSERT INTO "VideoTag" ("id", "name", "createdAt", "updatedAt")
      VALUES (${explicitName}, ${explicitName}, now(), ${hist}::timestamptz)`;
    expect((await prisma.videoTag.findUniqueOrThrow({ where: { name: explicitName } })).updatedAt.getTime())
      .toBe(hist.getTime());

    // 显式 NULL（=省略列）：BEFORE 触发器先于 NOT NULL 约束 ⇒ INSERT 分支补 now()——无触发器=23502 拒（红）
    const nullName = `${TAG}-null`;
    await prisma.$executeRaw`
      INSERT INTO "VideoTag" ("id", "name", "updatedAt") VALUES (${nullName}, ${nullName}, NULL::timestamptz)`;
    const nullRow = await prisma.videoTag.findUniqueOrThrow({ where: { name: nullName } });
    expect(Math.abs(nullRow.updatedAt.getTime() - Date.now())).toBeLessThan(CLOCK_TOLERANCE_MS);
  });

  it('④ appendBatch canary 窗：pin 存活窗内 raw 写路径经触发器落 updatedAt；pin 坐标机制不受影响', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.canaryPin.deleteMany({ where: { projectId: PID } });
    await ensureLeaseFixture(prisma, repo);
    try {
      // 首帧：懒建档 raw INSERT（repository 显式 now()——INSERT 分支仅 NULL 设，显式值不动）
      const f1 = frameOf('c15-a', 'm1');
      expect(await repo.appendBatch(PID, [seedRow(f1, 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n }))
        .toEqual({ ok: true, rows: 1 });
      const doc1 = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
      expect(doc1.pgSeq).toBe(1n);
      expect(Math.abs(doc1.updatedAt.getTime() - Date.now())).toBeLessThan(CLOCK_TOLERANCE_MS);

      // pin 进入存活窗（READY∧expiresAt>now——捕获协议落定形；坐标为 pgSeq=1 点）
      await prisma.$executeRaw`
        INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
        VALUES (${PID}, 'READY', ${doc1.generation}::int, 0::bigint, 1::bigint, 1::bigint, 1::int,
          now() + make_interval(secs => 900), now() + make_interval(secs => 900))`;
      const pin0 = await prisma.canaryPin.findUniqueOrThrow({ where: { projectId: PID } });

      // 窗内第二帧：pgSeq 1→2 的 raw 水位 UPDATE 不带 updatedAt——触发器是 updatedAt 唯一写者。
      // Timestamptz(3)=毫秒精度：与首帧同毫秒时 now() 等值会假红——前移 3ms 消歧（缺触发器时仍等值红，
      // 判别力不损）。
      await new Promise((r) => setTimeout(r, 3));
      const f2 = frameOf('c15-b', 'm2');
      expect(await repo.appendBatch(PID, [seedRow(f2, 2n)], { expectedPgSeq: 1n, newPgSeq: 2n, walCheckpointSeq: 2n }))
        .toEqual({ ok: true, rows: 1 });
      const doc2 = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
      expect(doc2.pgSeq).toBe(2n);
      expect(doc2.updatedAt.getTime()).toBeGreaterThan(doc1.updatedAt.getTime());   // 触发器在 appendBatch 热路径生效（红=缺触发器时列不动）

      // pin 窗机制零触碰：坐标/哈希/租约/过期四列原样（appendBatch 不写 CanaryPin——pin 只由 poller
      // 清扫/worker compare-and-delete/vacuum·purge 谓词消费；窗内阻塞面不因 append 扩大或缩短）
      expect(await prisma.canaryPin.findUniqueOrThrow({ where: { projectId: PID } })).toEqual(pin0);

      // readAt 以 pin 坐标锚定：pgSeqAt=1 之外的新帧（seq 2）不入重放面——窗内可读性不被 append 破坏
      const read = await repo.readAt(PID, pin0.generation, pin0.snapshotRev, pin0.pgSeqAt);
      expect(read.state).toBeNull();   // genesis 回退坐标（rev 0 无快照行=折空全量重放）
      expect(read.updates.length).toBe(1);
      expect(Buffer.compare(read.updates[0], Buffer.from(f1))).toBe(0);
      const replayed = new Y.Doc();
      Y.applyUpdate(replayed, new Uint8Array(read.updates[0]));
      expect((replayed.getMap('nodes').get('c15-a') as Y.Map<unknown>).get('type')).toBe('textInput');
      expect(replayed.getMap('nodes').get('c15-b')).toBeUndefined();
      replayed.destroy();
    } finally {
      await prisma.canaryPin.deleteMany({ where: { projectId: PID } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    }
  });
});
