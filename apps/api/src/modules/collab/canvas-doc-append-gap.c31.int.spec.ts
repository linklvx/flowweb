// apps/api/src/modules/collab/canvas-doc-append-gap.c31.int.spec.ts
// C3 卡（doc-append-gap-alert）Task C3-1 红①②③⑤ int 池（真 PG 5432——vitest.int.config 串行）：
//  ★红① 三断言+Coalesced 两端豁免：SQL CTE 审计（auditAppendBatch——单条 SQL 批内）判别双档——
//    注入缺 seq（无侧表记录）→违例红；首尾两端被侧表覆盖=豁免绿（M-1/m-3 裁定判别档）。
//    JS-SQL 对拍（M-2 单源）：assertAppendAuditThree（test-utils 单源）与 SQL 版双跑对拍。
//  ★红② purge 延迟窗零假阳性+义务年龄：purgeBelowSeq IS NOT NULL 的 doc 聚合过滤 seq>stateSeq 断言
//    不违例（旧行不参与）不 skip——另加 purge 义务年龄告警（purgeBelowSeq 持续非空>阈值——独立告警
//    不被审计吞掉）。
//  ★红③ skip 面+轮转游标：无 CanvasDoc 行∨lifecycleState!='ACTIVE'→skip 计数；每 tick 项目数预算
//    分批轮转游标（CollabJobCursor.lastKey 按 projectId 轮转——尾部项目饿死根除）+advisory 单飞。
//  ★红⑤ 正常批+adopt 零计数：判别双档——正常批/T30b adopt（含侧表）零计数（tick ok+gap 计数零增）。
//  ★红④（maintenance/dedup 夹具 CI 常驻）：c30 红⓪-a 夹具在 vitest.int config（ci.yml test:int:ci）
//    常驻——每轮 CI 对拍三断言一致，形态漂移即红（本文件 JS 夹面同单源消费）。
// 布景直插（审计=读面——夹具行集直接播种，不复用 appendBatch 写链〔writer 面已 c30 覆盖〕）。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { register } from 'prom-client';
import { DOC_APPEND_GAP_AUDIT_JOB } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabAppendAuditWorker, APPEND_AUDIT_ADVISORY_KEY, APPEND_AUDIT_PROJECT_BATCH, PURGE_OBLIGATION_STALE_MS } from './collab-append-audit.worker';
import { CanvasDocUpdateRepository, type AppendAuditViolation } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import { assertAppendAuditThree } from '../../test-utils/append-audit';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();
const prismaB = new PrismaClient();   // 红③ advisory 单飞第二实例（双 worker 并发）
const worker = new CollabAppendAuditWorker(prisma as unknown as PrismaService);

const AUD = 'c31-audit-int';
const HEAD = 'c31-head-int';
const TAIL = 'c31-tail-int';
const PURGE = 'c31-purge-int';
const T30B = 'c31-t30b-int';
const ROT = ['c31-rot-a', 'c31-rot-b', 'c31-rot-c'];
const ROT_DEL = 'c31-rot-deleting';
const ROT_NODOC = 'c31-rot-nodoc';
const ALL_PIDS = [AUD, HEAD, TAIL, PURGE, T30B, ...ROT, ROT_DEL, ROT_NODOC];

/** prom 值读取（label-less counter / labeled result counter / gauge——retention int 同族 helper）。 */
async function metricValue(name: string, labels: Record<string, string> = {}): Promise<number> {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === name) as
    | { values: { labels: Record<string, string>; value: number }[] }
    | undefined;
  return m?.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value ?? 0;
}

async function tickResult(name: string, result: string): Promise<number> {
  return metricValue(name, { result });
}

/** 游标行读（lastGap Json → 断言侧解析）。 */
async function cursorState(): Promise<{ lastKey: string | null; lastGap: Record<string, unknown> }> {
  const row = await prisma.collabJobCursor.findUnique({ where: { job: DOC_APPEND_GAP_AUDIT_JOB } });
  return { lastKey: row?.lastKey ?? null, lastGap: (row?.lastGap ?? {}) as Record<string, unknown> };
}

