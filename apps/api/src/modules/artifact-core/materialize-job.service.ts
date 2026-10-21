// apps/api/src/modules/artifact-core/materialize-job.service.ts —— Y1a+Y1b T12 核心二
// （spec Z18''-v14 video materialize 异步；裁决①/⑮/㉔-2；§3.1 伪码「ai-download:100→MaterializeJob
// 接管〔video〕」）：worker 进程 DB poller（MediaProcessing(processing∧video) 行即队列——幂等键=
// mediaId；无 BullMQ 依赖〔ai-result-download 队列随本卡整体退役〕）。
// 形态对齐 MediaProbePoller（两段式事务 claim：FOR UPDATE SKIP LOCKED→置 lease；R28 纪律：原生
// setInterval+unref）。claim 条件=status='processing'∧type='generated'∧mimeType video 族
// （image stage 短命行天然排除）∧nextMaterializeAt 到期/NULL∧lease 过期/NULL——@@index([status,
// nextMaterializeAt])（T2 materialize claim 索引）。
// 物化链（全事务外）：SafeRemoteFetch 下载（SSRF 四门+限长+ MATERIALIZE_FETCH_TIMEOUT_MS）→sniff
// （非视频字节=mismatch permanent）→ffprobe natural（**复用同一次下载**——spec :45 P1 免 probe 二次
// 下载 1GB；probe 仅上传路径）→sha256+content-addressed key `{预分配base}-{sha}`→MinIO 上传。
// 完成单事务：status CAS processing→completed+key/size/sha/sniff/mimeType+natural 族+probeState=done
// +factVersion+1+outbox（state completed+natural 双 fact 同版本——S0.1 四元组唯一互不撞）
// +NodeArtifact materializing→stored（资金锚 CAS——replace 改锚后 miss=产物仍入库槽位归 replace）。
// 失败面（自有 processingLeaseUntil/processingAttempts/nextMaterializeAt 退避——与 intent
// attempts/rearm 彻底解耦：存储抖动不污染资金/交付状态机）：瞬态→attempts+1+nextMaterializeAt
// jitter 指数退避（源过期 410/网络/超限同面——重试直至耗尽）；终态（mismatch permanent∨attempts≥
// MATERIALIZE_MAX_ATTEMPTS）→幂等补偿退款（rollbackDeliveryFailed——team-credit rollback 族唯一
// 入口，重跑恰一次）+单事务 Media failed+failed fact+NodeArtifact materializing→failed（不清
// mediaId——UI 失败/重试非撤回交付）+errorCode=MATERIALIZE_FAILED（emit WS 推送——materialize
// 不写 doc 硬约束）+Sentry 告警。
// 退款先行序（先 rollback 后置 failed）：反序崩溃窗=「failed 行无人重扫」的死退款面；此序崩溃窗=
// processing 行重 claim 自愈（退款 no-op→置 failed）；极端边缘=退款后重试成功〔用户免费得字节〕
// ——资损方向正确侧（宁可免费字节不可吞钱）。
// quota=软限（v10 裁决④）：完成不因 quota 回滚/删产物/退款（钱已付 provider）——超限仅观测
// （assertCanUpload(teamId,0) 借谓词：usage+0>limit 即抛）+计数+告警。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma, Media } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Counter, register } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { sniffMimeType } from '../media/sniff';
import { TeamCreditService } from '../team/team-credit.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { EmitPort } from '../gateway/emit.port';
// ffprobe 单源（T7 沙箱本体——census ㉒ 纪律禁第二份字面量；buildFfprobeArgs/FFPROBE_TIMEOUT_MS 复用）
import { buildFfprobeArgs, FFPROBE_TIMEOUT_MS } from '../media/media-probe.poller';
import { ffprobePath } from '../media-process/media-process.service';

