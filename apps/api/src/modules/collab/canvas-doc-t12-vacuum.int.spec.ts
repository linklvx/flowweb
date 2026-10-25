// apps/api/src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts
// Y1c T12（偏离 27/D2——真 PG int 池）：vacuum=generation++/新 docName(#g) 换代通道 DB 面。
// ①vacuumReplace 连续 seq 形态：新代快照 (g+1,rev0) 装载基线=旧代 maxSeq+旧代行同事务整删+
//   generation/vacuumEpoch（遥测 +1）落列+preVacuumSv 列退役（迁移 20261024160000——列在即红）。
// ②schemaVersion⇒generation 启动断言（spec §2 v5-5——违反拒启）：schemaVersion>current（downgrade
//   形态）与 schemaVersion≠current∧generation=0（未按「schema 硬切换必换代/清行」纪律收口）两类拒启；
//   正常行（sv=current）放行。
// 运行：DATABASE_URL=postgresql://… pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { canvasDocName } from './doc-name.util';
import { createCanvasDoc } from './canvas-doc.factory';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const PID = 'y1c-t12-vacuum-int';

maybe('Y1c T12 vacuum 换代通道（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  repo.setLeaseOwner('t12-int-owner');

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  });

  /** 真空态字节（fresh clientID 重写形态——一节点 doc 全量编码） */
  function vacuumState(): Buffer {
    const doc = createCanvasDoc();
    doc.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]));
    const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    return bytes;
  }

  it('①vacuumReplace 连续 seq：generation++ + 新代快照 (g+1,rev0) 基线=旧代 maxSeq + 旧代行同事务整删 + vacuumEpoch 遥测 +1 + preVacuumSv 列退役', async () => {
    // 布景：gen0 头（快照 rev0 基线 0）+ 三行旧代增量（seq 1..3——insert-ratchet 形态直插）
    const state0 = Buffer.from([0, 0]);   // 空 update 合法种子
    await prisma.$executeRaw`INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion")
      VALUES (${PID}::text, 0::int, 0::bigint, 0::bigint, ${state0}, ${createHash('sha256').update(state0).digest('hex')}::char(64), 0::int, 3::int) ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt")
      VALUES (${PID}::text, 0::int, 3::int, now()) ON CONFLICT DO NOTHING`;
    for (let seq = 1n; seq <= 3n; seq++) {
      const upd = Buffer.from(Y.encodeStateAsUpdate(createCanvasDoc()));
      await prisma.$executeRaw`INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
        VALUES (${PID}::text, 0::int, ${seq}::bigint, ${seq}::bigint, 1::int, ${'h' + String(seq).padStart(63, '0')}::char(64), ${upd}, now()) ON CONFLICT DO NOTHING`;
    }

    // ⑥ vacuumReplace（T12 三参形态——preVacuumSv 参数退役）
    const state = vacuumState();
    const { generation } = await repo.vacuumReplace(PID, state, 3);
    expect(generation).toBe(1);

    // 换代通道 name 面：canonical wire 名跨代互异（generation/docName 必变——v1.3 同 name 反例死）
    expect(canvasDocName(PID, 0)).not.toBe(canvasDocName(PID, generation));
    expect(canvasDocName(PID, generation)).toBe(`project:${PID}#g1`);

    // 新代快照 (1, rev 0)：stateSeq=旧代 maxSeq（连续 seq——I2 ① 对齐）+stateHash=SHA-256
    const snap = await prisma.$queryRaw<{ stateSeq: bigint; stateHash: string; vacuumEpoch: number }[]>`
      SELECT "stateSeq", "stateHash", "vacuumEpoch" FROM "CanvasDocSnapshot"
      WHERE "projectId" = ${PID}::text AND generation = 1::int AND "snapshotRev" = 0::bigint`;
    expect(snap).toHaveLength(1);
    expect(snap[0].stateSeq).toBe(3n);
    expect(snap[0].stateHash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(snap[0].vacuumEpoch).toBe(1);   // 遥测计数 +1（无行为分支）
    // 头行：generation=1+指针 rev0+purgeBelow 清档+vacuumEpoch 同步
    const head = await prisma.$queryRaw<{ generation: number; currentSnapshotRev: bigint; purgeBelowSeq: bigint | null; vacuumEpoch: number; pgSeq: bigint; walCheckpointSeq: bigint }[]>`
      SELECT generation, "currentSnapshotRev", "purgeBelowSeq", "vacuumEpoch", "pgSeq", "walCheckpointSeq" FROM "CanvasDoc" WHERE "projectId" = ${PID}::text`;
    expect(head[0].generation).toBe(1);
    expect(head[0].currentSnapshotRev).toBe(0n);
    expect(head[0].purgeBelowSeq).toBeNull();
    expect(head[0].vacuumEpoch).toBe(1);
    // 水位重置预演（T27 SWITCHING 全量重置的前置义务）：pgSeq/walCheckpointSeq **保留**（连续 seq）
    expect(head[0].pgSeq).toBe(0n);
    // 旧代增量行同事务整删（readConsistent 无 generation 过滤=设计——正确性由整删构造保证）
    const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(rows[0].n).toBe(0);
    // preVacuumSv 列退役（迁移 20261024160000——列在即红；verify-indexes.sql 否定断言同锚）
    const col = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'CanvasDoc' AND column_name = 'preVacuumSv'`;
    expect(col[0].n).toBe(0);
  });

  it('②schemaVersion⇒generation 启动断言（违反拒启）：downgrade 形态（sv>current）与未收口旧 schema 行（sv≠current∧gen=0）拒；正常行放行', async () => {
    // ①正常行（本 PID 换代后 gen=1、sv=3=current）——放行（含 sv≠current∧gen>0 的换代收口形态）
    await expect(repo.assertSchemaGenerationDiscipline()).resolves.toBeUndefined();
    // ②未收口旧 schema 行：sv=2（≠current）∧ gen=0 ⇒ 拒启
    const pidBad = PID + '-bad';
    await ensureProjectFixture(prisma, pidBad);
    await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt")
      VALUES (${pidBad}::text, 0::int, 2::int, now()) ON CONFLICT DO NOTHING`;
    await expect(repo.assertSchemaGenerationDiscipline()).rejects.toMatchObject({ schemaGenerationViolation: true });
    await cleanupProjectFixture(prisma, pidBad);
    // ③downgrade 形态：sv=99（>current）即使 gen>0 ⇒ 拒启（新版数据不可由旧代码解释）
    const pidNew = PID + '-new';
    await ensureProjectFixture(prisma, pidNew);
    await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt")
      VALUES (${pidNew}::text, 4::int, 99::int, now()) ON CONFLICT DO NOTHING`;
    await expect(repo.assertSchemaGenerationDiscipline()).rejects.toMatchObject({ schemaGenerationViolation: true });
    await cleanupProjectFixture(prisma, pidNew);
    // 收尾：本批布景无残留违例
    await expect(repo.assertSchemaGenerationDiscipline()).resolves.toBeUndefined();
  });
});
