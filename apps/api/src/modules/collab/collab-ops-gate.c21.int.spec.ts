// C2-1（plan Task C2-1——生产就绪收尾批·replay-canary 第二任务）：OpsGate 主体红①②③（真 PG）。
//  红① 三档语义：两行 OPEN→open / 全局行 FROZEN→拒 / 项目行 FROZEN→拒 / 任一行缺→fail-closed /
//    查询异常→fail-closed（授权读面）。
//  红② freeze：直调 freeze（C2-2 canary fail 面接线前的红证形态）→ 该 pid 项目行 FROZEN+他项目
//    OPEN+version+1；frozen_age gauge（全局 max——boot 扫行初始化+refresh 聚合）。
//  红③ 锁语义+两行校验：授权读 pass 后、发布事务提交前 frozen 到达→abandoned 零写（真事务序列化
//    复现——C1-1 红④ 双 PrismaClient 并发夹具先例）+FOR SHARE 与 freeze UPDATE 互斥（并发夹具）
//    +vacuumReplace 前置 gate 检查（拒=aborted 档零换代）。
//  解冻 ack：unfreezeOpsGateCompact（state 回 OPEN+unfrozenAt+version+1+AuditLog 同事务落痕——
//  HTTP 端点归 C2-3；spec v5 R9「人工 ack」文字无载体定义，本裁定=service 方法）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabCompactPoller } from './collab-compact.poller';
import {
  readOpsGateCompact, checkOpsGateCompactForShare, freezeOpsGateCompact, unfreezeOpsGateCompact,
  refreshOpsGateFrozenAgeGauge,
} from './collab-ops-gate.service';
import { OPS_GATE_COMPACT } from './project-governance.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const gaugeValue = async (name: string): Promise<number> => {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === name) as
    { values: { value: number }[] } | undefined;
  return m?.values[0]?.value ?? 0;
};
const counterValue = async (result: string): Promise<number> => {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === 'compact_gate_skip_total') as
    { values: { labels: Record<string, string>; value: number }[] } | undefined;
  return m?.values.find((v) => v.labels.result === result)?.value ?? 0;
};

// ══ 查询异常→fail-closed（无 DB 依赖——stub 面；svDominates 纯函数锚同族不 gate） ══
describe('C2-1 红① 查询异常→fail-closed（stub client）', () => {
  it('授权读 $queryRaw throw ⇒ {open:false,result:"fail-closed"}（不 throw 逸出——消费面 compact ① 早退）', async () => {
    const broken = {
      $queryRaw: async () => { throw new Error('connection refused'); },
    };
    await expect(readOpsGateCompact(broken, 'p1')).resolves.toEqual({ open: false, result: 'fail-closed' });
  });
});

