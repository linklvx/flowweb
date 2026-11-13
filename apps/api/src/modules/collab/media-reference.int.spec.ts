// apps/api/src/modules/collab/media-reference.int.spec.ts
// C3b-3（plan v3 Task C3b-3——spec 2026-11-11-foundation-batch-design.md §3.4-4 :80/§3.4-6 :82/
// §3.4-10 :86）：decision snapshot+isMediaReferenced+referrer registry 红测（真 PG 5432——
// vitest.int.config 串行）。四红面（卡文①-④）：
//  ①decideTeamReferenceSnapshot(teamId,{excludeProjectId?})——GC 不传=全计入（含其他 DELETING
//    项目 B2）；erasure 传被擦项目（其自身引用不算保护——第七轮 P0-4）；决策级校验链=逐项目
//    header COMPLETE∧verifiedSeq===pgSeq∧generation 同∧epoch 非陈旧∧binding 水位===pgSeq∧非 dirty。
//  ②oracle 臂 join header 校验 epoch+generation+verifiedSeq+status——逐腿腐蚀 STALE 项目 →
//    snapshot bail-out+oracle-only 证人失效（isMediaReferenced=false）；复原→verified。
//  ③referrer registry 四组单独保护（binding-only/oracle-only/structured-only/objectKey-only
//    ——各 media 只置一类 referrer 其余清零）+registry 全条目 sweep（其余 referrer 各自独立命中）
//    +ObjectManifest 过期 claim 负控+includeDeletedProjects=false 负控。
//  ④erasure scope 三形态：A 擦 B 引用→detach（保护）；仅 A 自引用→删；A 擦时 B 为 DELETING→
//    B 仍计入保护（默认 includeDeletedProjects=true）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { OracleWorkerService } from './oracle-worker.service';
import { MediaReferenceService } from './media-reference.service';
import { MEDIA_REFERRERS } from './media-referrer.registry';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_A = 'c3b3-ref-a';        // erasure 宿主/决策宇宙（doc 携 oracle-only 引用）
const PID_B = 'c3b3-ref-b';        // 他项目（引用方）
const PID_B2 = 'c3b3-ref-b2';      // DELETING 项目（计入保护面）
const PID_S = 'c3b3-ref-stale';    // ② header 腐蚀腿专用（doc 携 oracle-only 引用）
const ALL_PIDS = [PID_A, PID_B, PID_B2, PID_S];

