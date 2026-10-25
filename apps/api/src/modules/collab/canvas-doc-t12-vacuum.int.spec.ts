// apps/api/src/modules/collab/canvas-doc-t12-vacuum.int.spec.ts
// Y1c T12（偏离 27/D2——真 PG int 池）：vacuum=generation++/新 docName(#g) 换代通道 DB 面。
// ①vacuumReplace 连续 seq 形态：新代快照 (g+1,rev0) 装载基线=旧代 maxSeq+旧代行同事务整删+
//   generation/vacuumEpoch（遥测 +1）落列+preVacuumSv 列退役（迁移 20261024160000——列在即红）。
// ②schemaVersion⇒generation 启动断言（spec §2 v5-5——违反拒启）：schemaVersion>current（downgrade
//   形态）与 schemaVersion≠current∧generation=0（未按「schema 硬切换必换代/清行」纪律收口）两类拒启；
//   正常行（sv=current）放行。
// ③T12 复核残留 I1.2 修红测（评审探针 3 真 PG 实证形态固化——era 定格 DB 真值化+expectedGeneration
//   改 ④ 源）：beginVacuumEra era 旧源=docGeneration.get(pid)??0（进程内）——doc 未装载投影恒 0
//   ⇒ Part A era≠DB 真值+4410 载荷 target 错（=1 非真代+1）；Part B expectedGeneration=0 ≠ 锁内
//   实读 ⇒ 永久 generation-drift 中止（可达：REST 显式 vacuum 不要求 doc 装载——gen≥1 项目重启后
//   首次/同进程连续第二次〔purge ③ 后 docGeneration 已清〕）。
// 运行：DATABASE_URL=postgresql://… pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabGateway } from './collab.gateway';
import { CollabShrinkService } from './collab-shrink.service';
import { CollabSpoolService } from './collab-spool.service';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { canvasDocName } from './doc-name.util';
import { createCanvasDoc } from './canvas-doc.factory';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';

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

    // ⑥ vacuumReplace（T12 收口 I1.2 四参形态——expectedGeneration=④ 装载读行值 0：本布景 DB gen=0 对齐）
    const state = vacuumState();
    const replaced = await repo.vacuumReplace(PID, state, 3, 0);
    if ('aborted' in replaced) throw new Error(`vacuumReplace 意外 aborted（I1.2 判别面）: ${replaced.dbGeneration}`);
    const { generation } = replaced;
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

// ══ ③ T12 复核残留 I1.2 修（红测——评审探针 3 真 PG 实证形态固化）══
//  era 旧源=docGeneration.get(pid)??0（进程内投影）：doc 未装载（REST 显式 vacuum 不要求装载）
//  ⇒ 投影恒 0——Part A era≠DB 真值（4410 载荷 target=1 非真代+1）；Part B vacuumCore ⑥
//  expectedGeneration=era.current=0 ≠ 锁内实读 generation ⇒ aborted generation-drift——且无
//  装载回种即**永久中止**（同进程第二次 vacuum 时 purge ③ 已清 docGeneration，投影再恒 0）。
//  装置：真 PG repo 直构 gateway（shrink.spec buildGateway 先例）+CollabShrinkService 直构
//  （perm mock/docs mock）——doc 恒不装载（documents Map 空+无 loadDocument 调用）。
const PID_ERA = 'y1c-t12-vacuum-int-era';

