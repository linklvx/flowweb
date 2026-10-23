// apps/api/src/modules/artifact-core/artifact-commit.service.ts —— Y1a+Y1b T10（spec Z18''-v14 ②③④⑥⑦）
// +T12 video kind 分支（裁决①/⑮/㉔-2/㉔-3）：
// ArtifactCommitService=资金路径（text/image/edit/lighting/video）唯一 finalize
// 编排器——image 同步链（stageInTx 短事务 durable 化→SafeRemoteFetch 下载→服务端自算 sha256+sniff
// →MinIO content-addressed key 上传→finalize 单事务）；finalize 事务序列（锁序契约 20：先 lockBalance
// 再碰 intent——ABBA 死锁防线；幂等检查在 CAS 前；NodeArtifact casUpsert→intent CAS→settleInTx
// 失败整体回滚；40P01/40001/55P03/P2024 有界重试+jitter）。
//
// video=finalize-first（T12）：provider 成功即 settle+finalize（资金流与 image 零 delta——只换交付载荷
// =fileId 交付 mediaId）；finalize 事务内经 registerInTx 建 Media(processing,sourceUrl 专用列+预分配
// key)——建行不 stage 字节（㉔-3，区别于 image 系 stage→上传→finalize 提升模式）；NodeArtifact
// state=materializing；materialize 异步归 MaterializeJob（materialize-job.service.ts——自有
// processingLeaseUntil/processingAttempts 退避与 intent attempts/rearm 彻底解耦；终态失败幂等补偿退款
// +artifactState=failed+errorCode=MATERIALIZE_FAILED——不清 fileId）。
//
// 资金独立判（NodeArtifact CAS 0 行=superseded 时）：intent CAS 成功∧provider 成功→照常 settle、
// 产物入素材库（Media 行保留——用户从素材库取）；intent CAS 失败（新代接管/终态）→不 settle、
// void 旧冻结。禁「CAS 失败静默丢产物」与「无条件退款」两错分支。
//
// kind 分支（v13b+T12）：text=跳过 Media（NodeArtifact resultText/state=stored）；image/edit/lighting=
// stage 行 finalize 提升 completed；video=finalize 事务内建 Media(processing)+state=materializing
// ——materialize 异步（MaterializeJob），本服务不物化字节。
// 资金 quota=软限：finalize 不因 quota 回滚（钱已付 provider）；registerInTx 禁调 assertOnConfirm
// +事务内禁外部 IO（下载/上传全在 finalize 事务之前——video 的下载更在 finalize 之后）。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Media, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { MinioService } from '../minio/minio.service';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { sniffMimeType } from '../media/sniff';
import { NodeArtifactService, targetFieldOfKind } from './node-artifact.service';
import { MediaRegistrationService } from './media-registration.service';

/** stage 行 provider 源过期默认窗（image 系 provider CDN URL 常见时数量级；过期后 R3 降级/判弃依据）。 */
export const ARTIFACT_SOURCE_URL_TTL_MS = 24 * 3600_000;
/** finalize 事务有界重试上界（死锁/锁等待/池超时族——40P01/40001/55P03/P2024）。 */
export const FINALIZE_TX_MAX_RETRIES = 3;
/** 重试退避 jitter 基数（25~75ms 均匀抖动——防同批竞争者同步重撞）。 */
const RETRY_JITTER_BASE_MS = 25;

/** 可重试事务错误集：Prisma P2034（write conflict/deadlock 映射）/P2024（pool timeout）+裸 PG
 *  SQLSTATE（$queryRaw/$executeRaw 路径 P2010+meta.code 或直抛形态——pg-error.util isFkGone 同款双形状）。 */
export function isRetryableFinalizeError(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } };
  const codes = [err?.code, err?.meta?.code];
  return codes.some((c) => c === 'P2034' || c === 'P2024' || c === '40P01' || c === '40001' || c === '55P03');
}

/** content-addressed 对象 key 基座（v14：`artifacts/{teamId}/{intentRowId}/{execSeq}/{index}`——
 *  sha256 后缀在下载自算后拼：完整 key=`{base}-{sha256}`；provisional=base（stage 行幂等锚）。 */
export function artifactObjectKeyBase(teamId: string, intentRowId: string, execSeq: bigint, artifactIndex: number): string {
  return `artifacts/${teamId}/${intentRowId}/${execSeq}/${artifactIndex}`;
}

export interface CommitImageParams {
  projectId: string;
  nodeId: string;
  teamId: string;
  userId: string;
  intentRowId: string;
  execSeq: bigint;
  /** claim 时捕获的槽位 rev（claim.artifactRev）。 */
  expectedRev: number;
  /** provider 结果源 URL（stage durable 行的 sourceUrl——崩溃后 R3 凭行重下）。 */
  sourceUrl: string;
  /** provider 声明 MIME（下载响应 Content-Type 缺失时的回退档）。 */
  sourceMimeType?: string | null;
  sourceUrlExpiresAt?: Date;
  /** 业务审计锚（lighting 任务 id——Media.taskId 可空列）。 */
  taskId?: string | null;
  artifactIndex?: number;
  /** 产物原始名基座（默认 ai-${nodeId}；edit/lighting 传各自前缀）——扩展名由 sniff 终判 MIME 分档。 */
  originalNameBase?: string;
}

export interface FinalizeTextParams {
  projectId: string;
  nodeId: string;
  teamId: string;
  userId: string;
  intentRowId: string;
  execSeq: bigint;
  expectedRev: number;
  resultText: string;
}