/** 布景：项目 fixture（ACTIVE）+CanvasDoc 头（可选指针快照行——stateSeq 非 null 即建 (gen,rev) 行）。 */
async function seedHead(pid: string, o: { pgSeq: bigint; generation?: number; currentSnapshotRev?: bigint; stateSeq?: bigint | null; purgeBelowSeq?: bigint | null }): Promise<void> {
  const generation = o.generation ?? 1;
  const rev = o.currentSnapshotRev ?? 0n;
  if (o.stateSeq != null) {
    await prisma.canvasDocSnapshot.create({
      data: {
        projectId: pid, generation, snapshotRev: rev, stateSeq: o.stateSeq,
        state: Buffer.from([1]), stateHash: createHash('sha256').update(`${pid}:${rev}`).digest('hex'),
        vacuumEpoch: 0, schemaVersion: 3,
      },
    });
  }
  await prisma.canvasDoc.upsert({
    where: { projectId: pid },
    update: { generation, pgSeq: o.pgSeq, walCheckpointSeq: o.pgSeq, currentSnapshotRev: rev, purgeBelowSeq: o.purgeBelowSeq ?? null },
    create: { projectId: pid, generation, pgSeq: o.pgSeq, walCheckpointSeq: o.pgSeq, currentSnapshotRev: rev, purgeBelowSeq: o.purgeBelowSeq ?? null, schemaVersion: 3 },
  });
}

/** 单帧行（first=seq/frameCount=1 健康形态——audit 只读 first/seq/frameCount 三列）。 */
async function seedRow1(pid: string, seq: bigint, generation = 1): Promise<void> {
  await prisma.canvasDocUpdate.create({
    data: {
      projectId: pid, generation, seq, firstWalSeq: seq, frameCount: 1,
      updateHash: createHash('sha256').update(`${pid}:u:${generation}:${seq}`).digest('hex'),
      update: Buffer.from([1, 2]),
    },
  });
}

async function seedCoalesced(pid: string, seq: bigint, sourceSeq: bigint, generation = 1): Promise<void> {
  await prisma.canvasDocCoalesced.create({
    data: {
      projectId: pid, generation, seq,
      updateHash: createHash('sha256').update(`${pid}:c:${generation}:${seq}`).digest('hex'),
      sourceSeq, reason: 't30b-coalesced',
    },
  });
}

/** scoped tick（auditScope 隔离缝——本 spec 域内项目批选择/轮转/剪除；projectBatch 每调用复位）。 */
async function scopedTick(pids: readonly string[], projectBatch = APPEND_AUDIT_PROJECT_BATCH): Promise<void> {
  worker.auditScope = pids;
  worker.projectBatch = projectBatch;
  try { await worker.tick(); } finally { worker.auditScope = undefined; }
}

/** SQL 审计直调（scoped——tx 内批内；红① 判别断言面。SQL 本体居 repository 静态面〔契约 10：stateSeq
 *  token 唯一容许域——worker 零 token 委托形态〕）。 */
async function auditRows(pids: readonly string[]): Promise<readonly AppendAuditViolation[]> {
  return prisma.$transaction((tx) => CanvasDocUpdateRepository.auditAppendBatch(tx, pids));
}