maybe('C2-1 OpsGate 主体（真 PG——红①②③+解冻 ack+vacuum 前置）', () => {
  const prisma = new PrismaClient();
  const prismaB = new PrismaClient();   // 红③ 第二实例（并发交错/互斥夹具——C1-1 红④ 先例）
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const PID_A = `int-c21-gate-a-${Date.now()}`;
  const PID_B = `int-c21-gate-b-${Date.now()}`;

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID_A);
    await ensureProjectFixture(prisma, PID_B);
    // gate 两项目行显式落（spec 自持——ensureProjectFixture 的 gate 行 seed 为接线便利面非本 spec 依赖）
    for (const pid of [PID_A, PID_B]) {
      await prisma.$executeRaw`
        INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES (${OPS_GATE_COMPACT}, ${pid}, 'OPEN')
        ON CONFLICT DO NOTHING`;
    }
  });
  beforeEach(async () => {
    await ensureLeaseFixture(prisma, repo);
    // 每用例复位：两项目行回 OPEN+清冻结面（version 不复位——幂等断言用相对值）
    await prisma.$executeRaw`
      UPDATE "CollabOpsGate" SET "state" = 'OPEN', "frozenAt" = NULL, "frozenBy" = NULL, "reason" = NULL, "unfrozenAt" = NULL
      WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" IN (${PID_A}, ${PID_B})`;
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [PID_A, PID_B] } } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: { in: [PID_A, PID_B] } } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: { in: [PID_A, PID_B] } } });
  });
  afterAll(async () => {
    await prisma.collabOpsGate.deleteMany({ where: { gate: OPS_GATE_COMPACT, projectId: { in: [PID_A, PID_B] } } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID_A);
    await cleanupProjectFixture(prisma, PID_B);
    await prisma.$disconnect();
    await prismaB.$disconnect();
  });

  /** 节点相异载荷（同字节帧被 updateHash 幂等吞——count 锚失真）。 */
  const frameOf = (key: string, n: number) => {
    const d = new Y.Doc();
    d.getMap('nodes').set(key, new Y.Map([['x', n]]));
    return Y.encodeStateAsUpdate(d);
  };

  /** actor 单写者播种链（publish int spec 同款）：头行 raw INSERT+逐帧 appendBatch+水位 CAS。 */
  async function seedFrames(pid: string, frames: Uint8Array[]): Promise<bigint> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      pid,
    );
    let pg = 0n;
    for (let i = 0; i < frames.length; i++) {
      const seq = BigInt(i + 1);
      const r = await repo.appendBatch(pid, [seedRow(frames[i], seq)], { expectedPgSeq: pg, newPgSeq: seq, walCheckpointSeq: seq });
      expect(r.ok).toBe(true);
      pg = seq;
    }
    return pg;
  }

  const gateRow = (pid: string) => prisma.collabOpsGate.findUnique({ where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId: pid } } });

  // ═══ 红①：三档语义（两行 state 组合） ═══

  it('红①-a 两行 OPEN → open（授权读+compact 全管线通行）', async () => {
    await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: true });
    const pg = await seedFrames(PID_A, [frameOf('a', 1), frameOf('a', 2)]);
    const r = await repo.compact(PID_A);
    expect(r).toMatchObject({ compacted: true, snapshotRev: pg, stateSeq: pg });
  });

  it('红①-b 全局行 FROZEN → 拒（frozen-global）', async () => {
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'FROZEN' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ''`;
    try {
      await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: false, result: 'frozen-global' });
      // compact ① 授权读早退（重放前——零开销拒）
      const pg = await seedFrames(PID_A, [frameOf('b', 1)]);
      const snapCount = await prisma.canvasDocSnapshot.count({ where: { projectId: PID_A } });
      await expect(repo.compact(PID_A)).resolves.toEqual({ compacted: false, reason: 'gate-frozen' });
      expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID_A } })).toBe(snapCount);
      expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID_A } })).toBe(Number(pg));   // WAL 行全保留
      expect(await counterValue('frozen-global')).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'OPEN' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ''`;
    }
  });

  it('红①-c 项目行 FROZEN → 拒（frozen-project——他项目不受累）', async () => {
    await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'spec', reason: 'red1c' });
    await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: false, result: 'frozen-project' });
    await expect(readOpsGateCompact(prisma, PID_B)).resolves.toEqual({ open: true });   // 他项目 OPEN
  });

  it('红①-d 任一行缺 → fail-closed（项目行缺=漏 governance 形态；全局行缺=哨兵丢失形态）', async () => {
    await prisma.collabOpsGate.delete({ where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId: PID_A } } });
    try {
      await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: false, result: 'fail-closed' });
      const skipBefore = await counterValue('fail-closed');
      await seedFrames(PID_A, [frameOf('d', 1)]);
      await expect(repo.compact(PID_A)).resolves.toEqual({ compacted: false, reason: 'gate-frozen' });   // ①授权读 fail-closed 早退
      expect(await counterValue('fail-closed')).toBeGreaterThan(skipBefore);
    } finally {
      await prisma.$executeRaw`
        INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES (${OPS_GATE_COMPACT}, ${PID_A}, 'OPEN') ON CONFLICT DO NOTHING`;
    }
    // 全局行缺（finally 复位——串行 fileParallelism=false 下不波他文件）
    await prisma.collabOpsGate.delete({ where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId: '' } } });
    try {
      await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: false, result: 'fail-closed' });
    } finally {
      await prisma.$executeRaw`
        INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES (${OPS_GATE_COMPACT}, '', 'OPEN') ON CONFLICT DO NOTHING`;
    }
  });

  // ═══ 红②：freeze（canary fail 面——C2-2 接线前直调验证）+frozen_age gauge ═══

  it('红②-a freeze → 该 pid 项目行 FROZEN+version+1+frozenAt/frozenBy/reason；他项目+全局行 OPEN 不动；重复 freeze 幂等（version 不虚 bump）', async () => {
    const v0 = (await gateRow(PID_A))!.version;   // 相对锚（version 跨用例累计——红①-d finally 重插行会归零）
    const r1 = await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'canary-verify', reason: 'c2-1 red2' });
    expect(r1).toEqual({ frozen: true, version: v0 + 1n });
    const a = await gateRow(PID_A);
    expect(a).toMatchObject({ state: 'FROZEN', frozenBy: 'canary-verify', reason: 'c2-1 red2', unfrozenAt: null });
    expect(a!.frozenAt).not.toBeNull();
    expect(a!.version).toBe(v0 + 1n);
    await expect(gateRow(PID_B)).resolves.toMatchObject({ state: 'OPEN' });
    await expect(gateRow('')).resolves.toMatchObject({ state: 'OPEN' });
    // 幂等：重复 freeze（重复 canary fail）0 行——version 不虚增
    const r2 = await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'canary-verify', reason: 'again' });
    expect(r2).toEqual({ frozen: false, version: null });
    expect((await gateRow(PID_A))!.version).toBe(v0 + 1n);
  });

  it('红②-b frozen_age gauge=全局 max（两行 FROZEN 取最老）+refresh 归零（全解冻）', async () => {
    await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'spec', reason: 'age-a' });
    await freezeOpsGateCompact(prisma, { projectId: PID_B, frozenBy: 'spec', reason: 'age-b' });
    // 背龄：A=2h 前、B=30min 前（canary fail 后无人 ack 的年龄增长形态）
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "frozenAt" = now() - interval '2 hours' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ${PID_A}`;
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "frozenAt" = now() - interval '30 minutes' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ${PID_B}`;
    const age = await refreshOpsGateFrozenAgeGauge(prisma);
    expect(age).toBeGreaterThanOrEqual(7_180);            // ≈2h（全局 max 非 B 的 30min）
    expect(age).toBeLessThanOrEqual(7_220);
    expect(await gaugeValue('collab_ops_gate_frozen_age')).toBe(age);
    // 全解冻 → 归零
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'OPEN' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" IN (${PID_A}, ${PID_B})`;
    expect(await refreshOpsGateFrozenAgeGauge(prisma)).toBe(0);
    expect(await gaugeValue('collab_ops_gate_frozen_age')).toBe(0);
  });

  it('红②-c boot 扫行初始化 gauge（poller onModuleInit 载体——C3 worker boot 首 tick await 先例）', async () => {
    await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'spec', reason: 'boot-init' });
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "frozenAt" = now() - interval '3 hours' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ${PID_A}`;
    const poller = new CollabCompactPoller(prisma as never, {
      assertSchemaGenerationDiscipline: async () => undefined,
      resumePurges: async () => 0,
      compact: async () => ({ compacted: false as const, reason: 'empty' as const }),
    } as never);
    await poller.onModuleInit();
    await poller.onApplicationShutdown();
    expect(await gaugeValue('collab_ops_gate_frozen_age')).toBeGreaterThanOrEqual(10_780);   // ≈3h——boot 即初始化（非等首 tick）
  });

  // ═══ 红③：锁语义+两行校验（授权读 pass 后 frozen 到达→abandoned 零写） ═══

  it('红③-a 序列化复现：授权读 pass → freeze 到达（提交）→ 发布事务两行校验见 FROZEN → 拒+零写', async () => {
    const pg = await seedFrames(PID_A, [frameOf('x', 1), frameOf('x', 2), frameOf('x', 3)]);
    // ① 授权读 pass（open 真值）
    await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: true });
    // freeze 在发布事务提交前到达（第二实例提交——canary fail 面时序）
    await freezeOpsGateCompact(prismaB, { projectId: PID_A, frozenBy: 'canary-verify', reason: 'red3a' });
    const snapCount = await prisma.canvasDocSnapshot.count({ where: { projectId: PID_A } });
    const docBefore = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A } });
    const r = await repo.compact(PID_A);
    expect(r).toEqual({ compacted: false, reason: 'gate-frozen' });   // abandoned 零写（③发布事务内拒）
    // 零写：无新快照+指针/purgeBelowSeq 不动+WAL 行全保留
    expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID_A } })).toBe(snapCount);
    const docAfter = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A } });
    expect(docAfter.currentSnapshotRev).toBe(docBefore.currentSnapshotRev);
    expect(docAfter.purgeBelowSeq).toBe(docBefore.purgeBelowSeq);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID_A } })).toBe(Number(pg));
    expect(await counterValue('frozen-project')).toBeGreaterThanOrEqual(1);
  });

  it('红③-b 发布事务内两行校验缺行 → fail-closed（<2 行拒——int 序列化形态=⓪授权读先拒；③ 面专项钉在 unit sim before 钩「⓪ pass 后行缺」）', async () => {
    await seedFrames(PID_A, [frameOf('y', 1)]);
    const g = await readOpsGateCompact(prisma, PID_A);
    expect(g.open).toBe(true);
    // ⓪ 与 ③ 之间项目行被删（governance 破洞形态）——repo.compact ⓪/③ 两面任一见缺行即拒
    await prismaB.collabOpsGate.delete({ where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId: PID_A } } });
    try {
      const skipBefore = await counterValue('fail-closed');
      await expect(repo.compact(PID_A)).resolves.toEqual({ compacted: false, reason: 'gate-frozen' });
      expect(await counterValue('fail-closed')).toBeGreaterThan(skipBefore);
    } finally {
      await prisma.$executeRaw`
        INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES (${OPS_GATE_COMPACT}, ${PID_A}, 'OPEN') ON CONFLICT DO NOTHING`;
    }
  });

  it('红③-c FOR SHARE 与 freeze UPDATE 互斥（双实例并发夹具）：发布侧持 gate 行锁未提交 ⇒ freeze 阻塞；提交后 freeze 落地', async () => {
    let releaseA!: () => void;
    const holdA = new Promise<void>((r) => (releaseA = r));
    // A：事务内两行 FOR SHARE 校验 pass 后持锁等待（compact ③ 首语句同位面）
    const a = prisma.$transaction(async (tx) => {
      const g = await checkOpsGateCompactForShare(tx, PID_A);
      expect(g).toEqual({ ok: true });
      await holdA;
      return 'held' as const;
    }, { timeout: 15_000, maxWait: 5_000 });
    await new Promise((r) => setTimeout(r, 300));   // A 取得行锁
    let bResolvedAt = 0;
    const b = freezeOpsGateCompact(prismaB, { projectId: PID_A, frozenBy: 'canary-verify', reason: 'red3c' })
      .then((r) => { bResolvedAt = Date.now(); return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(bResolvedAt, 'FOR SHARE 持有期 freeze UPDATE 阻塞（行锁互斥——plain SELECT 会穿）').toBe(0);
    releaseA();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('held');
    expect(rb).toEqual({ frozen: true, version: 1n });   // A 提交后 B 落地（串行化——无中间态）
  });

  // ═══ vacuumReplace 前置 gate 检查（换代真空替换前判——FROZEN 拒=aborted 档） ═══

  it('vacuum 前置：FROZEN ⇒ {aborted:"gate-frozen"} 零换代零删行；解冻后 vacuum 可行', async () => {
    const pg = await seedFrames(PID_A, [frameOf('v', 1), frameOf('v', 2)]);
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID_A }, orderBy: { seq: 'asc' } });
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A } });
    const state = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
    await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'spec', reason: 'vacuum-gate' });
    const skipBefore = await counterValue('frozen-project');
    const r = await repo.vacuumReplace(PID_A, state, rows.length, doc.generation);
    expect(r).toEqual({ aborted: 'gate-frozen' });
    expect(await counterValue('frozen-project')).toBeGreaterThan(skipBefore);
    // 零换代零删行
    const docAfter = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A } });
    expect(docAfter.generation).toBe(doc.generation);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID_A } })).toBe(Number(pg));
    // 解冻后可行（gate 不再挡）
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'OPEN' WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ${PID_A}`;
    const r2 = await repo.vacuumReplace(PID_A, state, rows.length, doc.generation);
    expect(r2).toEqual({ generation: doc.generation + 1 });
  });

  // ═══ 解冻 ack（人工通道——service 方法；HTTP 端点归 C2-3） ═══

  it('解冻 ack：state 回 OPEN+unfrozenAt+version+1+AuditLog 同事务落痕；重复 ack 幂等零重复审计行', async () => {
    const v0 = (await gateRow(PID_A))!.version;   // 相对锚（version 跨用例累计）
    await freezeOpsGateCompact(prisma, { projectId: PID_A, frozenBy: 'canary-verify', reason: 'c2-1 ack drill' });
    const auditBefore = await prisma.auditLog.count({ where: { targetType: 'PROJECT', targetId: PID_A, action: 'collab_ops_gate_unfreeze' } });
    const r = await prisma.$transaction((tx) => unfreezeOpsGateCompact(tx, {
      projectId: PID_A, operatorId: 'admin-1', operatorName: '值班管理员', remark: 'C2-1 解冻演练',
    }));
    const vAck = v0 + 2n;   // freeze +1 → unfreeze +1
    expect(r).toEqual({ unfrozen: true, version: vAck });
    const a = await gateRow(PID_A);
    expect(a).toMatchObject({ state: 'OPEN' });
    expect(a!.unfrozenAt).not.toBeNull();
    expect(a!.version).toBe(vAck);
    const audits = await prisma.auditLog.findMany({ where: { targetType: 'PROJECT', targetId: PID_A, action: 'collab_ops_gate_unfreeze' } });
    expect(audits).toHaveLength(auditBefore + 1);
    expect(audits[audits.length - 1]).toMatchObject({ operatorId: 'admin-1', operatorName: '值班管理员' });
    expect(audits[audits.length - 1]!.afterValue).toMatchObject({ state: 'OPEN', version: vAck.toString() });   // BigInt 恒十进制字符串
    // 解冻后 compact 恢复通行（ack 即恢复）
    await expect(readOpsGateCompact(prisma, PID_A)).resolves.toEqual({ open: true });
    // 幂等：重复 ack（已 OPEN）0 行+零重复审计行
    const r2 = await prisma.$transaction((tx) => unfreezeOpsGateCompact(tx, { projectId: PID_A, operatorId: 'admin-1', operatorName: '值班管理员' }));
    expect(r2).toEqual({ unfrozen: false, version: null });
    expect(await prisma.auditLog.count({ where: { targetType: 'PROJECT', targetId: PID_A, action: 'collab_ops_gate_unfreeze' } })).toBe(auditBefore + 1);
  });
});