/** T12 video kind 分支入参（finalize-first——spec 裁决①/⑮：provider 成功即 settle+finalize，
 *  交付载荷只换 fileId=mediaId；字节物化归 MaterializeJob 异步）。 */
export interface FinalizeVideoParams {
  projectId: string;
  nodeId: string;
  teamId: string;
  userId: string;
  intentRowId: string;
  execSeq: bigint;
  expectedRev: number;
  /** provider 结果源 URL——Media(processing).sourceUrl 专用列（materialize 下载源+processing 期 content 代理源）。 */
  sourceUrl: string;
  /** provider 声明 MIME（缺省 video/mp4——与 provider 结果 CDN 声明档对齐）。 */
  sourceMimeType?: string | null;
  sourceUrlExpiresAt?: Date;
  artifactIndex?: number;
}

/** finalize 三态出口（调用方据此分派 doc 交付：superseded=不覆盖用户值；intent-stale=零交付）。
 *  不变量（质评收口 Important#1——消费方 mediaId!/key! 断言的依据，幂等路径回填保成立）：
 *  image 系（commitImage）的 committed/superseded 必携 mediaId+key——首程来自 stage/上传描述符，
 *  幂等复驱（commitImage 入口预检+finalize 事务内幂等分支）从锚定 NodeArtifact/Media 行回填；
 *  text（finalizeText）的 committed 不携（无 Media）；intent-stale 恒不携。 */
export interface CommitOutcome {
  outcome: 'committed' | 'superseded' | 'intent-stale';
  mediaId?: string;
  /** MinIO 对象键（lighting 任务回填 presigned 结果 URL 消费）。 */
  key?: string;
}

/** T13 R3（spec Z18''⑥）：R3 动作表决策——finalizeFromExistingMediaOrText 返回值（护栏执行归
 *  IntentReconcileService：advisory lock+审计行+锁外 IO 分派）。词表与 ReconcileAction.action/
 *  intent-reconcile.metrics label 同源。 */
export type R3Decision =
  | { action: 'noop' }
  | { action: 'settle-backfill'; acted: boolean }
  | { action: 'projection-backfill' }
  /** SUCCEEDED∧未核销∧无锚行∧无 stage（settle 失败崩溃窗无产物）——调用方走 rollbackStranded（退款）。 */
  | { action: 'rollback-stranded' }
  /** 窗⑥（T15 质评 Important#1 根治）：SUCCEEDED∧当前代投影行 orphaned（poller 标记后退款抛错悬置
   *  窗——已核销行不进终态悬留批〔reserved=0〕，旧决策表 noop=退款永悬）——调用方走
   *  rollbackDeliveryFailed（锁外 CAS 幂等，与 poller 路径互斥收敛恰一次）。 */
  | { action: 'orphaned-refund' }
  /** FAILED/VOIDED∧reserved>0∧无 artifact/无 delivered——调用方走 voidInTx（幂等 release）。 */
  | { action: 'void-terminal' }
  /** 歧义态（FAILED/VOIDED∧有交付凭据等）——不动钱，审计 manual-required+计数告警（裁决 :27④）。 */
  | { action: 'manual-required'; reason: string }
  /** RUNNING∧stage 行（Media processing∧sourceUrl）在——provider 成功已 durable 化但 finalize 未达
   *  （Media 后崩溃窗）→ 调用方锁外重下 finalize（provider 不重调）。 */
  | {
      action: 'finalize-from-stage';
      stage: {
        intentRowId: string; execSeq: string; sourceUrl: string;
        projectId: string; nodeId: string; teamId: string; userId: string; kind: string; sourceMimeType: string | null;
        /** claim 时捕获的槽位 rev 持久列（评审 Important#1）——finalizeFromStage 的 expectedRev 唯一源：
         *  悬留窗用户 replace/clear 使槽位 rev 前进 ⇒ 此值失配 ⇒ superseded 不覆盖用户值。 */
        claimArtifactRev: number;
      };
    }
  /** 行灭失/换代/无可收敛态（RUNNING 无 stage 等留 reaper 三查剩余分支）。 */
  | { action: 'not-recoverable' };

interface FinalizeParams {
  projectId: string;
  nodeId: string;
  teamId: string;
  userId: string;
  intentRowId: string;
  execSeq: bigint;
  expectedRev: number;
  kind: string;
  /** intent.resultRef 写入值（image=mediaId；text=`text:` 截断占位——既有语义；video=mediaId〔行在
   *  事务内建，completeInTx 实参取 videoMedia.id——本字段 video 不消费〕）。 */
  resultRef: string;
  /** image 系：stage 行提升描述符（text/video 不传——video 建行不提升）。 */
  media?: { mediaId: string; projectId: string; key: string; sha256: string; mimeType: string; sniffedMimeType: string | null; size: number; originalName: string };
  /** T12 video：finalize 事务内 registerInTx 建行参数（Media(processing)+sourceUrl 专用列+预分配 key）。 */
  video?: { sourceUrl: string; sourceMimeType?: string | null; sourceUrlExpiresAt?: Date };
  resultText?: string;
  artifactIndex: number;
}

/** finalize 事务内 intent CAS 失败信号——throw 即整体回滚（NodeArtifact/binding/投影/Media 提升全撤），
 *  外层捕获后独立 void 旧冻结（资金独立判 intent-CAS-失败分支）。 */
class IntentStaleSignal extends Error {
  constructor(reason: string) { super(`INTENT_FINALIZE_STALE: ${reason}`); }
}