maybe('Y1c T12 复核残留 I1.2：era 定格 DB 真值化+expectedGeneration ④ 源（真 PG——未装载 REST vacuum 形态）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const spoolCleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => { await ensureProjectFixture(prisma, PID_ERA); });
  beforeEach(async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID_ERA } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID_ERA } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID_ERA } });
  });
  afterAll(async () => {
    for (const c of spoolCleanups.splice(0)) await c();
    await cleanupProjectFixture(prisma, PID_ERA);
    await prisma.$disconnect();
  });

  /** 布景：CanvasDoc 行 generation=g+指针快照 (g,rev0)——doc 未装载（gen≥1 项目重启后形态） */
  async function seedUnloadedDoc(generation: number): Promise<void> {
    const doc = createCanvasDoc();
    doc.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]));
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    await prisma.$executeRaw`INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion")
      VALUES (${PID_ERA}::text, ${generation}::int, 0::bigint, 0::bigint, ${state}, ${createHash('sha256').update(state).digest('hex')}::char(64), 0::int, 3::int)`;
    await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "currentSnapshotRev", "updatedAt")
      VALUES (${PID_ERA}::text, ${generation}::int, 3::int, 0::bigint, now())`;
  }

  /** 直构 gateway（真 PG repo——DR era 定格 DB 读单源）+shrink service（REST vacuum 调用面） */
  async function buildKit(): Promise<{ gateway: CollabGateway; svc: CollabShrinkService }> {
    const d = await makeSpoolDir('y1c-t12-era-');
    spoolCleanups.push(d.cleanup);
    const spool = new CollabSpoolService(d.dir);
    spool.setOwner('t12-era-owner');
    const gateway = new CollabGateway(
      {} as any, new EventEmitter2() as any, repo as any, createLeaseStub() as any,
      { resolve: vi.fn() } as any,
      48100 + Math.floor(Math.random() * 1500),
      undefined, undefined, undefined, spool,
    );
    gatewayFacade(gateway).forceCollabState('serving');
    const svc = new CollabShrinkService(
      { assertEditorWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) } as any,
      { invalidateSnapshotCache: vi.fn() } as any,
      gateway,
      {} as any, {} as any,
      repo,
    );
    return { gateway, svc };
  }

  it('era 定格=DB 真值（未装载形态——4410 载荷面）：gen=1 布景 doc 未装载 ⇒ 定格 {current:1,target:2}（红=进程内投影 {current:0,target:1}）', async () => {
    await seedUnloadedDoc(1);
    const { gateway } = await buildKit();
    expect(gateway.docRegistry.generationOf(PID_ERA)).toBeUndefined();   // 未装载前提锚（docGeneration 无键）
    await gateway.beginVacuumEra(PID_ERA);
    expect(gateway.docRegistry.vacuumEraGeneration(PID_ERA)).toEqual({ current: 1, target: 2 });   // Part A：红=旧 {current:0,target:1}
    expect(gateway.docRegistry.vacuumTargetGeneration(PID_ERA)).toBe(2);   // 4410 载荷 target=真代+1（红=旧 1）
    gateway.setVacuuming(PID_ERA, false);   // 纪元态清理（setVacuuming(false) 统一出口）
  });

  it('未装载 doc 连续二次 REST vacuum：gen=1 布景 ⇒ 两次均成功换代 1→2→3（红=era 投影恒 0 ⇒ expectedGeneration=0≠DB ⇒ 永久 generation-drift 中止）', async () => {
    await seedUnloadedDoc(1);
    const { svc } = await buildKit();
    const r1 = await svc.vacuum(PID_ERA, 'u1');
    expect(r1.result).toBe('ok');   // Part B：红=旧 'generation-drift'（era.current=0 投影 ⇒ ⑥ 锁内复核 1≠0 中止）
    expect(r1.generation).toBe(2);
    // 第一次 vacuum purge ③ 后 docGeneration 已清+无装载回种——同进程连续第二次（形态②：era 再读 DB=2）
    const r2 = await svc.vacuum(PID_ERA, 'u1');
    expect(r2.result).toBe('ok');   // 红=旧形态第二次仍 era 投影 0=永久 generation-drift（直到某次装载回种）
    expect(r2.generation).toBe(3);
    const head = await prisma.$queryRaw<{ generation: number }[]>`SELECT generation FROM "CanvasDoc" WHERE "projectId" = ${PID_ERA}::text`;
    expect(head[0].generation).toBe(3);
    expect(canvasDocName(PID_ERA, 3)).toBe(`project:${PID_ERA}#g3`);   // 换代通道 DB 面（① 同锚）
  });
});