/** 空 doc 帧（nodes 根空——零引用）。 */
function emptyFrame(): Uint8Array {
  const doc = new Y.Doc();
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** 单节点引用 mediaId 的 doc 帧（oracle-only 证人载体——真扫产出 oracle 行，重扫自然重写）。 */
function refFrame(mediaId: string): Uint8Array {
  const doc = new Y.Doc();
  try {
    const node = new Y.Map<unknown>();
    const data = new Y.Map<unknown>();
    data.set('ref', mediaId);
    node.set('type', 'imageGen');
    node.set('data', data);
    (doc.getMap('nodes') as Y.Map<unknown>).set('n-ref', node);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

maybe('C3b-3：decision snapshot+isMediaReferenced+referrer registry', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const oracle = new OracleWorkerService(prisma as never, repo as never);
  const svc = new MediaReferenceService(prisma as never);
  /** 各项目当前 pgSeq（appendBatch 链——本 spec 自管）。 */
  const seqOf: Record<string, bigint> = {};
  /** worker 实例 epoch（freshest epoch 断言基准）。 */
  let epoch: string;

  // ── 媒体宇宙（各 media 恰一类 referrer——四组+erasure+负控）──
  const M = {
    binding: randomUUID(),  // binding-only（MediaBinding@B）
    oracleA: randomUUID(),  // oracle-only（A doc 引用——真扫 oracle 行；零 binding=投影滞后形态）
    oracleS: randomUUID(),  // oracle-only@STALE（② 腐蚀腿证人失效断言面）
    struct: randomUUID(),   // structured-only（NodeArtifact@B）
    objKey: randomUUID(),   // objectKey-only（VideoWork.coverKey=media.key）
    // ── registry sweep（其余条目各一 media）──
    lighting: randomUUID(),  // LightingTask.resultMediaId
    proj: randomUUID(),      // ArtifactProjection.mediaId
    intent: randomUUID(),    // GenerationIntent.resultRef
    trimSrc: randomUUID(),   // VideoTrimTask.sourceFileId
    trimOut: randomUUID(),   // VideoTrimTask.outputFileId
    timeline: randomUUID(),  // VideoProject.data JSON 深扫
    claim: randomUUID(),     // ObjectManifest 在位 claim（objectKey 臂）
    videoMedia: randomUUID(),// VideoWork.videoMediaId（mediaId 臂）
    // ── erasure 三形态 ──
    ab: randomUUID(),        // A 擦 B 引用→detach（binding@B）
    aOnly: randomUUID(),     // 仅 A 自引用→删（binding@A）
    ab2: randomUUID(),       // A 擦 B2(DELETING) 引用→仍保护（binding@B2）
    // ── 负控 ──
    expiredClaim: randomUUID(), // ObjectManifest 过期 claim（不算保护）
    free: randomUUID(),         // 零 referrer（不被任何臂命中）
  } as const;
  const ALL_MEDIA = Object.values(M) as string[];
  const keyOf = (id: string) => `c3b3/${id}`;
  const objKeyOf = (id: string) => `c3b3/obj/${id}`;
  const WORK_IDS = ['c3b3-work-1', 'c3b3-work-2'];

  /** 基态帧：A/S 携 oracle-only 引用；B/B2 空帧。 */
  const seedFrameOf = (pid: string): Uint8Array =>
    pid === PID_A ? refFrame(M.oracleA) : pid === PID_S ? refFrame(M.oracleS) : emptyFrame();

  beforeAll(async () => {
    for (const pid of ALL_PIDS) await ensureProjectFixture(prisma, pid);
    // 残留清扫（int 套件共享 dev 库——重跑幂等）
    await prisma.media.deleteMany({ where: { id: { in: ALL_MEDIA } } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    for (const pid of ALL_PIDS) {
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.create({ data: { projectId: pid, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false } });
    }
    await prisma.videoWork.deleteMany({ where: { id: { in: WORK_IDS } } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.lightingTask.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.videoTrimTask.deleteMany({ where: { workflowId: { in: ALL_PIDS } } });
    await prisma.videoProject.deleteMany({ where: { workflowId: { in: ALL_PIDS } } });
    await prisma.artifactProjection.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.generationIntent.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.objectManifest.deleteMany({ where: { objectKey: { in: ALL_MEDIA.map(objKeyOf) } } });
    await ensureLeaseFixture(prisma, repo);
    // ── 媒体行先行（oracle 真扫 JOIN Media 过滤需行在——key+objectKey 双键供 objectKey 臂）──
    for (const id of ALL_MEDIA) {
      await prisma.media.create({
        data: { id, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: keyOf(id), objectKey: objKeyOf(id), originalName: `${id}.png`, mimeType: 'image/png', size: 1n, type: 'generated' },
      });
    }
    // ── 基态帧（各项目一帧 pgSeq=1）+水位落定（mediaBindingSeq=pgSeq∧非 dirty——决策级前提）──
    for (const pid of ALL_PIDS) {
      const r = await repo.appendBatch(pid, [seedRow(seedFrameOf(pid), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
      expect(r).toEqual({ ok: true, rows: 1 });
      seqOf[pid] = 1n;
      await prisma.canvasDoc.updateMany({ where: { projectId: pid }, data: { mediaBindingSeq: 1n, bindingsDirty: false } });
    }
    // ── 真扫（header COMPLETE verifiedSeq=1 generation=1 epoch=worker 实例；A/S 各产 1 oracle 行）──
    for (const pid of ALL_PIDS) {
      expect(await oracle.scanProject(pid)).toMatchObject({ outcome: 'complete', verifiedSeq: 1n, refCount: pid === PID_A || pid === PID_S ? 1 : 0 });
    }
    epoch = oracle.historyEpoch;
    // ── B2 转 DELETING（扫后置位——DELETING 项目照常计入决策宇宙）──
    await prisma.canvasProject.updateMany({ where: { id: PID_B2 }, data: { lifecycleState: 'DELETING' } });
    // ── 四组 referrer ──
    await prisma.mediaBinding.create({ data: { mediaId: M.binding, projectId: PID_B, nodeId: 'n-1', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' } });
    await prisma.nodeArtifact.create({ data: { projectId: PID_B, nodeId: 'n-1', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '', mediaId: M.struct, source: 'generated' } });
    await prisma.videoWork.create({ data: { id: WORK_IDS[0], title: 'c3b3-cover', authorName: 't', videoKey: 'c3b3/work-video', coverKey: keyOf(M.objKey) } });
    // ── registry sweep referrer ──
    await prisma.lightingTask.create({ data: { userId: FIXTURE_USER, nodeId: 'n-1', projectId: PID_B, originalImageUrl: 'http://x', params: {}, teamId: FIXTURE_TEAM, resultMediaId: M.lighting } });
    await prisma.artifactProjection.create({ data: { artifactId: 'c3b3-art-1', artifactRev: 0, projectId: PID_B, nodeId: 'n-1', targetField: 'fileId', targetItemId: '', mediaId: M.proj, state: 'pending' } });
    await prisma.generationIntent.create({
      data: {
        projectId: PID_B, nodeId: 'n-1', userId: FIXTURE_USER, teamId: FIXTURE_TEAM, intentId: 'c3b3-intent', kind: 'image',
        paramsHash: 'c3b3-hash', creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: 'c3b3-idem', execSeq: 910001n, resultRef: M.intent,
      },
    });
    await prisma.videoTrimTask.create({ data: { userId: FIXTURE_USER, workflowId: PID_B, nodeId: 'n-1', sourceFileId: M.trimSrc, startTime: 0, endTime: 1, teamId: FIXTURE_TEAM, status: 'done', outputFileId: M.trimOut } });
    await prisma.videoProject.create({ data: { teamId: FIXTURE_TEAM, userId: FIXTURE_USER, workflowId: PID_B, sourceNodeId: 'c3b3-src-node', title: 'c3b3-tl', data: { clips: [{ mediaId: M.timeline }] } } });
    await prisma.objectManifest.create({ data: { objectKey: objKeyOf(M.claim), sizeBytes: 1n, claimOwner: 'c3b3', claimUntil: BigInt(Date.now() + 60_000), state: 'LIVE' } });
    await prisma.videoWork.create({ data: { id: WORK_IDS[1], title: 'c3b3-pub', authorName: 't', videoKey: 'c3b3/work-video-2', videoMediaId: M.videoMedia } });
    // ── erasure 三形态 ──
    await prisma.mediaBinding.create({ data: { mediaId: M.ab, projectId: PID_B, nodeId: 'n-2', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' } });
    await prisma.mediaBinding.create({ data: { mediaId: M.aOnly, projectId: PID_A, nodeId: 'n-3', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' } });
    await prisma.mediaBinding.create({ data: { mediaId: M.ab2, projectId: PID_B2, nodeId: 'n-4', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' } });
    // ── 负控 ──
    await prisma.objectManifest.create({ data: { objectKey: objKeyOf(M.expiredClaim), sizeBytes: 1n, claimOwner: 'c3b3', claimUntil: BigInt(Date.now() - 60_000), state: 'LIVE' } });
  }, 120_000);

  afterAll(async () => {
    await prisma.videoWork.deleteMany({ where: { id: { in: WORK_IDS } } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.lightingTask.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.videoTrimTask.deleteMany({ where: { workflowId: { in: ALL_PIDS } } });
    await prisma.artifactProjection.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.generationIntent.deleteMany({ where: { projectId: { in: ALL_PIDS } } });
    await prisma.objectManifest.deleteMany({ where: { objectKey: { in: ALL_MEDIA.map(objKeyOf) } } });
    await prisma.media.deleteMany({ where: { id: { in: ALL_MEDIA } } });
    await restoreLeaseRow(prisma);
    for (const pid of ALL_PIDS) await cleanupProjectFixture(prisma, pid);
    await prisma.$disconnect();
  }, 120_000);

  /** 追加一帧空 doc 并推进 pgSeq（返回新 S——水位同步置落定〔snapshot 决策级前提〕）。 */
  async function appendFrame(pid: string): Promise<bigint> {
    const prev = seqOf[pid] ?? 0n;
    const next = prev + 1n;
    const r = await repo.appendBatch(pid, [seedRow(emptyFrame(), next)], { expectedPgSeq: prev, newPgSeq: next, walCheckpointSeq: next });
    expect(r).toEqual({ ok: true, rows: 1 });
    seqOf[pid] = next;
    await prisma.canvasDoc.updateMany({ where: { projectId: pid }, data: { mediaBindingSeq: next, bindingsDirty: false } });
    return next;
  }

  const refOpts = { teamId: FIXTURE_TEAM };

  // ── ① GC scope：不传 exclude=全计入（含 DELETING B2）+决策级五前提全绿 ──
  it('①GC 不传全计入：verified 含 B2(DELETING)；erasure exclude=B2 → B2 出列；零项目 team=verified 空', async () => {
    const snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap.outcome).toBe('verified');
    if (snap.outcome !== 'verified') return;
    expect(snap.historyEpoch).toBe(epoch);
    expect(snap.projects.map((p) => p.projectId).sort()).toEqual([...ALL_PIDS].sort());   // B2(DELETING) 照入决策宇宙
    expect(snap.projects.every((p) => p.pgSeq === 1n)).toBe(true);
    // erasure 形态：exclude=B2 → B2 出列（被擦项目自身引用不算保护——第七轮 P0-4）
    const snap2 = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM, { excludeProjectId: PID_B2 });
    expect(snap2.outcome).toBe('verified');
    if (snap2.outcome !== 'verified') return;
    expect(snap2.projects.map((p) => p.projectId)).not.toContain(PID_B2);
    // 零项目 team：verified 空集
    const emptyTeam = await svc.decideTeamReferenceSnapshot('c3b3-no-such-team');
    expect(emptyTeam).toMatchObject({ outcome: 'verified' });
    if (emptyTeam.outcome === 'verified') expect(emptyTeam.projects).toEqual([]);
  }, 60_000);

  // ── ② oracle 臂 join header 校验（epoch+generation+verifiedSeq+status）+水位两腿+缺位两腿——逐腿腐蚀 ──
  it('②header 逐腿腐蚀→snapshot bail-out+oracle-only 证人失效；复原→verified（oracle 臂在位时证人有效）', async () => {
    // 前置：oracle-only@S 证人在位（header 有效——② 前全体 COMPLETE）
    expect(await svc.isMediaReferenced(prisma, M.oracleS, refOpts)).toBe(true);
    // 腿1 verifiedSeq 陈旧：STALE 前进一帧不重扫（header verifiedSeq=1 ≠ pgSeq=2）
    const s2 = await appendFrame(PID_S);
    let snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'header-stale-verified-seq', projectId: PID_S });
    expect(await svc.isMediaReferenced(prisma, M.oracleS, refOpts)).toBe(false);   // header 非决策级→oracle 证人不认
    // 复原：重扫到新 pgSeq（oracle 行随重扫原子重写——doc 引用仍在帧 1）
    expect(await oracle.scanProject(PID_S)).toMatchObject({ outcome: 'complete', verifiedSeq: s2 });
    expect(await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM).then((r) => r.outcome)).toBe('verified');
    expect(await svc.isMediaReferenced(prisma, M.oracleS, refOpts)).toBe(true);
    // 腿2 generation 失配（header generation ≠ doc generation）
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_S }, data: { generation: 99 } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'header-generation-mismatch', projectId: PID_S });
    expect(await svc.isMediaReferenced(prisma, M.oracleS, refOpts)).toBe(false);
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_S }, data: { generation: 1 } });
    // 腿3 epoch 陈旧（header epoch ≠ 当前 epoch——freshest 旁证；S 重扫后 scannedAt 最新，先拨 A 的
    // scannedAt 使 freshest=A〔真实 epoch〕，S 的死 epoch 即判陈旧）
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_S }, data: { historyEpoch: 'c3b3-dead-epoch' } });
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_A }, data: { scannedAt: new Date() } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'header-epoch-stale', projectId: PID_S });
    expect(await svc.isMediaReferenced(prisma, M.oracleS, refOpts)).toBe(false);
    expect(await svc.isMediaReferenced(prisma, M.oracleA, refOpts)).toBe(true);   // freshest epoch 证人（A）仍有效
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_S }, data: { historyEpoch: oracle.historyEpoch } });
    // 腿4 status≠COMPLETE（VERIFYING 在途）
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_S }, data: { status: 'VERIFYING' } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'header-not-complete', projectId: PID_S });
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_S }, data: { status: 'COMPLETE' } });
    // 腿5 binding 水位滞后（mediaBindingSeq≠pgSeq）
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_S }, data: { mediaBindingSeq: 0n } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'binding-watermark-lagging', projectId: PID_S });
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_S }, data: { mediaBindingSeq: seqOf[PID_S] } });
    // 腿6 bindingsDirty=true
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_S }, data: { bindingsDirty: true } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'binding-dirty', projectId: PID_S });
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_S }, data: { bindingsDirty: false } });
    // 腿7 header 缺位（项目从未扫/被清）
    await prisma.canvasReferenceOracleScan.delete({ where: { projectId: PID_B2 } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'header-missing', projectId: PID_B2 });
    expect(await oracle.scanProject(PID_B2)).toMatchObject({ outcome: 'complete', verifiedSeq: seqOf[PID_B2] });
    // 腿8 doc 缺位（项目行在而 CanvasDoc 行缺——coverage 不可证）
    await prisma.canvasDoc.delete({ where: { projectId: PID_B2 } });
    snap = await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM);
    expect(snap).toMatchObject({ outcome: 'bail-out', reason: 'doc-missing', projectId: PID_B2 });
    await prisma.canvasDoc.create({ data: { projectId: PID_B2, generation: 1, schemaVersion: 3, pgSeq: seqOf[PID_B2], walCheckpointSeq: seqOf[PID_B2], mediaBindingSeq: seqOf[PID_B2], bindingsDirty: false } });
    // 复原终态：verified
    expect(await svc.decideTeamReferenceSnapshot(FIXTURE_TEAM).then((r) => r.outcome)).toBe('verified');
  }, 120_000);

  // ── ③ 四组单独保护（binding/oracle/structured/objectKey 各只置一类）──
  it('③四组单独保护：binding-only/oracle-only/structured-only/objectKey-only 各自独立命中；excludeProjectId 同步摘除（除无项目锚的 objectKey 臂）', async () => {
    expect(await svc.isMediaReferenced(prisma, M.binding, refOpts)).toBe(true);          // binding-only（@B）
    expect(await svc.isMediaReferenced(prisma, M.binding, { ...refOpts, excludeProjectId: PID_B })).toBe(false);
    expect(await svc.isMediaReferenced(prisma, M.oracleA, refOpts)).toBe(true);          // oracle-only（@A）
    expect(await svc.isMediaReferenced(prisma, M.oracleA, { ...refOpts, excludeProjectId: PID_A })).toBe(false);
    expect(await svc.isMediaReferenced(prisma, M.struct, refOpts)).toBe(true);           // structured-only（NodeArtifact@B）
    expect(await svc.isMediaReferenced(prisma, M.struct, { ...refOpts, excludeProjectId: PID_B })).toBe(false);
    expect(await svc.isMediaReferenced(prisma, M.objKey, refOpts)).toBe(true);           // objectKey-only（coverKey=media.key）
    expect(await svc.isMediaReferenced(prisma, M.objKey, { ...refOpts, excludeProjectId: PID_B })).toBe(true);   // VideoWork 无项目锚——恒保护
  }, 60_000);

  // ── ③b registry 全条目 sweep+负控 ──
  it('③b registry sweep：其余 referrer 各自独立命中（LightingTask/ArtifactProjection/GenerationIntent.resultRef/VideoTrim source+output/VideoProject.data/ObjectManifest claim/VideoWork.videoMediaId）；过期 claim 不算；includeDeletedProjects=false 摘 DELETING 引用', async () => {
    expect(await svc.isMediaReferenced(prisma, M.lighting, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.proj, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.intent, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.trimSrc, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.trimOut, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.timeline, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.timeline, { ...refOpts, excludeProjectId: PID_B })).toBe(false);   // VideoProject workflowId 摘除
    expect(await svc.isMediaReferenced(prisma, M.claim, refOpts)).toBe(true);           // 在位 claim（objectKey 臂）
    expect(await svc.isMediaReferenced(prisma, M.videoMedia, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.expiredClaim, refOpts)).toBe(false);   // 过期 claim 负控
    expect(await svc.isMediaReferenced(prisma, M.free, refOpts)).toBe(false);           // 零 referrer 负控
    // includeDeletedProjects=false：DELETING B2 的 binding 引用被摘
    expect(await svc.isMediaReferenced(prisma, M.ab2, refOpts)).toBe(true);
    expect(await svc.isMediaReferenced(prisma, M.ab2, { ...refOpts, includeDeletedProjects: false })).toBe(false);
  }, 60_000);

  // ── ④ erasure scope 三形态 ──
  it('④erasure 三形态：A 擦 B 引用→保护(detach)；仅 A 自引用→删；B DELETING→仍计入', async () => {
    const eraseA = { ...refOpts, excludeProjectId: PID_A };
    expect(await svc.isMediaReferenced(prisma, M.ab, eraseA)).toBe(true);       // 形态1：B 引用→detach
    expect(await svc.isMediaReferenced(prisma, M.aOnly, eraseA)).toBe(false);   // 形态2：仅 A 自引用→删
    expect(await svc.isMediaReferenced(prisma, M.aOnly, refOpts)).toBe(true);   // GC 面（不排除）→保护
    expect(await svc.isMediaReferenced(prisma, M.ab2, eraseA)).toBe(true);      // 形态3：B2 DELETING→默认仍计入
  }, 60_000);

  // ── registry 载体自证：条目数+table/column/kind 三元（census ㊴ 联动门前置）──
  it('registry 载体：十条目（table/column/kind 三元——ObjectManifest/VideoWork.coverKey=objectKey，VideoTrim=mediaId）', () => {
    expect(MEDIA_REFERRERS.length).toBe(10);
    const keys = MEDIA_REFERRERS.map((r) => `${r.table}.${r.column}:${r.kind}`).sort();
    expect(keys).toEqual([
      'ArtifactProjection.mediaId:mediaId',
      'GenerationIntent.resultRef:mediaId',
      'LightingTask.resultMediaId:mediaId',
      'NodeArtifact.mediaId:mediaId',
      'ObjectManifest.objectKey:objectKey',
      'VideoProject.data:mediaId',
      'VideoTrimTask.outputFileId:mediaId',
      'VideoTrimTask.sourceFileId:mediaId',
      'VideoWork.coverKey:objectKey',
      'VideoWork.videoMediaId:mediaId',
    ]);
  });
});