/** F1 资金硬门（用户裁定①）：付费 finalize settle 未达核销且核销凭据不成立——冻结灭失（付费无冻结
 *  且从未消耗）或冻结锚与行代际不一致等资金不变量破缺。throw 即 finalize 事务整体回滚（intent 终态
 *  /NodeArtifact/投影/Media 全撤=零交付）。无 code ⇒ 天然不入 isRetryableFinalizeError 有界重试白名单
 *  （确定性破缺禁重试）；传播到执行面由 catch 按 instanceof 禁自动退款/禁 fail（行留 RUNNING+冻结
 *  原样，交对账第四分支裁决）。 */
export class FundsInvariantError extends Error {
  constructor(d: { intentRowId: string; execSeq: bigint; creditCost: number; reservedCredits: number; creditsConsumed: number; reservedExecSeq: bigint | null }) {
    super(
      `FUNDS_INVARIANT_VIOLATION: 意图行 ${d.intentRowId} 代 ${d.execSeq} 付费(${d.creditCost})核销凭据不成立` +
      `（reservedCredits=${d.reservedCredits} creditsConsumed=${d.creditsConsumed} reservedExecSeq=${d.reservedExecSeq}）`,
    );
    this.name = 'FundsInvariantError';
  }
}

@Injectable()
export class ArtifactCommitService {
  private readonly logger = new Logger(ArtifactCommitService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(GenerationIntentService) private readonly intents: GenerationIntentService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(SafeRemoteFetchService) private readonly safeFetch: SafeRemoteFetchService,
    @Inject(NodeArtifactService) private readonly nodeArtifacts: NodeArtifactService,
    @Inject(MediaRegistrationService) private readonly registration: MediaRegistrationService,
  ) {}

  /** image 同步链（image/edit/lighting 共用——T10 集成面）：幂等预检→stage durable→下载→sha/sniff→
   *  上传 content-addressed key→finalize 单事务。下载/上传全在 finalize 事务之外（事务内禁外部 IO）。 */
  async commitImage(params: CommitImageParams): Promise<CommitOutcome> {
    const artifactIndex = params.artifactIndex ?? 0;
    // ── 质评收口 Important#2：幂等重驱预检（两索引读，零锁零 IO）——intent 已 SUCCEEDED∧产物锚定行在
    //    ⇒ 整链曾完整成功，回填出口直接返回零重下载/零重上传（否则 provider URL 过期时 fetch throw→
    //    上层按失败重试白耗 attempts）；锚行缺（被 T11 replace 改锚）不短路——照走全链由 finalize
    //    幂等分支收敛。 ──
    const early = await this.idempotentOutcome(params.intentRowId, params.execSeq, artifactIndex);
    if (early) return early;
    const stage = await this.stageImage(params);
    const fetched = await this.safeFetch.fetchBuffer(params.sourceUrl);
    const sha256 = createHash('sha256').update(fetched.buffer).digest('hex');
    const sniffed = await sniffMimeType(fetched.buffer.subarray(0, 4100));
    const mimeType = sniffed ?? fetched.contentType ?? params.sourceMimeType ?? 'application/octet-stream';
    const key = `${stage.keyBase}-${sha256}`;
    await this.minio.upload(key, fetched.buffer, mimeType);
    // 质评收口 Minor#7：originalName 按 sniff 终判 MIME 扩展名分档（edit/lighting 结果可为
    // jpeg/webp——stage 行的 .png 只是 provisional，提升时改写，不再永久错档）
    const ext = mimeType.split('/')[1] || 'png';
    return this.finalize({
      projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId, userId: params.userId,
      intentRowId: params.intentRowId, execSeq: params.execSeq, expectedRev: params.expectedRev,
      kind: 'image', resultRef: stage.mediaId, artifactIndex,
      media: {
        mediaId: stage.mediaId, projectId: params.projectId, key, sha256,
        mimeType, sniffedMimeType: sniffed, size: fetched.buffer.length,
        originalName: `${params.originalNameBase ?? `ai-${params.nodeId}`}.${ext}`,
      },
    });
  }

  /** 幂等出口回填（commitImage 预检+finalize 事务内幂等分支共用——Important#1/2）：intent 已
   *  SUCCEEDED∧核销 且 锚定 NodeArtifact 行存在 ⇒ committed+mediaId/key 回填（消费方非空断言依据）。
   *  F1 代际守卫（入口面——质评 P2#4）：SUCCEEDED∧已核销但行 execSeq≠票=旧代复驱 ⇒ 直出
   *  intent-stale（与 finalize 事务内代际守卫同裁决）——免跑 stage/下载/上传浪费链（否则 stage 先落
   *  新 Media(processing) 行、provider URL 过期再白耗重试 attempts后才在 finalize 被拒=行泄漏）。
   *  已核销行冻结恒 0 ⇒ finalize 面旧代 void_ 在此形态幂等 no-op——入口直出零资金副作用。
   *  返回 null=不满足幂等（照走全链）。 */
  private async idempotentOutcome(intentRowId: string, execSeq: bigint, artifactIndex: number): Promise<CommitOutcome | null> {
    const intent = await this.prisma.generationIntent.findUnique({
      where: { id: intentRowId },
      select: { status: true, execSeq: true, creditsConsumed: true, creditCost: true },
    });
    if (!intent || intent.status !== 'SUCCEEDED' || intent.creditsConsumed !== intent.creditCost) return null;
    if (intent.execSeq !== execSeq) return { outcome: 'intent-stale' };
    const existing = await this.prisma.nodeArtifact.findUnique({
      where: { sourceIntentRowId_sourceExecSeq_artifactIndex: { sourceIntentRowId: intentRowId, sourceExecSeq: execSeq, artifactIndex } },
    });
    if (!existing) return null;
    const media = existing.mediaId
      ? await this.prisma.media.findUnique({ where: { id: existing.mediaId }, select: { key: true } })
      : null;
    return { outcome: 'committed', mediaId: existing.mediaId ?? undefined, key: media?.key ?? undefined };
  }

