// apps/api/src/modules/artifact-core/artifact-commit.service.ts —— Y1a+Y1b T10（spec Z18''-v14 ②③④⑥⑦）：
// ArtifactCommitService=资金路径（text/image/edit/lighting；video=T12 kind 分支另补）唯一 finalize
// 编排器——image 同步链（stageInTx 短事务 durable 化→SafeRemoteFetch 下载→服务端自算 sha256+sniff
// →MinIO content-addressed key 上传→finalize 单事务）；finalize 事务序列（锁序契约 20：先 lockBalance
// 再碰 intent——ABBA 死锁防线；幂等检查在 CAS 前；NodeArtifact casUpsert→intent CAS→settleInTx
// 失败整体回滚；40P01/40001/55P03/P2024 有界重试+jitter）。
//
// 资金独立判（NodeArtifact CAS 0 行=superseded 时）：intent CAS 成功∧provider 成功→照常 settle、
// 产物入素材库（Media 行保留——用户从素材库取）；intent CAS 失败（新代接管/终态）→不 settle、
// void 旧冻结。禁「CAS 失败静默丢产物」与「无条件退款」两错分支。
//
// kind 分支（v13b）：text=跳过 Media（NodeArtifact resultText/state=stored）；image/edit/lighting=
// stage 行 finalize 提升 completed；video=T12（本卡零动作）。
// 资金 quota=软限：finalize 不因 quota 回滚（钱已付 provider）；registerInTx 禁调 assertOnConfirm
// +事务内禁外部 IO（下载/上传全在 finalize 事务之前）。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
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

/** finalize 三态出口（调用方据此分派 doc 交付：superseded=不覆盖用户值；intent-stale=零交付）。 */
export interface CommitOutcome {
  outcome: 'committed' | 'superseded' | 'intent-stale';
  mediaId?: string;
  /** MinIO 对象键（lighting 任务回填 presigned 结果 URL 消费）。 */
  key?: string;
}

interface FinalizeParams {
  projectId: string;
  nodeId: string;
  teamId: string;
  userId: string;
  intentRowId: string;
  execSeq: bigint;
  expectedRev: number;
  kind: string;
  /** intent.resultRef 写入值（image=mediaId；text=`text:` 截断占位——既有语义）。 */
  resultRef: string;
  /** image 系：stage 行提升描述符（text 不传=跳过 Media）。 */
  media?: { mediaId: string; projectId: string; key: string; sha256: string; mimeType: string; sniffedMimeType: string | null; size: number };
  resultText?: string;
  artifactIndex: number;
}

/** finalize 事务内 intent CAS 失败信号——throw 即整体回滚（NodeArtifact/binding/投影/Media 提升全撤），
 *  外层捕获后独立 void 旧冻结（资金独立判 intent-CAS-失败分支）。 */
class IntentStaleSignal extends Error {
  constructor(reason: string) { super(`INTENT_FINALIZE_STALE: ${reason}`); }
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