// ── poller/claim 参数（对齐 probe 分型批纪律：视频大对象批 1 串行） ──
export const MATERIALIZE_POLL_INTERVAL_MS = 10_000;
export const MATERIALIZE_BATCH = 1;
/** lease=下载 8min+ffprobe 15s+上传/收尾余量（1GB 级视频单行串行）。 */
export const MATERIALIZE_LEASE_MS = 10 * 60_000;
export const MATERIALIZE_FETCH_TIMEOUT_MS = 8 * 60_000;
/** 瞬态失败重试上界（源过期/网络族——耗尽即终态：幂等补偿退款+failed）。 */
export const MATERIALIZE_MAX_ATTEMPTS = 5;
/** 退避基数 30s×2^(n-1) 封顶 1h，抖幅 ×[0.5,1.5]（probe 同族参数——热循环红线：非立即重投）。 */
const MATERIALIZE_BACKOFF_BASE_MS = 30_000;
const MATERIALIZE_BACKOFF_MAX_MS = 3_600_000;

export function computeMaterializeBackoffMs(attempts: number): number {
  const base = Math.min(MATERIALIZE_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), MATERIALIZE_BACKOFF_MAX_MS);
  return Math.round(base * (0.5 + Math.random()));
}

/** 失败 kind 词表（metric label/落 reason 单源）：mismatch=permanent（字节非视频——重试不可救）；
 *  download/ffprobe/upload/internal=transient（重试至 attempts 耗尽）。 */
export type MaterializeFailureKind = 'download' | 'mismatch' | 'ffprobe' | 'upload' | 'internal';

class MaterializeFailure extends Error {
  constructor(
    readonly kind: MaterializeFailureKind,
    readonly permanent: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** 观测（spec §5 观测纪律对齐 probe 族）。 */
const materializeDoneTotal = new Counter({
  name: 'materialize_done_total',
  help: 'Y1b T12：video materialize 完成计数（content-addressed 落库+artifactState stored）',
  registers: [register],
});
const materializeFailTotal = new Counter({
  name: 'materialize_fail_total',
  help: 'Y1b T12：materialize 失败分类计数（failure_kind=mismatch=permanent；terminal=true 即已走补偿退款）',
  labelNames: ['failure_kind', 'terminal'],
  registers: [register],
});
const materializeRefundTotal = new Counter({
  name: 'materialize_refund_total',
  help: 'Y1b T12：materialize 终态失败幂等补偿退款命中计数（rollbackDeliveryFailed CAS 命中侧）',
  registers: [register],
});
const materializeQuotaSoftExceededTotal = new Counter({
  name: 'materialize_quota_soft_exceeded_total',
  help: 'Y1b T12：materialize 完成后团队存储超软限计数（quota 软限——不删产物不退款，仅告警观测）',
  registers: [register],
});

@Injectable()
export class MaterializeJob implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaterializeJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(SafeRemoteFetchService) private readonly safeFetch: SafeRemoteFetchService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    @Inject(EmitPort) private readonly emit: EmitPort,
  ) {}