  /** stage 短事务（不锁 balance——与 finalize 资金事务解耦）：Media(processing) 落 sourceUrl+
   *  objectKey 预分配+资金锚（ON CONFLICT (bucket,key) 幂等——同 intent+execSeq 重跑恰一行）
   *  +同事务 processing fact。崩溃在 stage 后=R3 凭 processing 行+sourceUrl 重下并 finalize。 */
  async stageImage(params: CommitImageParams): Promise<{ mediaId: string; keyBase: string }> {
    const artifactIndex = params.artifactIndex ?? 0;
    const keyBase = artifactObjectKeyBase(params.teamId, params.intentRowId, params.execSeq, artifactIndex);
    const media = await this.prisma.$transaction((tx) => this.registration.registerInTx(tx, {
      userId: params.userId, teamId: params.teamId, projectId: params.projectId, nodeId: params.nodeId,
      taskId: params.taskId ?? null,
      key: keyBase,
      sourceUrl: params.sourceUrl,
      sourceUrlExpiresAt: params.sourceUrlExpiresAt ?? new Date(Date.now() + ARTIFACT_SOURCE_URL_TTL_MS),
      mimeType: params.sourceMimeType ?? 'image/png',
      originalName: `ai-${params.nodeId}.png`,
      sourceIntentRowId: params.intentRowId, sourceExecSeq: params.execSeq, artifactIndex,
    }));
    return { mediaId: media.id, keyBase };
  }

  /** text kind 分支（v13b）：无 Media——finalize 直达（NodeArtifact resultText/state=stored）。 */
  async finalizeText(params: FinalizeTextParams): Promise<CommitOutcome> {
    return this.finalize({
      projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId, userId: params.userId,
      intentRowId: params.intentRowId, execSeq: params.execSeq, expectedRev: params.expectedRev,
      kind: 'text', resultRef: `text:${params.resultText.slice(0, 100)}`,   // 既有占位语义（观测用）
      resultText: params.resultText, artifactIndex: 0,
    });
  }

  /** T12 video kind 分支（finalize-first）：finalize 单事务=registerInTx 建 Media(processing, sourceUrl
   *  专用列+预分配 key+同事务 processing fact)+NodeArtifact state=materializing+intent CAS(resultRef=
   *  mediaId)+settle/complete+投影/binding（fileId 交付 mediaId）——事务内零 IO（下载归 MaterializeJob
   *  异步，与 image 系 stage→上传→finalize 提升模式相反：建行不 stage 字节〔㉔-3〕）。
   *  幂等预检同 commitImage（已 SUCCEEDED∧锚行在 ⇒ 回填零重建）。 */
  async finalizeVideo(params: FinalizeVideoParams): Promise<CommitOutcome> {
    const artifactIndex = params.artifactIndex ?? 0;
    const early = await this.idempotentOutcome(params.intentRowId, params.execSeq, artifactIndex);
    if (early) return early;
    return this.finalize({
      projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId, userId: params.userId,
      intentRowId: params.intentRowId, execSeq: params.execSeq, expectedRev: params.expectedRev,
      kind: 'video', resultRef: '',   // 实参=事务内 videoMedia.id（行在 finalize 事务内建——见 finalizeInTx）
      video: {
        sourceUrl: params.sourceUrl,
        sourceMimeType: params.sourceMimeType ?? 'video/mp4',
        sourceUrlExpiresAt: params.sourceUrlExpiresAt ?? new Date(Date.now() + ARTIFACT_SOURCE_URL_TTL_MS),
      },
      artifactIndex,
    });
  }