  /** image 同步链（image/edit/lighting 共用——T10 集成面）：stage durable→下载→sha/sniff→上传
   *  content-addressed key→finalize 单事务。下载/上传全在 finalize 事务之外（事务内禁外部 IO）。 */
  async commitImage(params: CommitImageParams): Promise<CommitOutcome> {
    const artifactIndex = params.artifactIndex ?? 0;
    const stage = await this.stageImage(params);
    const fetched = await this.safeFetch.fetchBuffer(params.sourceUrl);
    const sha256 = createHash('sha256').update(fetched.buffer).digest('hex');
    const sniffed = await sniffMimeType(fetched.buffer.subarray(0, 4100));
    const mimeType = sniffed ?? fetched.contentType ?? params.sourceMimeType ?? 'application/octet-stream';
    const key = `${stage.keyBase}-${sha256}`;
    await this.minio.upload(key, fetched.buffer, mimeType);
    return this.finalize({
      projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId, userId: params.userId,
      intentRowId: params.intentRowId, execSeq: params.execSeq, expectedRev: params.expectedRev,
      kind: 'image', resultRef: stage.mediaId, artifactIndex,
      media: {
        mediaId: stage.mediaId, projectId: params.projectId, key, sha256,
        mimeType, sniffedMimeType: sniffed, size: fetched.buffer.length,
      },
    });
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

  /** finalize 单事务（短事务目标 <50ms；锁序=契约 20）：ledgerTx→lockBalance(teamId)〔首句〕→
   *  intent FOR UPDATE 重验→幂等检查（CAS 前）→NodeArtifact casUpsert→intent CAS（completeInTx
   *  count===1 唯一凭据）→Media 提升/binding/投影→settleInTx（失败整体回滚）→commit。
   *  死锁/锁等待/池超时族有界重试 3 次+jitter（IntentStaleSignal 非重试面——确定性退役）。 */
  private async finalize(params: FinalizeParams): Promise<CommitOutcome> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= FINALIZE_TX_MAX_RETRIES; attempt += 1) {
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
        if (!isRetryableFinalizeError(e) || attempt === FINALIZE_TX_MAX_RETRIES) throw e;
        lastErr = e;
        this.logger.warn(`[finalize] 意图 ${params.intentRowId} 事务可重试错误（第 ${attempt + 1} 次重试）: ${(e as Error)?.message ?? e}`);
      }
    }
    throw lastErr;
  }

  private async finalizeInTx(raw: Prisma.TransactionClient, params: FinalizeParams): Promise<CommitOutcome> {
    const tx = await this.ledger.ledgerTx(raw);               // Z89：首句取通行证（lock_timeout 3s+ledger_tx）
    await this.ledger.lockBalance(tx, params.teamId);         // 锁序①（契约 20）：先 balance 再碰 intent——ABBA 防线

    // intent FOR UPDATE 重验（行锁持有下读终态/代际——幂等与退役判定的事实基础）
    const rows = await tx.$queryRaw<
      { status: string; execSeq: bigint; creditsConsumed: number; creditCost: number }[]
    >`SELECT "status", "execSeq", "creditsConsumed", "creditCost" FROM "GenerationIntent" WHERE "id" = ${params.intentRowId} FOR UPDATE`;
    if (rows.length !== 1) throw new IntentStaleSignal('行灭失');

    // ── 幂等检查在 CAS 前（v13b 判据=intent 行状态；artifactState 列已删——产物权威=NodeArtifact）：
    //    SUCCEEDED∧已核销 ⇒ 本 finalize 曾完整成功——幂等返回+补建缺投影行（零新行零重扣）。 ──
    if (rows[0].status === 'SUCCEEDED' && rows[0].creditsConsumed === rows[0].creditCost) {
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
        return { outcome: 'committed', mediaId: existing.mediaId ?? undefined };
      }
      return { outcome: 'committed' };   // 产物行已被 replace 改锚（T11）——幂等短路不动槽位
    }
    if (rows[0].status !== 'RUNNING' || rows[0].execSeq !== params.execSeq) {
      throw new IntentStaleSignal(`行终态(${rows[0].status})/换代`);
    }

    // ── NodeArtifact CAS（0 行=superseded：生成在飞用户 replace/新代——不更新不投影槽位） ──
    const cas = await this.nodeArtifacts.casUpsert(tx, {
      projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId,
      targetField: targetFieldOfKind(params.kind),
      expectedRev: params.expectedRev, source: 'generated', state: 'stored',
      mediaId: params.media?.mediaId ?? null, resultText: params.resultText ?? null,
      sourceIntentRowId: params.intentRowId, sourceExecSeq: params.execSeq, artifactIndex: params.artifactIndex,
    });

    // ── intent CAS（RUNNING∧execSeq→SUCCEEDED；count===1 唯一凭据——失败即整体回滚+外层 void） ──
    const gated = await this.intents.completeInTx(tx, params.intentRowId, params.resultRef, params.execSeq);
    if (gated !== 1) throw new IntentStaleSignal('intent CAS 0 命中');

    if (cas.won) {
      if (params.media) {
        // Media 状态提升（processing→completed 补 key/sha/size/sniff）+binding current-state upsert
        await this.registration.completeRegisteredInTx(tx, params.media);
        await this.registration.bindInTx(tx, {
          mediaId: params.media.mediaId, projectId: params.projectId, nodeId: params.nodeId, teamId: params.teamId,
          role: 'primary', targetField: targetFieldOfKind(params.kind), targetItemId: '',
        });
      }
      await tx.artifactProjection.createMany({
        data: [{
          artifactId: cas.artifactId, artifactRev: cas.rev, projectId: params.projectId, nodeId: params.nodeId,
          targetField: targetFieldOfKind(params.kind), targetItemId: '',
          mediaId: params.media?.mediaId ?? null, resultText: params.resultText ?? null, state: 'pending',
        }],
        skipDuplicates: true,
      });
    } else {
      // superseded：不更新不投影槽位——投影行记 superseded（槽位当前 rev 锚，T15 poller 终态免投）。
      // 产物照常入素材库（资金独立判：provider 成功∧intent CAS 成功——Media 状态提升保留，用户从
      // 素材库取；禁「CAS 失败静默丢产物」）。
      if (params.media) await this.registration.completeRegisteredInTx(tx, params.media);
      await tx.artifactProjection.createMany({
        data: [{
          artifactId: cas.artifactId, artifactRev: cas.rev, projectId: params.projectId, nodeId: params.nodeId,
          targetField: targetFieldOfKind(params.kind), targetItemId: '', state: 'superseded',
        }],
        skipDuplicates: true,
      });
      this.logger.warn(`[finalize] 意图 ${params.intentRowId} NodeArtifact CAS 0 行（槽位 rev=${cas.rev}≠期望 ${params.expectedRev}）——superseded：产物入素材库（Media 保留）+照常 settle（资金独立判）`);
    }

    // ── settle（资金独立判：provider 成功∧intent CAS 成功 ⇒ 照常核销——superseded 亦然；
    //    失败（throw）整体回滚——产物/intent 终态/settle 原子）。 ──
    await this.teamCredit.settleInTx(tx, { intentRowId: params.intentRowId, execSeq: params.execSeq });

    return { outcome: cas.won ? 'committed' : 'superseded', mediaId: params.media?.mediaId, key: params.media?.key };
  }
}