  onModuleInit(): void {
    const t = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`materialize tick: ${e}`));
    }, MATERIALIZE_POLL_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 一轮：claim 批（视频批 1）逐行物化；busy 防重入（长视频不叠轮——probe 同款）。 */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const row of await this.claim()) await this.materializeRow(row);
    } finally {
      this.busy = false;
    }
  }

  /** 两段式事务 claim（probe claim 同形态）：SELECT FOR UPDATE SKIP LOCKED（并发双 claim 恰一）
   *  →同事务置 processingLeaseUntil+清 nextMaterializeAt（行锁保持至 commit）。
   *  mimeType 路由=provider 声明列（processing 期 sniffed 恒 NULL）——image stage 短命行天然排除。 */
  async claim(): Promise<Media[]> {
    const leaseUntil = new Date(Date.now() + MATERIALIZE_LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      // 时区纪律（probe claim 头注）：Prisma 模型 API 写 naive=UTC 墙钟，裸比 now() 会用会话 TZ
      //（Asia/Shanghai=+8h）恒判已过期——一律 (now() AT TIME ZONE 'utc') 对齐。
      const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Media"
        WHERE "status" = 'processing' AND "deletedAt" IS NULL
          AND "type" = 'generated' AND "mimeType" LIKE 'video/%'
          AND ("nextMaterializeAt" IS NULL OR "nextMaterializeAt" <= (now() AT TIME ZONE 'utc'))
          AND ("processingLeaseUntil" IS NULL OR "processingLeaseUntil" < (now() AT TIME ZONE 'utc'))
        ORDER BY "nextMaterializeAt" NULLS FIRST, "createdAt" ASC
        LIMIT ${MATERIALIZE_BATCH}
        FOR UPDATE SKIP LOCKED`);
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      await tx.media.updateMany({
        where: { id: { in: ids } },
        data: { processingLeaseUntil: leaseUntil, nextMaterializeAt: null },
      });
      return tx.media.findMany({ where: { id: { in: ids } } });
    });
  }

  /** 单行物化。返回：completed（本代完成）/fenced（行已非 processing——他方完成/终态/复驱：幂等零
   *  动作零 IO）/retry-scheduled（瞬态退避）/terminal（终态失败——已补偿退款+failed）。
   *  幂等键=mediaId：claim 条件（status=processing）+完成/终态 CAS（status='processing' 守卫）
   *  双闸——kill 后重跑不重复下载/不重复 Media。 */
  async materializeRow(row: Media): Promise<'completed' | 'fenced' | 'retry-scheduled' | 'terminal'> {
    if (row.status !== 'processing') return 'fenced';   // 已终态/复驱——零 IO 幂等早退
    try {
      const r = await this.materializeBytes(row);       // 下载+sniff+ffprobe+上传（全事务外）
      const done = await this.completeMaterialized(row, r);
      if (done) {
        materializeDoneTotal.inc();
        await this.observeQuota(row);
        return 'completed';
      }
      return 'fenced';   // status CAS 0 命中=并发他方已完成（content-addressed 同对象——零动作）
    } catch (e) {
      const failure = e instanceof MaterializeFailure
        ? e
        : new MaterializeFailure('internal', false, e instanceof Error ? e.message : String(e));
      return this.fail(row, failure);
    }
  }

  /** 物化字节链（事务外——v10.1-②：外部 IO 在 orchestrator 层）：下载→sniff（非视频=mismatch
   *  permanent）→ffprobe natural（复用同一次下载）→sha256+content-addressed key→MinIO 上传。 */
  private async materializeBytes(row: Media): Promise<CompleteMaterializedParams> {
    if (!row.sourceUrl) {
      throw new MaterializeFailure('internal', true, '行缺 sourceUrl（video finalize 建行必落——数据缺陷）');
    }
    let fetched: { buffer: Buffer; contentType: string | null };
    try {
      fetched = await this.safeFetch.fetchBuffer(row.sourceUrl, MATERIALIZE_FETCH_TIMEOUT_MS);
    } catch (e) {
      // 源过期 410/网络/超限同面——瞬态重试至 attempts 耗尽（spec Z18''⑥「源过期→重试 materialize→超限 refund」）
      throw new MaterializeFailure('download', false, `下载失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    const sniffed = await sniffMimeType(fetched.buffer.subarray(0, 4100));
    if (sniffed && !sniffed.startsWith('video/')) {
      // provider 声明 video 但字节 sniff 非视频（错误页/HTML 200 等）——重试不可救：permanent
      throw new MaterializeFailure('mismatch', true, `provider 声明 ${row.mimeType} 但内容 sniff=${sniffed}（非视频字节）`);
    }
    const mimeType = sniffed ?? fetched.contentType ?? row.mimeType ?? 'video/mp4';
    const natural = await this.probeNatural(fetched.buffer);   // 复用同一次下载（spec :45 P1）
    const sha256 = createHash('sha256').update(fetched.buffer).digest('hex');
    const key = `${row.key}-${sha256}`;                        // 预分配 base+content-addressed 后缀（image 系同构）
    try {
      await this.minio.upload(key, fetched.buffer, mimeType);
    } catch (e) {
      throw new MaterializeFailure('upload', false, `对象上传失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    return {
      key, sha256, mimeType, sniffedMimeType: sniffed, size: BigInt(fetched.buffer.length),
      naturalWidth: natural.naturalWidth, naturalHeight: natural.naturalHeight,
      naturalRotation: natural.naturalRotation, metadata: natural.metadata,
    };
  }

  /** ffprobe natural（T7 poller 同款沙箱：spawn 数组+白名单+15s SIGKILL；mismatch=permanent/
   *  timeout/启动失败=transient）——临时文件复用下载字节，finally 清理。 */
  private async probeNatural(buffer: Buffer): Promise<{
    naturalWidth: number; naturalHeight: number; naturalRotation: number | null; metadata?: Record<string, unknown>;
  }> {
    const dir = await mkdtemp(join(tmpdir(), 'materialize-'));
    try {
      const inputPath = join(dir, 'input.mp4');
      await writeFile(inputPath, buffer);
      const stdout = await this.runFfprobe(inputPath);
      let info: FfprobeJson;
      try {
        info = JSON.parse(stdout) as FfprobeJson;
      } catch {
        throw new MaterializeFailure('mismatch', true, 'ffprobe 输出不可解析');
      }
      const video = info.streams?.find((s) => s.codec_type === 'video');
      if (!video?.width || !video?.height) {
        throw new MaterializeFailure('mismatch', true, '无视频流（内容非可解码视频）');
      }
      let rotation = 0;
      for (const sd of video.side_data_list ?? []) {
        if (typeof sd.rotation === 'number') rotation += sd.rotation;
      }
      const swap = Math.abs(rotation) % 180 === 90;   // displaymatrix 90° 系→display 交换（poller 同语义）
      const metadata: Record<string, unknown> = {};
      const duration = parseFloat(info.format?.duration ?? '');
      if (Number.isFinite(duration)) metadata.duration = duration;
      const bitrate = parseInt(info.format?.bit_rate ?? '', 10);
      if (Number.isFinite(bitrate)) metadata.bitrate = bitrate;
      if (video.codec_name) metadata.videoCodec = video.codec_name;
      const audio = info.streams?.find((s) => s.codec_type === 'audio');
      if (audio?.codec_name) metadata.audioCodec = audio.codec_name;
      return {
        naturalWidth: swap ? video.height : video.width,
        naturalHeight: swap ? video.width : video.height,
        naturalRotation: rotation !== 0 ? Math.round(((rotation % 360) + 360) % 360) : null,
        metadata,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runFfprobe(inputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffprobePath(), buildFfprobeArgs(inputPath), { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new MaterializeFailure('ffprobe', false, `ffprobe timeout (${FFPROBE_TIMEOUT_MS}ms)`));
      }, FFPROBE_TIMEOUT_MS);
      proc.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
      proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new MaterializeFailure('mismatch', true, `ffprobe 退出码 ${code}: ${stderr.slice(-200)}`));
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new MaterializeFailure('ffprobe', false, `ffprobe 启动失败: ${err.message}`));
      });
    });
  }

  /** 完成单事务（spec :91：单事务 status=completed+size+sniffedMimeType+复用下载算 natural+
   *  factVersion/outbox；成功→artifactState=stored）。返回 false=并发他方已完成（status CAS
   *  0 命中——幂等零动作：content-addressed 同对象）。 */
  private async completeMaterialized(row: Media, r: CompleteMaterializedParams): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: row.id, status: 'processing' },   // 幂等 CAS 守卫
        data: {
          status: 'completed',
          key: r.key,
          objectSha256: r.sha256,
          size: r.size,
          mimeType: r.mimeType,
          sniffedMimeType: r.sniffedMimeType ?? null,
          probeState: 'done',                           // 复用同一次下载已算 natural——免 probe 入池（probe 仅上传路径）
          naturalWidth: r.naturalWidth,
          naturalHeight: r.naturalHeight,
          naturalRotation: r.naturalRotation,
          naturalSource: 'materialize',
          ...(r.metadata && Object.keys(r.metadata).length > 0 ? { metadata: r.metadata as Prisma.InputJsonValue } : {}),
          processingLeaseUntil: null,
          nextMaterializeAt: null,
          factVersion: { increment: 1 },
        },
      });
      if (count !== 1) return false;
      // NodeArtifact materializing→stored（资金锚 CAS：replace 改锚后 miss=产物照常入库，槽位归 replace）
      if (row.sourceIntentRowId) {
        await tx.nodeArtifact.updateMany({
          where: {
            sourceIntentRowId: row.sourceIntentRowId,
            sourceExecSeq: row.sourceExecSeq,
            artifactIndex: row.artifactIndex,
            state: 'materializing',
          },
          data: { state: 'stored' },
        });
      }
      // fact outbox：state completed+natural 双 fact 同 factVersion（S0.1 四元组唯一互不撞）；
      // 来源=union(Media.projectId, binding.projectId)——doneNatural 同语义。
      const media = await tx.media.findUniqueOrThrow({ where: { id: row.id }, select: { factVersion: true, projectId: true } });
      const bindings = await tx.mediaBinding.findMany({ where: { mediaId: row.id }, select: { projectId: true } });
      const projects = new Set<string>([media.projectId, ...bindings.map((b) => b.projectId)].filter((p): p is string => !!p));
      if (projects.size > 0) {
        await tx.mediaFactOutbox.createMany({
          data: [...projects].flatMap((projectId) => [
            {
              mediaId: row.id, projectId, factVersion: media.factVersion,
              factType: 'state', payload: { status: 'completed' },
            },
            {
              mediaId: row.id, projectId, factVersion: media.factVersion,
              factType: 'natural',
              payload: {
                naturalWidth: r.naturalWidth, naturalHeight: r.naturalHeight,
                naturalRotation: r.naturalRotation, source: 'materialize',
              },
            },
          ]),
          skipDuplicates: true,   // [mediaId,projectId,factType,factVersion] 四元组唯一（S0.1）
        });
      }
      return true;
    });
  }

  /** 失败面：瞬态→attempts+1+nextMaterializeAt 退避+lease 释放（processing 维持——资金/交付零动作）；
   *  终态（permanent∨attempts 耗尽）→terminate。attempts 绝对置位（自 claim 快照+1——旧代
   *  lease 过期写回不与新代叠加计数）。 */
  private async fail(row: Media, failure: MaterializeFailure): Promise<'retry-scheduled' | 'terminal'> {
    const attempts = row.processingAttempts + 1;
    const terminal = failure.permanent || attempts >= MATERIALIZE_MAX_ATTEMPTS;
    materializeFailTotal.inc({ failure_kind: failure.kind, terminal: String(terminal) });
    if (!terminal) {
      await this.prisma.media.updateMany({
        where: { id: row.id, status: 'processing' },   // 他方已终态/完成——零动作
        data: {
          processingAttempts: attempts,
          nextMaterializeAt: new Date(Date.now() + computeMaterializeBackoffMs(attempts)),
          processingLeaseUntil: null,
        },
      }).catch((e) => this.logger.warn(`materialize 退避写回失败 mediaId=${row.id}（lease 过期自愈重试）: ${e}`));
      this.logger.warn(`[materialize] mediaId=${row.id} 第 ${attempts}/${MATERIALIZE_MAX_ATTEMPTS} 次失败（${failure.kind} 瞬态）: ${failure.message}`);
      return 'retry-scheduled';
    }
    await this.terminate(row, attempts, failure);
    return 'terminal';
  }

  /** 终态失败三步（序=资金正确性优先，见类头注）：①幂等补偿退款（rollbackDeliveryFailed——CAS
   *  SUCCEEDED→VOIDED+refund 台账，重跑恰一次）②单事务 Media failed+failed fact+NodeArtifact
   *  materializing→failed（不清 mediaId）③Sentry 告警+errorCode=MATERIALIZE_FAILED emit WS 推送
   *  （materialize 不写 doc——fileId 已在 finalize 交付；锚行在〔未被 replace〕才 emit：槽位被
   *  替换的用户值不被失败投影污染）。 */
  private async terminate(row: Media, attempts: number, failure: MaterializeFailure): Promise<void> {
    const reason = `MATERIALIZE_FAILED(${failure.kind}): ${failure.message}`.slice(0, 500);
    if (row.sourceIntentRowId) {
      const refunded = await this.teamCredit.rollbackDeliveryFailed(row.sourceIntentRowId, reason)
        .catch((e) => {
          this.logger.error(`[materialize] mediaId=${row.id} 补偿退款失败（行仍 processing——重 claim 自愈重试退款）: ${e}`);
          return false;
        });
      if (refunded) materializeRefundTotal.inc();
    }
    let emitTarget: { projectId: string; nodeId: string } | null = null;
    const marked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: row.id, status: 'processing' },   // 并发终态/完成——恰一胜者
        data: {
          status: 'failed',
          processingAttempts: attempts,
          nextMaterializeAt: null,
          processingLeaseUntil: null,
          factVersion: { increment: 1 },
        },
      });
      if (count !== 1) return false;
      if (row.sourceIntentRowId) {
        const anchored = await tx.nodeArtifact.findFirst({
          where: {
            sourceIntentRowId: row.sourceIntentRowId,
            sourceExecSeq: row.sourceExecSeq,
            artifactIndex: row.artifactIndex,
            state: 'materializing',
          },
          select: { projectId: true, nodeId: true },
        });
        if (anchored) {
          await tx.nodeArtifact.updateMany({
            where: {
              sourceIntentRowId: row.sourceIntentRowId,
              sourceExecSeq: row.sourceExecSeq,
              artifactIndex: row.artifactIndex,
              state: 'materializing',
            },
            data: { state: 'failed' },   // mediaId 不动——fileId 不清（UI 失败/重试非撤回交付）
          });
          emitTarget = anchored;
        }
      }
      // failed state fact 同事务（读面状态事实链完整——content 410 的 UI 信号源）
      const media = await tx.media.findUniqueOrThrow({ where: { id: row.id }, select: { factVersion: true, projectId: true } });
      const bindings = await tx.mediaBinding.findMany({ where: { mediaId: row.id }, select: { projectId: true } });
      const projects = new Set<string>([media.projectId, ...bindings.map((b) => b.projectId)].filter((p): p is string => !!p));
      if (projects.size > 0) {
        await tx.mediaFactOutbox.createMany({
          data: [...projects].map((projectId) => ({
            mediaId: row.id, projectId, factVersion: media.factVersion,
            factType: 'state', payload: { status: 'failed' },
          })),
          skipDuplicates: true,
        });
      }
      return true;
    }).catch((e) => {
      this.logger.error(`[materialize] mediaId=${row.id} 终态标记事务失败（行仍 processing——重 claim 自愈）: ${e}`);
      return false;
    });
    // 告警（不落人工工单——spec 裁决①「终态失败→幂等补偿退款+artifactState=failed+告警」）
    Sentry.captureException(new Error(`materialize 终态失败 mediaId=${row.id} intent=${row.sourceIntentRowId ?? '-'}: ${reason}`));
    this.logger.error(`[materialize] mediaId=${row.id} 终态失败（attempts=${attempts} ${failure.kind}）——补偿退款已发+artifactState=failed: ${failure.message}`);
    if (marked && emitTarget) {
      this.emit.emitNodeStatus(emitTarget.projectId, {
        nodeId: emitTarget.nodeId,
        status: 'error',
        error: `MATERIALIZE_FAILED: ${failure.message.slice(0, 180)}`,
      });
    }
  }

  /** quota 软限观测（v10 裁决④）：完成不因 quota 回滚/删产物/退款（钱已付 provider）——超限仅
   *  告警+计数。借 assertCanUpload(teamId, 0) 作谓词（usage+0>limit 即抛——限值单源，不另抄
   *  getLimits 算术）；探测失败（缺订阅行等）不计数不告警（best-effort）。 */
  private async observeQuota(row: Media): Promise<void> {
    try {
      await this.quota.assertCanUpload(row.teamId, 0);
    } catch {
      materializeQuotaSoftExceededTotal.inc();
      this.logger.warn(`[materialize] mediaId=${row.id} 完成后团队 ${row.teamId} 存储超软限（quota 软限——不删产物不退款）`);
    }
  }
}

/** completeMaterialized 入参形状（materializeBytes 产出）。 */
interface CompleteMaterializedParams {
  key: string;
  sha256: string;
  mimeType: string;
  sniffedMimeType: string | null;
  size: bigint;
  naturalWidth: number;
  naturalHeight: number;
  naturalRotation: number | null;
  metadata?: Record<string, unknown>;
}

interface FfprobeJson {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    side_data_list?: Array<{ rotation?: number }>;
  }>;
  format?: { duration?: string; bit_rate?: string };
}