  /** T13 R3（spec Z18''⑥）：R3 动作表单入口——**所有自动收敛经此**（同一幂等 finalize 语族；判据
   *  全量 PG：NodeArtifact 锚行/Media stage 行/ArtifactProjection——provider 不重调、doc 不探测
   *  〔probeArtifacts 退款后门已删〕）。调用方=IntentReconcileService（advisory-lock 事务内调用——
   *  本方法判定读**不取 intent 行锁**：settleInTx 自带 lockBalance→intent CAS 锁序〔契约 20〕，判定
   *  竞态由 CAS+advisory 兜底）。InTx 原子执行面=settle-backfill（补核销）/projection-backfill
   *  （补建投影行）；锁外执行面（返回 decision 由调用方分派）=rollback-stranded（退款——资损方向
   *  判定归调用方）/void-terminal（幂等 release）/finalize-from-stage（IO 重下——commitImage 同构）。
   *  幂等：双跑第二轮判据已收敛（SUCCEEDED∧已核销∧行齐）→ noop——零双 settle 零双退款零双审计。 */
  async finalizeFromExistingMediaOrText(
    tx: Prisma.TransactionClient,
    intentRowId: string,
    execSeq: bigint,
  ): Promise<R3Decision> {
    const row = await tx.generationIntent.findUnique({
      where: { id: intentRowId },
      select: { status: true, execSeq: true, reservedCredits: true, creditsConsumed: true, creditCost: true, projectId: true, nodeId: true, teamId: true, userId: true, kind: true, claimArtifactRev: true },
    });
    if (!row || row.execSeq !== execSeq) return { action: 'not-recoverable' };
    const anchor = await tx.nodeArtifact.findUnique({
      where: { sourceIntentRowId_sourceExecSeq_artifactIndex: { sourceIntentRowId: intentRowId, sourceExecSeq: execSeq, artifactIndex: 0 } },
    });
    const stage = row.status === 'RUNNING'
      ? await tx.media.findFirst({
          where: { sourceIntentRowId: intentRowId, sourceExecSeq: execSeq, status: 'processing', sourceUrl: { not: null } },
          orderBy: { createdAt: 'asc' },
        })
      : null;

    if (row.status === 'SUCCEEDED') {
      // 窗①（settle 后崩溃）：SUCCEEDED∧reserved>0（未核销——finalize 事务原子故此态=旧链/settle
      // 未达核销窗）∧锚行在（产物 PG 在案）→ 补 settle（InTx——锁内原子；幂等 settled:false=零动作）。
      if (row.reservedCredits > 0 && anchor) {
        const r = await this.teamCredit.settleInTx(tx, { intentRowId, execSeq });
        return { action: 'settle-backfill', acted: r.settled };
      }
      // 窗③（投影缺失）：SUCCEEDED∧锚行在∧投影行缺 → 补建 pending 行（T15 poller 前置接线形态）。
      // 窗⑥（T15 质评 Important#1 根治）：当前代投影行 orphaned（poller node-deleted 判定后退款抛错
      // 悬置窗）→ orphaned-refund（调用方 rollbackDeliveryFailed——SUCCEEDED 已核销行不进终态悬留
      // 批〔reserved=0 谓词〕，无此窗则退款永悬且零告警）。
      if (anchor) {
        const proj = await tx.artifactProjection.findUnique({
          where: { artifactId_artifactRev: { artifactId: anchor.id, artifactRev: anchor.rev } },
          select: { state: true },
        });
        if (proj?.state === 'orphaned') return { action: 'orphaned-refund' };
        if (!proj) {
          await tx.artifactProjection.createMany({
            data: [{
              artifactId: anchor.id, artifactRev: anchor.rev, projectId: row.projectId, nodeId: row.nodeId,
              targetField: anchor.targetField, targetItemId: anchor.targetItemId,
              mediaId: anchor.mediaId, resultText: anchor.resultText, state: 'pending',
            }],
            skipDuplicates: true,
          });
          return { action: 'projection-backfill' };
        }
        return { action: 'noop' };
      }
      // SUCCEEDED∧reserved>0∧无锚行∧无 stage=无产物悬留——退款方向判定归调用方（rollbackStranded
      // 判龄 CAS——宁退勿吞；doc 探测判产物已删）。
      if (row.reservedCredits > 0 && !stage) return { action: 'rollback-stranded' };
      return { action: 'noop' };
    }

    if (row.status === 'RUNNING') {
      // 窗②（Media 后崩溃）：stage 行在（provider 成功已 durable 化——image 系 stageImage 落行先于
      // 下载/finalize；video stage 行随 finalize 事务建=RUNNING 窗结构性不可达）→ 锁外重下 finalize
      // （commitImage 同构——provider 不重调）。
      if (stage && stage.sourceUrl) {
        // 评审 Important#1：expectedRev=claim 时持久化的 claimArtifactRev（禁现读 claimCapture——悬留窗
        // 用户 replace/clear 后现读必胜出=旧代产物覆盖用户值，击穿 T10 superseded 不变量）。legacy 行
        // （加列前 stranding）：槽位仍空（rev=0）无用户值可覆盖 ⇒ expectedRev=0 安全；槽位非空则无法重建
        // claim 时 rev ⇒ not-recoverable（宁退勿吞——reaper charge 分支退款，不赌覆盖）。
        let expectedRev = row.claimArtifactRev;
        if (expectedRev === null || expectedRev === undefined) {
          const current = await this.nodeArtifacts.claimCapture(tx, {
            projectId: row.projectId, nodeId: row.nodeId, targetField: targetFieldOfKind(row.kind),
          });
          if (current !== 0) return { action: 'not-recoverable' };
          expectedRev = 0;
        }
        return {
          action: 'finalize-from-stage',
          stage: {
            intentRowId, execSeq: execSeq.toString(), sourceUrl: stage.sourceUrl,
            projectId: row.projectId, nodeId: row.nodeId,
            teamId: row.teamId, userId: row.userId, kind: row.kind, sourceMimeType: stage.mimeType,
            claimArtifactRev: expectedRev,
          },
        };
      }
      return { action: 'not-recoverable' };   // 无 stage（text 无 stage/外呼未达）——reaper 剩余分支（退款/VOID）
    }

    // FAILED/VOIDED：有 artifact（锚行）∨有交付凭据（非 superseded 投影行）→ 交人工（禁动钱）；
    // 否则 void-terminal（调用方锁内 voidInTx 幂等 release——spec「FAILED/VOIDED∧reserved>0∧
    // 无 artifact/无 delivered→voidInTx」+v13b 守卫）。
    if (row.reservedCredits > 0) {
      // T15 收口（T13 登记「manual-required 凭据查询收窄」）：交付凭据=本 intent 资金锚的投影行
      // （artifactId∈NodeArtifact{sourceIntentRowId=本行}）——投影行键=artifactId，无锚行则本 intent
      // 结构性不可能有投影行；旧按 projectId+nodeId 笼统 count 会把他代（在飞/已交付他 intent）投影行
      // 误计为「有交付凭据」⇒ 假 manual-required（钱冻结永悬）。
      const anchoredIds = await tx.nodeArtifact.findMany({
        where: { sourceIntentRowId: intentRowId },
        select: { id: true },
      });
      const deliveredRows = anchoredIds.length > 0
        ? await tx.artifactProjection.count({
            where: { artifactId: { in: anchoredIds.map((a) => a.id) }, state: { in: ['pending', 'projecting', 'projected'] } },
          })
        : 0;
      if (anchor || deliveredRows > 0) {
        return { action: 'manual-required', reason: anchor ? 'FAILED/VOIDED 带 NodeArtifact 锚行（产物在案）' : 'FAILED/VOIDED 带非 superseded 投影行（交付凭据在案）' };
      }
      return { action: 'void-terminal' };
    }
    return { action: 'noop' };
  }