maybe('C3-1 红①②③⑤：SQL 聚合审计 worker（真 PG——三断言/两端豁免/purge 义务年龄/skip 面/轮转游标）', () => {
  beforeAll(async () => { for (const pid of ALL_PIDS) await ensureProjectFixture(prisma, pid); }, 60_000);
  beforeEach(async () => {
    for (const pid of ALL_PIDS) await cleanupProjectFixture(prisma, pid);
    for (const pid of ALL_PIDS) await ensureProjectFixture(prisma, pid);
    await prisma.collabJobCursor.deleteMany({ where: { job: DOC_APPEND_GAP_AUDIT_JOB } });
  });
  afterAll(async () => {
    for (const pid of ALL_PIDS) await cleanupProjectFixture(prisma, pid);
    await prisma.collabJobCursor.deleteMany({ where: { job: DOC_APPEND_GAP_AUDIT_JOB } });
    await prisma.$disconnect();
    await prismaB.$disconnect();
  });

  // ═══════════════ 红①：三断言+两端豁免（判别双档）+JS 对拍 ═══════════════
  it('红①-健康档：正常链（rows 1..4 连续=pgSeq 4）→SQL 审计零违例+JS 夹面绿（对拍一致）', async () => {
    await seedHead(AUD, { pgSeq: 4n });
    for (let s = 1n; s <= 4n; s += 1n) await seedRow1(AUD, s);
    const rows = await auditRows([AUD]);
    expect(rows, '健康链三断言零违例').toEqual([]);
    await expect(assertAppendAuditThree(prisma, AUD)).resolves.toBeUndefined();   // M-2 对拍：JS 夹面同判绿
  });

  it('红①-b-link：注入缺 seq（3 无行无侧表）→SQL 违例（kind=b-link/missing=[3]）→tick 新 gap 边沿 inc+gauge 1+JS 夹面同判红（对拍一致）', async () => {
    await seedHead(AUD, { pgSeq: 4n });
    for (const s of [1n, 2n, 4n]) await seedRow1(AUD, s);   // seq 3 缺（无侧表）
    const gapBefore = await metricValue('doc_append_gap_total');
    const currentBefore = await metricValue('collab_doc_append_gap_current');
    const okBefore = await tickResult('collab_append_audit_tick_total', 'ok');

    const rows = await auditRows([AUD]);
    // ★红（stub 审计零探测）：违例行缺失
    expect(rows.length, 'b-link 违例在场（断点 [3,3] 缺侧表覆盖）').toBeGreaterThanOrEqual(1);
    const b = rows.find((r) => r.kind === 'b-link');
    expect(b, 'kind=b-link 在场').toBeTruthy();
    expect(Number(b!.missing_count)).toBe(1);
    expect(b!.missing_sample?.map((s) => s.toString())).toEqual(['3']);

    await scopedTick([AUD]);
    // ★红（无新 gap 边沿实现）：counter 不增
    expect(await metricValue('doc_append_gap_total'), '新 gap 边沿 inc（false→true）').toBe(gapBefore + 1);
    expect(await metricValue('collab_doc_append_gap_current'), 'current gauge 重算=1').toBe(currentBefore + 1);
    expect(await tickResult('collab_append_audit_tick_total', 'ok'), 'tick ok 计数').toBe(okBefore + 1);
    const cur = await cursorState();
    expect((cur.lastGap[AUD] as { g: number; gap: boolean } | undefined)?.gap, 'lastGap 持久 (project,generation) 态=true').toBe(true);
    // M-2 对拍：JS 夹面同判红（行间衔接 expect 失败）
    await expect(assertAppendAuditThree(prisma, AUD)).rejects.toThrow();
  });

  it('红①-b-link 覆盖豁免档：缺 seq 但侧表 (3→source 1) 覆盖断点→SQL 零违例（豁免绿）+JS 夹面绿（对拍一致）', async () => {
    await seedHead(AUD, { pgSeq: 4n });
    for (const s of [1n, 2n, 4n]) await seedRow1(AUD, s);
    await seedCoalesced(AUD, 3n, 1n);   // T30b 吞行侧表（sourceSeq=在档同 hash 行——布景简化直指覆盖面）
    const rows = await auditRows([AUD]);
    expect(rows, '侧表覆盖断点=豁免零违例（LEFT JOIN 覆盖判定）').toEqual([]);
    await expect(assertAppendAuditThree(prisma, AUD)).resolves.toBeUndefined();
  });

  it('红①-a-density：frameCount≠seq−first+1 注入→SQL 违例 kind=a-density（row_seq=违例行）+JS 夹面同判红', async () => {
    await seedHead(AUD, { pgSeq: 3n });
    for (const s of [1n, 2n]) await seedRow1(AUD, s);
    await prisma.canvasDocUpdate.create({
      data: {
        projectId: AUD, generation: 1, seq: 3n, firstWalSeq: 1n, frameCount: 2,   // 2 ≠ 3−1+1=3
        updateHash: createHash('sha256').update(`${AUD}:u:1:3:density`).digest('hex'),
        update: Buffer.from([1, 2]),
      },
    });
    const rows = await auditRows([AUD]);
    const a = rows.find((r) => r.kind === 'a-density');
    // ★红（stub 审计零探测）
    expect(a, 'a-density 违例在场').toBeTruthy();
    expect(a!.row_seq!.toString()).toBe('3');
    await expect(assertAppendAuditThree(prisma, AUD)).rejects.toThrow();
  });

  it('红①-首端豁免判别档（M-1）：min(first)=stateSeq+2 ∨ 侧表覆盖 [stateSeq+1] ⇒ 豁免绿；无覆盖 ⇒ c-head 红', async () => {
    // M-1 形态：compact 发布 stateSeq=1 → 重启窗 stateSeq+1 号位帧（2）被吞→侧表覆盖→存活行 min(first)=stateSeq+2=3
    await seedHead(HEAD, { pgSeq: 4n, stateSeq: 1n });   // 指针快照 (gen1,rev0,stateSeq=1)
    for (const s of [3n, 4n]) await seedRow1(HEAD, s);
    await seedCoalesced(HEAD, 2n, 3n);   // 吞行侧表覆盖 [2,2]（sourceSeq 布景任意在档行）

    // 豁免档：首端缺行但侧表覆盖 ⇒ 绿（M-1/m-3：c 的豁免须覆盖首端）
    expect(await auditRows([HEAD]), '首端侧表覆盖=豁免零违例').toEqual([]);
    await expect(assertAppendAuditThree(prisma, HEAD)).resolves.toBeUndefined();

    // 判别档：覆盖撤除 ⇒ c-head 红（区间空=真违例；非豁免即违例）
    await prisma.canvasDocCoalesced.deleteMany({ where: { projectId: HEAD } });
    const rows = await auditRows([HEAD]);
    const h = rows.find((r) => r.kind === 'c-head');
    // ★红（stub 审计零探测）
    expect(h, '无覆盖 c-head 违例在场').toBeTruthy();
    expect(Number(h!.missing_count)).toBe(1);
    expect(h!.missing_sample?.map((s) => s.toString())).toEqual(['2']);
    await expect(assertAppendAuditThree(prisma, HEAD)).rejects.toThrow();
  });

  it('红①-尾端豁免判别档（I-2）：pgSeq=2>存活行 max(last)=1 ∨ 侧表覆盖 [2] ⇒ 豁免绿；无覆盖 ⇒ c-tail 红', async () => {
    // I-2 形态：尾吞行 pgSeq 采纳 2>存活行 max=1——侧表覆盖 seq 2
    await seedHead(TAIL, { pgSeq: 2n });
    await seedRow1(TAIL, 1n);
    await seedCoalesced(TAIL, 2n, 1n);
    expect(await auditRows([TAIL]), '尾端侧表覆盖=豁免零违例（c 的豁免须覆盖尾端——M-1/m-3 裁定）').toEqual([]);
    await expect(assertAppendAuditThree(prisma, TAIL)).resolves.toBeUndefined();

    await prisma.canvasDocCoalesced.deleteMany({ where: { projectId: TAIL } });
    const rows = await auditRows([TAIL]);
    const t = rows.find((r) => r.kind === 'c-tail');
    // ★红（stub 审计零探测）
    expect(t, '无覆盖 c-tail 违例在场').toBeTruthy();
    expect(Number(t!.missing_count)).toBe(1);
    expect(t!.missing_sample?.map((s) => s.toString())).toEqual(['2']);
    await expect(assertAppendAuditThree(prisma, TAIL)).rejects.toThrow();
  });

  it('红①-越界无豁免面：min(first)<stateSeq+1（批首越过已发布水位）⇒ c-head 违例（missing 全 null——区间空无豁免）；max(last)>pgSeq（行越水位）⇒ c-tail 违例', async () => {
    // 批首越过已发布 stateSeq（walSeq 重置纪 tripwire 域——审计须报不豁免）：stateSeq=3、行 [first=3..seq=5]
    await seedHead(HEAD, { pgSeq: 5n, stateSeq: 3n });
    await prisma.canvasDocUpdate.create({
      data: {
        projectId: HEAD, generation: 1, seq: 5n, firstWalSeq: 3n, frameCount: 3,   // 密度自洽 3=5−3+1；first=3<4
        updateHash: createHash('sha256').update(`${HEAD}:u:1:5`).digest('hex'),
        update: Buffer.from([1, 2]),
      },
    });
    const rows = await auditRows([HEAD]);
    const h = rows.find((r) => r.kind === 'c-head');
    // ★红（stub 审计零探测）
    expect(h, 'c-head 越界违例在场（missing null 档——区间空无豁免面）').toBeTruthy();
    expect(h!.missing_count).toBeNull();
    await expect(assertAppendAuditThree(prisma, HEAD)).rejects.toThrow();
  });

  it('红①-全吞行集空：seq>stateSeq 无行（发布即全吞形态）→三断言 c 不判（JS 夹面 rows.length>0 同判）零违例', async () => {
    await seedHead(TAIL, { pgSeq: 4n, stateSeq: 4n });   // 行集空（无行 seq>4）
    expect(await auditRows([TAIL]), '行集空=零违例（c 不判）').toEqual([]);
    await expect(assertAppendAuditThree(prisma, TAIL)).resolves.toBeUndefined();
  });

  // ═══════════════ 红②：purge 延迟窗零假阳性+义务年龄 ═══════════════
  it('红②-purge 延迟窗零假阳性：purgeBelowSeq=3 非空且旧行 1..3 残留（分批删延迟）→聚合 seq>stateSeq(=3) 断言零违例不 skip+tick 审计入册', async () => {
    await seedHead(PURGE, { pgSeq: 5n, stateSeq: 3n, purgeBelowSeq: 3n });   // 发布 stateSeq=3+清理延迟窗
    for (let s = 1n; s <= 5n; s += 1n) await seedRow1(PURGE, s);   // 旧行 1..3 残留（延迟窗）
    const okBefore = await tickResult('collab_append_audit_tick_total', 'ok');
    const staleBefore = await metricValue('collab_append_audit_purge_stale_total');

    // ★红（无 purge 延迟窗处理）：违例非空（假阳性）或 skip（未审计）
    expect(await auditRows([PURGE]), '旧行（seq≤stateSeq）不参与聚合——零违例（延迟窗不 skip）').toEqual([]);
    await expect(assertAppendAuditThree(prisma, PURGE)).resolves.toBeUndefined();

    await scopedTick([PURGE]);
    expect(await tickResult('collab_append_audit_tick_total', 'ok'), '被审计（不 skip）').toBe(okBefore + 1);
    const cur = await cursorState();
    expect((cur.lastGap[PURGE] as { gap: boolean } | undefined)?.gap, '审计入册 gap=false').toBe(false);
    // 义务年龄：首 tick 观察起点落位（无历史=now）未越阈 ⇒ 零告警
    expect((cur.lastGap[PURGE] as { purgeSince: number } | undefined)?.purgeSince, 'purgeSince 观察起点落位').toBeTypeOf('number');
    expect(await metricValue('collab_append_audit_purge_stale_total'), '年龄未越阈=零告警').toBe(staleBefore);
  });

  it('红②-义务年龄告警：purgeBelowSeq 持续非空>阈值（lastGap purgeSince 前拨 40min）→下一 tick 边沿 inc+独立计数不被审计吞掉；衰减清窗不复发', async () => {
    await seedHead(PURGE, { pgSeq: 5n, stateSeq: 3n, purgeBelowSeq: 3n });
    for (let s = 4n; s <= 5n; s += 1n) await seedRow1(PURGE, s);
    // 前 tick 建观察起点（真实链：义务持续跨 tick）
    await scopedTick([PURGE]);
    const staleBefore = await metricValue('collab_append_audit_purge_stale_total');
    // 卡死窗注入：观察起点前拨 > 阈值（30min）——持续非空形态
    await prisma.collabJobCursor.update({
      where: { job: DOC_APPEND_GAP_AUDIT_JOB },
      data: { lastGap: { [PURGE]: { g: 1, gap: false, purgeSince: Date.now() - PURGE_OBLIGATION_STALE_MS - 10 * 60_000 } } },
    });
    // ★红（无义务年龄实现）：计数不增
    await scopedTick([PURGE]);
    expect(await metricValue('collab_append_audit_purge_stale_total'), '义务年龄边沿 inc（持续非空>阈值）').toBe(staleBefore + 1);
    // 边沿不复发：同窗再 tick 不重复计
    await scopedTick([PURGE]);
    expect(await metricValue('collab_append_audit_purge_stale_total'), '边沿判重（purgeStale 标记）不复发').toBe(staleBefore + 1);
    // 衰减（purgeBelowSeq 置 null）→ 窗清：再 tick 不计
    await prisma.canvasDoc.update({ where: { projectId: PURGE }, data: { purgeBelowSeq: null } });
    await scopedTick([PURGE]);
    expect(await metricValue('collab_append_audit_purge_stale_total'), '义务衰减窗清不复发').toBe(staleBefore + 1);
    const cur = await cursorState();
    expect((cur.lastGap[PURGE] as { purgeSince: number | null } | undefined)?.purgeSince, '衰减清窗（purgeSince=null）').toBeNull();
  });

  // ═══════════════ 红③：skip 面+轮转游标+单飞 ═══════════════
  it('红③-skip 面：DELETING 项目（有 doc）→skip-inactive 计数不审计；无 CanvasDoc 行项目→skip-no-doc 计数；ACTIVE+doc→审计入册', async () => {
    await seedHead(ROT[0]!, { pgSeq: 2n });
    await seedRow1(ROT[0]!, 1n); await seedRow1(ROT[0]!, 2n);
    await prisma.canvasProject.update({ where: { id: ROT_DEL }, data: { lifecycleState: 'DELETING' } });
    await seedHead(ROT_DEL, { pgSeq: 1n }); await seedRow1(ROT_DEL, 1n);
    await seedRow1(ROT[0]!, 3n, 1);   // ROT[0] pgSeq=2 行 3 越水位——DELETING 不审计故无违例入册
    // nodoc：无 CanvasDoc 行
    const scope = [ROT[0]!, ROT_DEL, ROT_NODOC];
    const inactiveBefore = await tickResult('collab_append_audit_tick_total', 'skip-inactive');
    const nodocBefore = await tickResult('collab_append_audit_tick_total', 'skip-no-doc');
    await scopedTick(scope, 3);   // 全宇宙一批
    // ★红（无 skip 面实现）：计数不增
    expect(await tickResult('collab_append_audit_tick_total', 'skip-inactive'), 'skip-inactive 计数').toBe(inactiveBefore + 1);
    expect(await tickResult('collab_append_audit_tick_total', 'skip-no-doc'), 'skip-no-doc 计数').toBe(nodocBefore + 1);
    const cur = await cursorState();
    expect(cur.lastGap[ROT_DEL], 'DELETING 不审计不入册').toBeUndefined();
    expect(cur.lastGap[ROT_NODOC], '无 doc 不审计不入册').toBeUndefined();
    expect((cur.lastGap[ROT[0]!] as { gap: boolean } | undefined)?.gap, 'ACTIVE+doc 审计入册（行 3 越水位违例 gap=true）').toBe(true);
  });

  it('红③-轮转游标：预算 2 分批——lastKey 逐批推进、尾部项目不被饿死（≤3 tick 全访问）、批不满回绕 \'\'+wrap 孤儿态剪除', async () => {
    for (const pid of ROT) {
      await seedHead(pid, { pgSeq: 1n });
      await seedRow1(pid, 1n);
    }
    const scope = [...ROT];
    await scopedTick(scope, 2);   // tick1：[a,b]（full——c 在库探得 +1）
    let cur = await cursorState();
    // ★红（无轮转游标实现）：lastKey 未推进
    expect(cur.lastKey, '批后 lastKey 推进至批尾项目（游标持久）').toBe(ROT[1]!);
    await scopedTick(scope, 2);   // tick2：[c]（批不满 →回绕 ''）
    cur = await cursorState();
    expect(cur.lastKey, '批不满回绕（下周目从头——尾部项目饿死根除）').toBe('');
    // 3 项目全访问（周目覆盖）
    for (const pid of ROT) {
      expect((cur.lastGap[pid] as { gap: boolean } | undefined)?.gap, `${pid} 已审计入册（周目全访问）`).toBe(false);
    }
    // wrap 孤儿剪除：残留 ghost 条目（项目/doc 已删）在回绕 tick（批不满）被剪
    const ghost = 'c31-rot-ghost';
    await prisma.collabJobCursor.update({
      where: { job: DOC_APPEND_GAP_AUDIT_JOB },
      data: {
        lastKey: ROT[1]!,   // 游标前拨至批尾——下一 tick 批不满=回绕+剪除窗
        lastGap: { ...cur.lastGap, [ghost]: { g: 1, gap: true, purgeSince: null } },
      },
    });
    await scopedTick(scope, 2);   // heads=[c]（1<2）→ 回绕+wrap 孤儿剪除
    cur = await cursorState();
    expect(cur.lastGap[ghost], 'wrap 孤儿态剪除（删除项目残留不虚增 gauge）').toBeUndefined();
    expect(cur.lastKey, '回绕 lastKey=\'\'').toBe('');
  });

  it('红③-advisory 单飞：第二实例持同键 xact 锁 →tick skip-singleflight 计数+游标零推进；锁释放后下一 tick ok', async () => {
    await seedHead(ROT[0]!, { pgSeq: 1n });
    await seedRow1(ROT[0]!, 1n);
    const skipBefore = await tickResult('collab_append_audit_tick_total', 'skip-singleflight');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let lockTaken!: () => void;
    const lockTakenGate = new Promise<void>((r) => (lockTaken = r));
    const holder = prismaB.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${APPEND_AUDIT_ADVISORY_KEY}))`;
      lockTaken();
      await gate;
    });
    try {
      await lockTakenGate;
      await scopedTick([ROT[0]!], 5);
      // ★红（无单飞实现）：不 skip（游标被推进）
      expect(await tickResult('collab_append_audit_tick_total', 'skip-singleflight'), '单飞让位 skip 计数').toBe(skipBefore + 1);
      const cur = await cursorState();
      expect(cur.lastKey, 'skip 档游标零推进（未取审计权）').toBeNull();
    } finally {
      release();
      await holder;
    }
    await scopedTick([ROT[0]!], 5);
    expect((await cursorState()).lastKey, '锁释放后下 tick 正常回绕').not.toBeNull();
  });

  // ═══════════════ 红⑤：正常批+adopt 零计数（判别双档） ═══════════════
  it('红⑤-正常批+T30b adopt 零计数：两档 tick 均 ok、新 gap 边沿零增、current gauge 持 0（判别双档）', async () => {
    // 档一：正常批（连续 1..3=pgSeq 3）
    await seedHead(T30B, { pgSeq: 3n });
    for (const s of [1n, 2n, 3n]) await seedRow1(T30B, s);
    const gapBefore = await metricValue('doc_append_gap_total');
    const currentBefore = await metricValue('collab_doc_append_gap_current');
    const okBefore = await tickResult('collab_append_audit_tick_total', 'ok');
    await scopedTick([T30B]);
    expect(await metricValue('doc_append_gap_total'), '正常批零新 gap').toBe(gapBefore);
    expect(await metricValue('collab_doc_append_gap_current'), 'current 持 0').toBe(currentBefore);
    expect(await tickResult('collab_append_audit_tick_total', 'ok'), 'tick ok').toBe(okBefore + 1);

    // 档二：T30b adopt 终态（活行 1,2,4+侧表 (3→source 1)+pgSeq 采纳 4——c30 红⓪-b 采后形态）
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: T30B } });
    await seedHead(T30B, { pgSeq: 4n });
    for (const s of [1n, 2n, 4n]) await seedRow1(T30B, s);
    await seedCoalesced(T30B, 3n, 1n);
    expect(await auditRows([T30B]), 'adopt 终态三断言零违例（b 断点侧表覆盖）').toEqual([]);
    await expect(assertAppendAuditThree(prisma, T30B)).resolves.toBeUndefined();
    await scopedTick([T30B]);
    // ★红（边沿误报）：adopt 档计数非零增
    expect(await metricValue('doc_append_gap_total'), 'adopt 档零新 gap（侧表覆盖断链豁免）').toBe(gapBefore);
    expect(await metricValue('collab_doc_append_gap_current'), 'current 持 0（修复回落重算）').toBe(currentBefore);
    expect(await tickResult('collab_append_audit_tick_total', 'ok'), '两档 tick 各计 ok').toBe(okBefore + 2);
    const cur = await cursorState();
    expect((cur.lastGap[T30B] as { gap: boolean } | undefined)?.gap, 'adopt 档入册 gap=false').toBe(false);
  });
});