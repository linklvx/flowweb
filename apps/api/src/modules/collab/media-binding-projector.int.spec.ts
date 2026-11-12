// apps/api/src/modules/collab/media-binding-projector.int.spec.ts
// C3a-5（plan v3 Task C3a-5——spec 2026-11-11-foundation-batch-design.md §3.2-2 预检序/§3.2-1 diff 语义）：
// MediaBindingProjector 本体 真 PG 红测——四族：
//   ①diff 语义（delta→SQL 效应）：upsert 槽位（幂等零churn）/槽位值变（同槽换 mediaId=旧行条件删
//     +新行写）/槽位撤除（空槽位集=清该 node 全槽）/NODE_DELETED（delta null tombstone=该 node 全行删，
//     他 node 行零波及）；
//   ②预检顺序（第六轮 P0-4/P0-8——逐 media 行判定，顺序不可换）：媒体形态矩阵
//     `deletedAt≠null ∧ DELETING`→照写（**序测锚**：软删先判会吞掉 DELETING 照写）/`deletedAt≠null ∧ ACTIVE`
//     →跳过+该槽现存行清（只清该槽，不删该 media 其他槽）/media 不存在→skip/跨队→skip；
//   ③unnest 批量：一批多 node 多槽一轮事务落（N 槽位+行数正确——不强制单语句）；
//   ④typed BindingProjectionFailed：坏 targetField（DB CHECK media_binding_target_field_domain 违约）
//     →typed error 抛给闭包（C3a-4 闭包 catch→ROLLBACK TO+dirty 承接）。
// 红态=media-binding-projector 模块不存在（编译级红——C3a-3 binding-delta.spec 先例）。
// 预检序原文（spec §3.2-2）：DELETING 优先判定→照写（仅校验存在/team，忽略 deletedAt）；ACTIVE 才按
// 不存在/跨队/软删跳过；skip 的槽位删除现存 binding 行（防指向死 media 的永久过度保护）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { projectBindings, BindingProjectionFailedError } from './media-binding-projector';
import { ensureProjectFixture, cleanupProjectFixture, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import type { MediaRef, MediaRefTargetField } from '@flowweb/shared';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'c3a5-projector-int';
const OTHER_TEAM = 'c3a5-other-team';

/** 媒体 id 桶（beforeAll 逐一建行——直改行构造 DELETING/软删形态）。 */
const M = {
  fresh1: 'c3a5-media-fresh-1',
  fresh2: 'c3a5-media-fresh-2',
  fresh3: 'c3a5-media-fresh-3',
  deleting: 'c3a5-media-deleting',   // deletedAt≠null ∧ DELETING
  softdel: 'c3a5-media-softdel',     // deletedAt≠null ∧ ACTIVE
  cross: 'c3a5-media-cross',         // 他队
} as const;

/** MediaRef 构造（槽位键五元组——role 恒 primary 来自 MediaRef.role）。 */
const ref = (nodeId: string, mediaId: string, targetField: MediaRefTargetField = 'fileId', targetItemId = ''): MediaRef =>
  ({ nodeId, mediaId, role: 'primary', targetField, targetItemId });

const delta = (entries: Record<string, readonly MediaRef[] | null>) => new Map(Object.entries(entries));

/** 单轮投影（单事务——③族「一轮事务落」口径）。C3a-8：返回投影统计（write/skip 指标同源）。 */
async function project(prisma: PrismaClient, d: Map<string, readonly MediaRef[] | null>) {
  return prisma.$transaction((tx) => projectBindings(tx, PID, FIXTURE_TEAM, d), { timeout: 5_000 });
}

/** 该项目 binding 行集（断言面：五元组槽键+mediaId）。 */
async function rowsOf(prisma: PrismaClient) {
  return prisma.mediaBinding.findMany({ where: { projectId: PID }, orderBy: [{ nodeId: 'asc' }, { targetField: 'asc' }, { targetItemId: 'asc' }] });
}
const slotKeys = (rs: Awaited<ReturnType<typeof rowsOf>>) =>
  rs.map((r) => `${r.nodeId}|${r.role}|${r.targetField}|${r.targetItemId}=>${r.mediaId}`).sort();

maybe('C3a-5：MediaBindingProjector 四族（真 PG）', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await prisma.team.upsert({ where: { id: OTHER_TEAM }, update: {}, create: { id: OTHER_TEAM, name: 'c3a5-other', ownerId: FIXTURE_USER } });
    await prisma.media.deleteMany({ where: { id: { in: Object.values(M) } } });
    const mk = (id: string, teamId: string) => prisma.media.create({
      data: { id, userId: FIXTURE_USER, teamId, key: `c3a5/${id}`, originalName: `${id}.png`, mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
    for (const id of [M.fresh1, M.fresh2, M.fresh3, M.deleting, M.softdel]) await mk(id, FIXTURE_TEAM);
    await mk(M.cross, OTHER_TEAM);
    // 媒体形态直改（C3b 状态机未落地——int spec 直改行构造 DELETING/软删形态）
    await prisma.media.update({ where: { id: M.deleting }, data: { deletionState: 'DELETING', deletedAt: new Date() } });
    await prisma.media.update({ where: { id: M.softdel }, data: { deletedAt: new Date() } });
  });
  afterAll(async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { id: { in: Object.values(M) } } });
    await prisma.team.deleteMany({ where: { id: OTHER_TEAM } });
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  });

  // ── 族①：diff 语义（delta→SQL 效应）──
  it('①a：upsert 槽位——新槽写行+同槽重投幂等（零 churn：行数/槽键/mediaId 不变）；统计 written=净写行数', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: 'a' } });
    const s1 = await project(prisma, delta({ a: [ref('a', M.fresh1)] }));
    expect(s1).toEqual({ written: 1, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } });
    let rs = await rowsOf(prisma);
    expect(slotKeys(rs)).toEqual([`a|primary|fileId|=>${M.fresh1}`]);
    const idBefore = rs[0].id;
    const s2 = await project(prisma, delta({ a: [ref('a', M.fresh1)] }));   // 同槽同 mediaId 重投=幂等
    expect(s2.written).toBe(0);   // C3a-8：未变更槽零写（write_total 不虚高）
    rs = await rowsOf(prisma);
    expect(rs).toHaveLength(1);
    expect(rs[0].id).toBe(idBefore);   // 未变更槽零 churn（非 delete+reinsert）
  });

  it('①b：槽位值变（同槽 in-place 替换 mediaId——ON CONFLICT DO UPDATE）→槽内恰一行指新 mediaId', async () => {
    await project(prisma, delta({ a: [ref('a', M.fresh1)] }));
    await project(prisma, delta({ a: [ref('a', M.fresh2)] }));   // 同槽换 mediaId
    const rs = await rowsOf(prisma);
    expect(slotKeys(rs.filter((r) => r.nodeId === 'a'))).toEqual([`a|primary|fileId|=>${M.fresh2}`]);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'a', mediaId: M.fresh1 } })).toBe(0);   // 旧 mediaId 行已删
  });

  it('①c：槽位撤除（node 在册零引用=空槽位集）→该 node 全槽清；NODE_DELETED（null tombstone）→该 node 全行删且他 node 零波及', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: { in: ['b', 'c', 'd'] } } });
    // node b 两槽（fileId 标量+images 列表 2 item）；node c 一槽（对照——零波及断言）
    await project(prisma, delta({
      b: [ref('b', M.fresh1), ref('b', M.fresh2, 'images', M.fresh2), ref('b', M.fresh3, 'images', M.fresh3)],
      c: [ref('c', M.fresh1)],
    }));
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'b' } })).toBe(3);
    // 空槽位集（node 在册零引用）→全槽清
    await project(prisma, delta({ b: [] }));
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'b' } })).toBe(0);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'c' } })).toBe(1);   // 非本 delta 域零波及
    // NODE_DELETED（null）→该 node 全行删（先重建两槽）
    await project(prisma, delta({ b: [ref('b', M.fresh1), ref('b', M.fresh2, 'images', M.fresh2)] }));
    await project(prisma, delta({ b: null }));
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'b' } })).toBe(0);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'c' } })).toBe(1);
  });

  // ── 族②：预检顺序（媒体形态矩阵——顺序不可换：DELETING 优先于软删判定）──
  it('②a：deletedAt≠null ∧ DELETING→照写（序测锚：软删先判会吞掉 DELETING 照写——spec §3.2-2 第六轮修正）', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: 'da' } });
    await project(prisma, delta({ da: [ref('da', M.deleting)] }));
    expect(slotKeys(await rowsOf(prisma)).filter((k) => k.startsWith('da|'))).toEqual([`da|primary|fileId|=>${M.deleting}`]);
  });

  it('②b：deletedAt≠null ∧ ACTIVE→跳过+该槽现存行清（只清该槽——不删该 media 其他 node 槽）', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: { in: ['sa', 'sz'] } } });
    // 布景：sa/sz 两槽先以 ACTIVE 态 fresh1 落行（beforeAll 软删的是 M.softdel——fresh1 此刻仍 ACTIVE），
    // 随后直改 fresh1 为软删再重投 sa 槽（doc 仍引用）——②b 的「现存行被清」断言才有可清之行
    await project(prisma, delta({ sa: [ref('sa', M.fresh1)], sz: [ref('sz', M.fresh1)] }));
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: { in: ['sa', 'sz'] } } })).toBe(2);
    // 把 fresh1 软删后重投 sa 槽（doc 仍引用）→sa 槽清、sz 槽（不在本 delta）留存
    await prisma.media.update({ where: { id: M.fresh1 }, data: { deletedAt: new Date() } });
    const soft = await project(prisma, delta({ sa: [ref('sa', M.fresh1)] }));
    expect(soft.skipped['soft-deleted']).toBe(1);   // C3a-8：skip_total{soft-deleted}（DELETING 优先于软删——②a 已锁）
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'sa' } })).toBe(0);   // 该槽现存行清（防指向死 media 永久过度保护）
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'sz' } })).toBe(1);   // 只清该槽——不删该 media 其他槽
    await prisma.media.update({ where: { id: M.fresh1 }, data: { deletedAt: null } });   // 还原（后续族用）
  });

  it('②c：media 不存在→skip+该槽现存行清；跨队→skip+该槽现存行清（②b 同一清行语义——统一锁定）', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: { in: ['ma', 'xa'] } } });
    // 预置行（missing/cross-team 的清行锚——空槽布景只证「不写」不证「清」）：先以合法 media（fresh3）落两槽
    await project(prisma, delta({ ma: [ref('ma', M.fresh3)], xa: [ref('xa', M.fresh3)] }));
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: { in: ['ma', 'xa'] } } })).toBe(2);
    // 重投为不存在 media/跨队 media（doc 仍引用）→两槽现存行清（skip 槽位删现存行——与②b 软删同语义）
    const s = await project(prisma, delta({
      ma: [ref('ma', 'c3a5-media-nonexistent-uuid')],
      xa: [ref('xa', M.cross)],
    }));
    expect(s.skipped.missing).toBe(1);   // C3a-8：skip_total{missing}
    expect(s.skipped['cross-team']).toBe(1);   // C3a-8：skip_total{cross-team}
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: { in: ['ma', 'xa'] } } })).toBe(0);
  });

  // ── 族③：unnest 批量（一批多 node 多槽一轮事务落）──
  it('③：3 node×3 槽（fileId+images 2 item）单轮投影→9 行落且槽键/mediaId 正确；空 delta no-op', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: { in: ['u1', 'u2', 'u3'] } } });
    const perNode = (n: string) => [ref(n, M.fresh1), ref(n, M.fresh2, 'images', M.fresh2), ref(n, M.fresh3, 'images', M.fresh3)];
    await project(prisma, delta({ u1: perNode('u1'), u2: perNode('u2'), u3: perNode('u3') }));
    const rs = await rowsOf(prisma);
    expect(rs.filter((r) => r.nodeId.startsWith('u')).length, 'N 槽位一轮事务落（9 槽）').toBe(9);
    for (const n of ['u1', 'u2', 'u3']) {
      expect(slotKeys(rs.filter((r) => r.nodeId === n))).toEqual([
        `${n}|primary|fileId|=>${M.fresh1}`,
        `${n}|primary|images|${M.fresh2}=>${M.fresh2}`,
        `${n}|primary|images|${M.fresh3}=>${M.fresh3}`,
      ]);
    }
    const before = await prisma.mediaBinding.count({ where: { projectId: PID } });
    await project(prisma, new Map());   // 空 delta=零开销 no-op
    expect(await prisma.mediaBinding.count({ where: { projectId: PID } })).toBe(before);
  });

  // ── 族④：typed BindingProjectionFailed（投影内部错误→typed error 抛给闭包）──
  it('④：坏 targetField（DB CHECK 违约）→BindingProjectionFailedError typed 抛出+零半态落行', async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID, nodeId: 'bad' } });
    const bad = delta({ bad: [
      ref('bad', M.fresh2),
      { nodeId: 'bad', mediaId: M.fresh3, role: 'primary', targetField: 'not-in-domain' as unknown as MediaRefTargetField, targetItemId: '' },
    ] });
    await expect(project(prisma, bad)).rejects.toBeInstanceOf(BindingProjectionFailedError);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'bad' } })).toBe(0);   // 单语句整体失败=零半态（批整语句原子）
  });

  // ── 族⑤：装配冒烟——actor flushPrefixToPg 真组合闭包经 repo.appendBatch 落投影+binding 水位 ──
  //（单测 mock 不调 inTx——真闭包 wiring 只有本面可见：帧→bindingDelta→合并→SAVEPOINT→projectBindings
  //  →RELEASE→covered→懒建档 mediaBindingSeq=newPg 零缺口建档；失败腿=族④ typed error×C3a-4 族①
  //  SAVEPOINT 机制的组合，C3a-6/9 全族收口。）
  it('⑤：真 actor.submit（referenceImage 帧）→flush 闭包投影落行+pgSeq/mediaBindingSeq 双 1 且非 dirty', async () => {
    const { makeSpoolDir } = await import('../../test-utils/spool-dir');
    const { ensureLeaseFixture, restoreLeaseRow } = await import('../../test-utils/db-fixtures');
    const { CollabProjectActorService } = await import('./collab-project-actor.service');
    const { CollabSpoolService } = await import('./collab-spool.service');
    const { CanvasDocUpdateRepository } = await import('./canvas-doc-update.repository');
    const dir = await makeSpoolDir('c3a5-asm-');
    try {
      const repo = new CanvasDocUpdateRepository(prisma as never);
      await ensureLeaseFixture(prisma, repo);
      const spool = new CollabSpoolService(dir.dir);
      spool.setOwner('c3a5-asm-owner');
      spool.setWalHistory('c3a5-asm-history');
      const doc = new Y.Doc();
      const documents = new Map([[`project:${PID}`, doc]]);
      const actor = new CollabProjectActorService(spool as never, repo as never);
      (actor as unknown as { bindHost(h: unknown): void }).bindHost({
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn(), localInstance: true },
        documents: () => documents,
        hardClose: () => {},
        isQuotaFrozen: () => false,
        generationOf: () => 0,
        noteReadOnlyDrop: () => false,
        onFencedByWrite: async () => {},
      } as never);
      // 帧：node asm-n（imageGen）{data.referenceImage=M.fresh2}——referenceImage=mediaLww 现役写权键
      //（fileId=server-forbidden 登记非执法〔D9 至 T32〕，取无争议写权键做装配冒烟）
      const src = new Y.Doc();
      const node = new Y.Map();
      const data = new Y.Map();
      data.set('referenceImage', M.fresh2);
      node.set('type', 'imageGen');
      node.set('data', data);
      (src.getMap('nodes') as Y.Map<unknown>).set('asm-n', node);
      const frame = Y.encodeStateAsUpdate(src);
      const r = await actor.submit(PID, frame, { socketId: 'c3a5-sock', readOnly: false, sendStateless: vi.fn() } as never, 'update');
      expect(r.walSeq).toBe(1n);
      // flush fire-and-forget——轮询 CanvasDoc 建档（懒建档布景：covered→mediaBindingSeq=newPg）
      const t0 = Date.now();
      let wm: { pgSeq: bigint; mediaBindingSeq: bigint; bindingsDirty: boolean } | null = null;
      for (;;) {
        wm = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true } });
        if (wm) break;
        if (Date.now() - t0 > 10_000) throw new Error('actor flush 未落定（10s 轮询超时）');
        await new Promise((res) => setTimeout(res, 50));
      }
      expect(wm!.pgSeq).toBe(1n);   // 帧水位
      expect(wm!.mediaBindingSeq).toBe(1n);   // 闭包 covered=true→懒建档零缺口初始化（C3a-4 档3 机制经真闭包兑现）
      expect(wm!.bindingsDirty).toBe(false);
      expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'asm-n', targetField: 'referenceImage', mediaId: M.fresh2 } })).toBe(1);   // 投影落行
      await restoreLeaseRow(prisma);
    } finally {
      await dir.cleanup();
    }
  });

  // ── 族⑥（C3a-9 补缺——spec §3.2-8「FK 竞态→savepoint 兜底」直测；C1-1 终态适配：mediaId FK 已去
  //   〔spec v5.2/v5.3〕——竞态载体改为存活的 MediaBinding.projectId FK（父项目行灭失→INSERT 触发 FK）；
  //   Media 行灭失在无 FK 终态=投影照写候选行不报错，候选面语义归 C3b）
  it('⑥：FK 竞态（预检读后 CanvasProject 行灭失→INSERT 触发 projectId FK）→BindingProjectionFailedError typed 抛出+事务回滚零半态', async () => {
    const FK_MEDIA = 'c3a5-media-fk-race';
    await prisma.media.deleteMany({ where: { id: FK_MEDIA } });
    await prisma.media.create({
      data: { id: FK_MEDIA, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a5/${FK_MEDIA}`, originalName: 'fk.png', mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
    try {
      await expect(prisma.$transaction(async (tx) => {
        // 预检读 Media 行**之后**注入并发删（同事务 DELETE：INSERT 的 projectId FK 检查见父行灭失——
        // 竞态窗的确定性替身；生产形态=并发删除事务提交于两语句之间）。闭包侧 SAVEPOINT 兜底=C3a-4 族①。
        const racing = {
          $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
            const rows = await (tx.$queryRaw as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
            if (strings.join('').includes('FROM "Media"')) {
              await tx.$executeRaw`DELETE FROM "CanvasProject" WHERE id = ${PID}::text`;
            }
            return rows;
          },
          $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> =>
            (tx.$executeRaw as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<number>)(strings, ...values),
        };
        return projectBindings(racing as never, PID, FIXTURE_TEAM, delta({ fk: [ref('fk', FK_MEDIA)] }));
      })).rejects.toBeInstanceOf(BindingProjectionFailedError);
      expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'fk' } })).toBe(0);   // 投影零半态（INSERT 整体失败）
      expect(await prisma.canvasProject.count({ where: { id: PID } })).toBe(1);   // 外层回滚=竞态 DELETE 同灭（布景不自留）
    } finally {
      await prisma.media.deleteMany({ where: { id: FK_MEDIA } });
    }
  });
});