  /** T13 R3 窗②锁外执行面：stage 行重下 finalize（commitImage 同构——幂等预检+ON CONFLICT stage
   *  复用同 mediaId；真 intentRowId+execSeq 驱动——stage 行资金锚复用+intent CAS RUNNING→SUCCEEDED+
   *  settle 同事务）。expectedRev=**claim 时持久化的 claimArtifactRev**（评审 Important#1 根修：禁现读
   *  claimCapture——悬留窗用户 replace/clear 后现读必与当前槽位 rev 匹配 ⇒ casUpsert 胜出=旧代产物
   *  覆盖用户值，击穿 T10「生成在飞 replace→superseded 不覆盖」不变量；持久值失配 ⇒ superseded——
   *  产物照常入素材库+资金独立判照常 settle）。provider 不重调（下载源=stage 行 sourceUrl 唯一事实）。 */
  async finalizeFromStage(stage: {
    intentRowId: string; execSeq: string; sourceUrl: string;
    projectId: string; nodeId: string; teamId: string; userId: string; kind: string; sourceMimeType: string | null;
    claimArtifactRev: number;
  }): Promise<CommitOutcome> {
    return this.commitImage({
      projectId: stage.projectId, nodeId: stage.nodeId, teamId: stage.teamId, userId: stage.userId,
      intentRowId: stage.intentRowId, execSeq: BigInt(stage.execSeq), expectedRev: stage.claimArtifactRev,
      sourceUrl: stage.sourceUrl,
      sourceMimeType: stage.sourceMimeType,
    });
  }

  /** finalize 单事务（短事务目标 <50ms；锁序=契约 20）：ledgerTx→lockBalance(teamId)〔首句〕→
   *  intent FOR UPDATE 重验→幂等检查（CAS 前）→NodeArtifact casUpsert→intent CAS（completeInTx
   *  count===1 唯一凭据）→Media 提升/binding/投影→settleInTx（失败整体回滚）→commit。
   *  死锁/锁等待/池超时族有界重试 3 次+jitter（IntentStaleSignal 非重试面——确定性退役）。 */
  private async finalize(params: FinalizeParams): Promise<CommitOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_JITTER_BASE_MS + Math.floor(Math.random() * RETRY_JITTER_BASE_MS * 2)));
      }
      try {
        return await this.prisma.$transaction((raw) => this.finalizeInTx(raw, params), { timeout: 15_000, maxWait: 5_000 });
      } catch (e) {
        if (e instanceof IntentStaleSignal) {
          // 资金独立判（intent CAS 失败分支）：不 settle、void 旧冻结（幂等 no-op 安全——终态已收敛/
          // 新代冻结锚不匹配均零动作）；产物行已随事务回滚（不静默丢——stage 行在案，R3 可凭
          // processing 行+sourceUrl 复驱收敛）。
          await this.teamCredit.void_({ intentRowId: params.intentRowId, execSeq: params.execSeq })
            .catch((err) => this.logger.warn(`[finalize] 意图 ${params.intentRowId} intent-stale void 旧冻结失败（reconcile 兜底）: ${err}`));
          return { outcome: 'intent-stale' };
        }
        if (!isRetryableFinalizeError(e) || attempt >= FINALIZE_TX_MAX_RETRIES) throw e;
        this.logger.warn(`[finalize] 意图 ${params.intentRowId} 事务可重试错误（第 ${attempt + 1} 次重试）: ${(e as Error)?.message ?? e}`);
      }
    }
    // 不可达：无界 for 的尾次尝试必 return/throw（质评收口 Minor#5——旧 throw lastErr 死代码删除；
    // 有界性由上方 attempt>=FINALIZE_TX_MAX_RETRIES 的 throw 承担）
  }

  private async finalizeInTx(raw: Prisma.TransactionClient, params: FinalizeParams): Promise<CommitOutcome> {
    const tx = await this.ledger.ledgerTx(raw);               // Z89：首句取通行证（lock_timeout 3s+ledger_tx）
    // 质评收口（spec Z18''② 明文）：statement_timeout=5s——慢执行（缺索引扫描/计划劣化）截断，
    // 防 TeamBalance 行锁持有被拖长（ledgerTx 只设 lock_timeout=3s，此处补齐 finalize 域第三参数）
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    await this.ledger.lockBalance(tx, params.teamId);         // 锁序①（契约 20）：先 balance 再碰 intent——ABBA 防线

    // intent FOR UPDATE 重验（行锁持有下读终态/代际——幂等与退役判定的事实基础）
    const rows = await tx.$queryRaw<
      { status: string; execSeq: bigint; creditsConsumed: number; creditCost: number }[]
    >`SELECT "status", "execSeq", "creditsConsumed", "creditCost" FROM "GenerationIntent" WHERE "id" = ${params.intentRowId} FOR UPDATE`;
    if (rows.length !== 1) throw new IntentStaleSignal('行灭失');

    // ── 幂等检查在 CAS 前（v13b 判据=intent 行状态；artifactState 列已删——产物权威=NodeArtifact）：
    //    SUCCEEDED∧已核销∧**同代** ⇒ 本 finalize 曾完整成功——幂等返回+补建缺投影行（零新行零重扣）。
    //    F1 代际守卫：SUCCEEDED 为终态不换代，成功代恒=行 execSeq——旧代（execSeq<N）重复 finalize
    //    不得误判「本 finalize 曾成功」（否则旧代产物冒领 committed 出口）；失配自然落入下行
    //    IntentStaleSignal → outcome 'intent-stale'（外层 void 旧冻结=已核销行幂等 no-op，零副作用）。 ──
    if (rows[0].status === 'SUCCEEDED' && rows[0].execSeq === params.execSeq && rows[0].creditsConsumed === rows[0].creditCost) {
      const existing = await tx.nodeArtifact.findUnique({
        where: { sourceIntentRowId_sourceExecSeq_artifactIndex: { sourceIntentRowId: params.intentRowId, sourceExecSeq: params.execSeq, artifactIndex: params.artifactIndex } },
      });
      if (existing) {
        await tx.artifactProjection.createMany({
          data: [{
            artifactId: existing.id, artifactRev: existing.rev, projectId: params.projectId, nodeId: params.nodeId,
            targetField: targetFieldOfKind(params.kind), targetItemId: '',
            mediaId: existing.mediaId, resultText: existing.resultText, state: 'pending',
          }],
          skipDuplicates: true,   // [artifactId,artifactRev] 唯一
        });
        // Important#1：mediaId/key 回填（image 系消费方非空断言依据）——key 自锚定 Media 行
        const mediaRow = existing.mediaId
          ? await tx.media.findUnique({ where: { id: existing.mediaId }, select: { key: true } })
          : null;
        return { outcome: 'committed', mediaId: existing.mediaId ?? undefined, key: mediaRow?.key ?? undefined };
      }
      // 产物行已被 replace 改锚（T11）——幂等短路不动槽位；本轮产物描述符就在作用域——回填 mediaId/key
      //（质评复审 Important 残留：否则三消费方 mediaId!/key! 落 undefined，违反头注「committed 必携」
      // 不变量；image=本轮 stage/上传描述符，video=资金锚 Media 行回填〔行在——registerInTx 复用锚〕，
      // text 不传 media 自然 undefined）。
      if (params.kind === 'video') {
        const anchored = await tx.media.findFirst({
          where: { sourceIntentRowId: params.intentRowId, sourceExecSeq: params.execSeq, artifactIndex: params.artifactIndex },
          orderBy: { createdAt: 'asc' },
        });
        return { outcome: 'committed', mediaId: anchored?.id, key: anchored?.key };
      }
      return { outcome: 'committed', mediaId: params.media?.mediaId, key: params.media?.key };
    }
    if (rows[0].status !== 'RUNNING' || rows[0].execSeq !== params.execSeq) {
      throw new IntentStaleSignal(`行终态(${rows[0].status})/换代`);
    }

    // ── T12 video：finalize 事务内建行（㉔-3 建行不 stage 字节）——registerInTx（ON CONFLICT 资金锚
    //    复用幂等）落 Media(processing)+sourceUrl 专用列+预分配 base key+同事务 processing fact；
    //    materialize 由 MaterializeJob 按 mediaId 异步接管（自有 lease/attempts——与 intent 解耦）。 ──
    let videoMedia: Media | null = null;
    if (params.kind === 'video') {
      const v = params.video!;
      videoMedia = await this.registration.registerInTx(tx, {
        userId: params.userId, teamId: params.teamId, projectId: params.projectId, nodeId: params.nodeId,
        key: artifactObjectKeyBase(params.teamId, params.intentRowId, params.execSeq, params.artifactIndex),
        sourceUrl: v.sourceUrl,
        sourceUrlExpiresAt: v.sourceUrlExpiresAt ?? new Date(Date.now() + ARTIFACT_SOURCE_URL_TTL_MS),
        mimeType: v.sourceMimeType ?? 'video/mp4',
        originalName: `ai-${params.nodeId}.mp4`,
        sourceIntentRowId: params.intentRowId, sourceExecSeq: params.execSeq, artifactIndex: params.artifactIndex,
      });
    }
    const artifactMediaId = params.media?.mediaId ?? videoMedia?.id ?? null;

    // ── NodeArtifact CAS（0 行=superseded：生成在飞用户 replace/新代——不更新不投影槽位；
    //    video 胜者态=materializing〔㉔-2〕——materialize 成功升 stored/终态失败 failed 归 MaterializeJob） ──
    const cas = await this.nodeArtifacts.casUpsert(tx, {
      projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId,
      targetField: targetFieldOfKind(params.kind),
      expectedRev: params.expectedRev, source: 'generated',
      state: params.kind === 'video' ? 'materializing' : 'stored',
      mediaId: artifactMediaId, resultText: params.resultText ?? null,
      sourceIntentRowId: params.intentRowId, sourceExecSeq: params.execSeq, artifactIndex: params.artifactIndex,
    });

    // ── intent CAS（RUNNING∧execSeq→SUCCEEDED；count===1 唯一凭据——失败即整体回滚+外层 void）。
    //    resultRef：image=mediaId、text=占位、video=mediaId（video 产物锚=mediaId——T12 起 doc 交付键
    //    唯一 fileId，旧链 resultRef=URL 退役）。 ──
    const gated = await this.intents.completeInTx(
      tx, params.intentRowId,
      videoMedia ? videoMedia.id : params.resultRef,
      params.execSeq,
    );
    if (gated !== 1) throw new IntentStaleSignal('intent CAS 0 命中');

    if (cas.won) {
      if (params.media) {
        // Media 状态提升（processing→completed 补 key/sha/size/sniff）+binding current-state upsert
        await this.registration.completeRegisteredInTx(tx, params.media);
      }
      if (params.media || videoMedia) {
        const boundId = artifactMediaId!;
        await this.registration.bindInTx(tx, {
          mediaId: boundId, projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId,
          role: 'primary', targetField: targetFieldOfKind(params.kind), targetItemId: '',
        });
      }
      // video 不提升 Media（processing 维持——materialize 异步物化；superseded 亦然：产物入素材库，
      // MaterializeJob 按 claim 条件〔status=processing∧video mime〕照常接管）。
      await tx.artifactProjection.createMany({
        data: [{
          artifactId: cas.artifactId, artifactRev: cas.rev, projectId: params.projectId, nodeId: params.nodeId,
          targetField: targetFieldOfKind(params.kind), targetItemId: '',
          mediaId: artifactMediaId, resultText: params.resultText ?? null, state: 'pending',
        }],
        skipDuplicates: true,
      });
    } else {
      // superseded：不更新不投影槽位——投影行记 superseded（槽位当前 rev 锚，T15 poller 终态免投）。
      // 产物照常入素材库（资金独立判：provider 成功∧intent CAS 成功——Media 状态提升保留〔image〕/
      // processing 维持〔video——materialize 照常物化〕，用户从素材库取；禁「CAS 失败静默丢产物」）。
      if (params.media) await this.registration.completeRegisteredInTx(tx, params.media);
      await tx.artifactProjection.createMany({
        data: [{
          artifactId: cas.artifactId, artifactRev: cas.rev, projectId: params.projectId, nodeId: params.nodeId,
          targetField: targetFieldOfKind(params.kind), targetItemId: '', state: 'superseded',
        }],
        skipDuplicates: true,
      });
      this.logger.warn(`[finalize] 意图 ${params.intentRowId} NodeArtifact CAS 0 行（槽位 rev=${cas.rev}≠期望 ${params.expectedRev}）——superseded：产物入素材库（Media 保留）+settle 走资金独立判（核销凭据不成立仍会被硬门整体回滚）`);
    }

    // ── settle（资金独立判：provider 成功∧intent CAS 成功 ⇒ 照常核销——superseded 亦然；
    //    失败（throw）整体回滚——产物/intent 终态/settle 原子）。
    //    F1 资金硬门（核销凭据校验）：付费档 settled:false 三形态须分诊——b) 已核销幂等
    //    （锚已清空：settle 完成即原子写 reservedCredits=0∧consumed=cost∧reservedExecSeq=null，
    //    票对 null 锚≠必在 settleInTx 代际前置守卫 0 命中返 settled:false——anti-join 补写分支需
    //    锚=票同代，在 finalize 路径结构性不可达）为合法凭据放行；
    //    a) 冻结锚与行代际不一致 / c) 冻结灭失（付费无冻结且从未消耗）=资金不变量破缺——禁
    //    「warn 后照常交付」。intent FOR UPDATE 行锁本事务已持有，普通 SELECT 复读即锁内事实：
    //    凭据成立当且仅当「reservedCredits===0 ∧ creditsConsumed===creditCost ∧ 锚 null 或同代」
    //    （钱恰扣一次、零冻结、锚同代）；不成立即抛 FundsInvariantError——本事务已落的一切全撤
    //    （intent 终态/NodeArtifact/投影/Media/binding，superseded 分支同门：资金独立判的前提是
    //    核销凭据成立），行留 RUNNING 交对账第四分支裁决。零额档 creditCost=0 无 reserve 属正常
    //    settled:false，不进门。 ──
    const settled = await this.teamCredit.settleInTx(tx, { intentRowId: params.intentRowId, execSeq: params.execSeq });
    if (!settled.settled && rows[0].creditCost > 0) {
      const re = await tx.$queryRaw<
        { reservedCredits: number; creditsConsumed: number; reservedExecSeq: bigint | null }[]
      >`SELECT "reservedCredits", "creditsConsumed", "reservedExecSeq" FROM "GenerationIntent" WHERE "id" = ${params.intentRowId}`;
      const credentialOk = re.length === 1
        && re[0].reservedCredits === 0
        && re[0].creditsConsumed === rows[0].creditCost
        && (re[0].reservedExecSeq === null || re[0].reservedExecSeq === params.execSeq);
      if (!credentialOk) {
        this.logger.error(
          `[finalize] 意图 ${params.intentRowId} 资金不变量破缺（付费 settle 未达核销且核销凭据不成立——finalize 整体回滚交对账）: ` +
          `execSeq=${params.execSeq} creditCost=${rows[0].creditCost} ` +
          `reservedCredits=${re[0]?.reservedCredits} creditsConsumed=${re[0]?.creditsConsumed} reservedExecSeq=${re[0]?.reservedExecSeq ?? null}`,
        );
        throw new FundsInvariantError({
          intentRowId: params.intentRowId, execSeq: params.execSeq, creditCost: rows[0].creditCost,
          reservedCredits: re[0]?.reservedCredits ?? -1, creditsConsumed: re[0]?.creditsConsumed ?? -1,
          reservedExecSeq: re[0]?.reservedExecSeq ?? null,
        });
      }
      this.logger.warn(`[finalize] 意图 ${params.intentRowId} settle settled:false 但核销凭据成立（锚已清空=此前 settle 已完成——代际前置守卫 0 命中幂等）——放行`);
    }

    return {
      outcome: cas.won ? 'committed' : 'superseded',
      mediaId: params.media?.mediaId ?? videoMedia?.id,
      key: params.media?.key ?? videoMedia?.key,   // video=key 预分配 base（content-addressed 后缀归 materialize）
    };
  }
}
