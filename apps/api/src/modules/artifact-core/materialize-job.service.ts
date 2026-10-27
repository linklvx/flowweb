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
// mediaId——UI 失败/重试非撤回交付）+Sentry 告警。
// errorCode=MATERIALIZE_FAILED 送达双通道（评审 P1 裁定）：①**failed fact payload 携带
// {status:'failed',errorCode,error}**（durable 进 MediaFactOutbox——T16 pendingFacts 消费=UI
// 失败/重试的**真实通道**：本 Job 仅装配于 worker.module，worker 的 EmitPort=WorkerEmitPort 计数
// no-op，双进程拓扑下 emit 到不了任何客户端——事实流是唯一可达载道）②emitNodeStatus 保留
// （api-role/单进程形态下有义；worker 形态=降级计数——emit.port.ts 既有语义）。materialize 不写
// doc（data 域）硬约束两通道共同维持。
// 写回 lease fence（评审 P2-②）：claim 置位的 processingLeaseUntil 值=本代唯一持有物——完成/退避/
// 终态全部写回带 WHERE processingLeaseUntil=<本代值>（值 CAS）：旧代 lease 过期被新代接管 ⇒ 写回
// 0 行=fenced（放弃写回+日志）——僵尸 worker 不得清新代 lease/叠 attempts/投退避，并发双下载窗收敛
// 为「至多一代持有写回权」。Y1c T23（B12/B17 继承）：claim 同事务建 MaterializeRun 行（RUNNING）
// =durable 侧记录，与 lease 值 CAS 双闸——旧 run 迟到写回 0 命中=run 行让位 FENCED。
// 退款先行序（先 rollback 后置 failed）：反序崩溃窗=「failed 行无人重扫」的死退款面；此序崩溃窗=
// processing 行重 claim 自愈（退款 no-op→置 failed）；极端边缘=退款后重试成功〔用户免费得字节〕
// ——资损方向正确侧（宁可免费字节不可吞钱）。终态入口另有 lease 失守前置读检——旧代失守即放弃
// 退款（缩小「新代在飞被旧代退款」边缘窗，TOCTOU 残窗由退款 CAS 幂等+自愈序兜底）。
// quota=软限（v10 裁决④）：完成不因 quota 回滚/删产物/退款（钱已付 provider）——超限仅观测
// （assertCanUpload(teamId,0) 借谓词：usage+0>limit 即抛）+计数+告警。
// 【T12 登记收口（T19 裁定）：终态/fenced 不清理已上传 content-addressed 对象=登记 Y2（orphan
// sweep 面）】裁定理由：①fenced 且新代产物内容相同=同 sha 同 key 同对象（content-addressed
// 幂等——零泄漏）；真 orphan 窗=fenced∧新代重下产物**字节漂移**（provider 重生成同意图不同内容）
// ——旧 `{base}-{旧sha}` 对象悬空无行引用；②该窗为窄窗且泄漏=免费字节（资损方向正确侧——宁可
// 免费字节不可吞钱/删在用对象）；③GC poller 扩前缀清理（枚举 `{row.key}-` 变体删非 Media.key 项）
// 需排除「processing 行在飞 key 集」（lease 换代窗内变体枚举误删在飞对象=上传完成但对象已灭的
// 真故障面）——竞态排除面>泄漏面，登记 Y2 与 cs 写者 registry 同批需求池，不在本卡造轮。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, Media } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Counter, register } from 'prom-client';
import type { MediaNaturalFactPayload } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { mediaMaterializeLag } from '../media-delivery/delivery-lag.metrics';
import { MinioService } from '../minio/minio.service';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { sniffMimeType } from '../media/sniff';
import { TeamCreditService } from '../team/team-credit.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { EmitPort } from '../gateway/emit.port';
import { ObjectManifestService } from './object-manifest.service';   // Y1c T23：delete-claim（上传前 claim/锚定后 release——GC 交错误删收口）
// ffprobe 单源（T7 沙箱本体——census ㉒ 纪律禁第二份字面量；buildFfprobeArgs/FFPROBE_TIMEOUT_MS 复用）
import { buildFfprobeArgs, FFPROBE_TIMEOUT_MS } from '../media/media-probe.poller';
import { ffprobePath } from '../media-process/media-process.service';

// ── poller/claim 参数（对齐 probe 分型批纪律：视频大对象批 1 串行） ──
export const MATERIALIZE_POLL_INTERVAL_MS = 10_000;
export const MATERIALIZE_BATCH = 1;
/** lease=下载 8min+ffprobe 15s+上传/收尾余量（评审#6：10min 对 8min 下载超时余量过紧——20min）。
 *  lease 只承担「僵尸 worker 接管等待」语义：过期即新代可 claim，不阻塞正常路径（写回按 lease 值
 *  CAS 非新鲜度——过期未接管仍可完成/终态）。 */
export const MATERIALIZE_LEASE_MS = 20 * 60_000;
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
    /** Y1c T23（迁移三）：delete-claim 面（上传 content-addressed 键前 claim、锚定后 release）。
     *  @Optional——直构测试（t23 int 六参形态）缺席=跳过（行域 GC 兜底仍在）。 */
    @Optional() private readonly manifests?: ObjectManifestService | null,
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

  /** 一轮：claim 批（视频批 1）逐行物化；busy 防重入（长视频不叠轮——probe 同款）。
   *  T19（spec :518）media_materialize_lag：每 tick 头刷新最老 processing∧video∧generated 行龄
   *  （空轮同样刷新归零——与投影 poller observeLag 同纪律，防 gauge 冻结陈旧正值）。 */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      void this.observeLag().catch(() => {});
      for (const row of await this.claim()) await this.materializeRow(row);
    } finally {
      this.busy = false;
    }
  }

  private async observeLag(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ oldest: Date | null }[]>(Prisma.sql`
      SELECT min("createdAt") AS "oldest" FROM "Media"
      WHERE "status" = 'processing' AND "deletedAt" IS NULL AND "type" = 'generated' AND "mimeType" LIKE 'video/%'`);
    const oldest = rows[0]?.oldest;
    mediaMaterializeLag.set(oldest ? (Date.now() - oldest.getTime()) / 1000 : 0);
  }

  /** 两段式事务 claim（probe claim 同形态）：SELECT FOR UPDATE SKIP LOCKED（并发双 claim 恰一）
   *  →同事务置 processingLeaseUntil+清 nextMaterializeAt（行锁保持至 commit）。
   *  mimeType 路由=provider 声明列（processing 期 sniffed 恒 NULL）——image stage 短命行天然排除。
   *  Y1c T23（B12/B17 继承——spec §6.3）：claim 同事务建 MaterializeRun 行（state=RUNNING，
   *  expectedExecSeq=Media.sourceExecSeq——执行代际族锚，#4：与 lifecycleSeq/fenceSeq 生命周期族
   *  无关）=durable 侧记录；run 行与 lease 值 CAS 双闸——旧 run 迟到写回（lease 被新代接管）0 命中
   *  =让位 FENCED。返回行附 materializeRunId（写回时携带）。 */
  async claim(): Promise<Array<Media & { materializeRunId: string }>> {
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
      const rows = await tx.media.findMany({ where: { id: { in: ids } } });
      const withRuns: Array<Media & { materializeRunId: string }> = [];
      for (const m of rows) {
        const run = await tx.materializeRun.create({
          data: { projectId: m.projectId ?? '', nodeId: m.nodeId ?? '', expectedExecSeq: m.sourceExecSeq ?? 0n, state: 'RUNNING' },
        });
        withRuns.push({ ...m, materializeRunId: run.id });
      }
      return withRuns;
    });
  }

  /** 单行物化。返回：completed（本代完成）/fenced（行已非 processing——他方完成/终态/复驱：幂等零
   *  动作零 IO）/retry-scheduled（瞬态退避）/terminal（终态失败——已补偿退款+failed）。
   *  幂等键=mediaId：claim 条件（status=processing）+完成/终态/退避写回 CAS（status∧本代 lease 值
   *  守卫）双闸——kill 后重跑不重复下载/不重复 Media。
   *  Y1c T23：MaterializeRun 行随写回终局（COMPLETED/FAILED/FENCED——claim 建行 RUNNING；lease
   *  失守/主动退避让渡=让位 FENCED 交新 run）。 */
  async materializeRow(row: Media & { materializeRunId?: string }): Promise<'completed' | 'fenced' | 'retry-scheduled' | 'terminal'> {
    if (row.status !== 'processing') return 'fenced';   // 已终态/复驱——零 IO 幂等早退
    // fenced 亦来自写回 0 行（P2-② lease fence：本代 lease 被新代接管——放弃写回零污染）
    try {
      const r = await this.materializeBytes(row);       // 下载+sniff+ffprobe+上传（全事务外）
      const done = await this.completeMaterialized(row, r);
      if (done) {
        materializeDoneTotal.inc();
        await this.closeRun(row.materializeRunId, 'COMPLETED');
        // T23 delete-claim release（锚定后——Media.key 已引用 content-addressed 键）：owner CAS
        //（新代已接管同键 claim 时本 release 0 命中=不清新代保护）
        await this.manifests?.releaseClaim(r.key, `materialize:${row.id}`).catch(() => undefined);
        await this.observeQuota(row);
        return 'completed';
      }
      await this.closeRun(row.materializeRunId, 'FENCED');
      return 'fenced';   // status CAS 0 命中=并发他方已完成（content-addressed 同对象——零动作）
    } catch (e) {
      const failure = e instanceof MaterializeFailure
        ? e
        : new MaterializeFailure('internal', false, e instanceof Error ? e.message : String(e));
      return this.fail(row, failure);
    }
  }

  /** Y1c T23：MaterializeRun 行终局（state=RUNNING CAS——已完成/FAILED 的 run 免疫；观测面写失败
   *  仅告警不阻断主流程——run 行=durable 侧记录非决策闸）。 */
  private async closeRun(runId: string | undefined, state: 'COMPLETED' | 'FAILED' | 'FENCED'): Promise<void> {
    if (!runId) return;
    await this.prisma.materializeRun.updateMany({ where: { id: runId, state: 'RUNNING' }, data: { state } })
      .catch((e) => this.logger.warn(`[materialize] run=${runId} 终局写回 ${state} 失败（观测面——不阻断）: ${e}`));
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
    // 评审#5：sniff 不可判（null）时优先 provider 声明的 video/* 档（row.mimeType），再回落响应
    // Content-Type——防 octet-stream 之类响应头被持久化为行 MIME（content 端点 Content-Type 源）。
    const declaredVideo = row.mimeType && row.mimeType.startsWith('video/') ? row.mimeType : null;
    const mimeType = sniffed ?? declaredVideo ?? fetched.contentType ?? row.mimeType ?? 'video/mp4';
    const natural = await this.probeNatural(fetched.buffer);   // 复用同一次下载（spec :45 P1）
    const sha256 = createHash('sha256').update(fetched.buffer).digest('hex');
    const key = `${row.key}-${sha256}`;                        // 预分配 base+content-addressed 后缀（image 系同构）
    // Y1c T23 delete-claim（上传前——GC 交错误删在飞对象收口）：claimOwner=materialize:<mediaId>、
    // claimUntil=lease 窗；claim 在位未过=manifest sweep 禁删（缺席=直构测试跳过——行域 GC 兜底仍在）
    if (this.manifests) {
      await this.manifests.claim(key, `materialize:${row.id}`, Date.now() + MATERIALIZE_LEASE_MS);
    }
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
   *  factVersion/outbox；成功→artifactState=stored）。返回 false=写回 0 行（他方已完成〔status
   *  CAS〕∨ lease 已被新代接管〔P2-② lease fence〕——幂等零动作：content-addressed 同对象/新代
   *  自会收敛）。写回 CAS=status∧本代 processingLeaseUntil 值（无 materializeRunId 列的等效
   *  fence——lease 过期但无人再 claim 时值仍在=本代可完成；新代再 claim 后值变=本代 fenced）。 */
  private async completeMaterialized(row: Media, r: CompleteMaterializedParams): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: row.id, status: 'processing', processingLeaseUntil: row.processingLeaseUntil },   // 幂等 CAS+lease fence（P2-②）
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
              // F4c P2-3：natural payload wire 契约单源（同 probe doneNatural——视频路径零 downscaledFrom）
              payload: {
                naturalWidth: r.naturalWidth, naturalHeight: r.naturalHeight,
                naturalRotation: r.naturalRotation, source: 'materialize',
              } satisfies MediaNaturalFactPayload,
            },
          ]),
          skipDuplicates: true,   // [mediaId,projectId,factType,factVersion] 四元组唯一（S0.1）
        });
      }
      return true;
    });
  }

  /** 失败面：瞬态→attempts+1+nextMaterializeAt 退避+lease 释放（processing 维持——资金/交付零动作）；
   *  终态（permanent∨attempts 耗尽）→terminate。attempts 绝对置位（自 claim 快照+1）。全部写回带
   *  本代 lease 值 CAS（P2-②）：0 行=lease 已被新代接管→fenced 放弃（不叠计数/不清新代 lease/
   *  不投退避——并发双下载窗收敛为至多一代持有写回权）。
   *  Y1c T23：run 行随写回终局——退避让渡/lease 失守=FENCED（本 run 无后续写回者，留 RUNNING=
   *  陈旧行污染在飞观测面；下轮 claim 建新 run）；终态=FAILED。 */
  private async fail(row: Media & { materializeRunId?: string }, failure: MaterializeFailure): Promise<'retry-scheduled' | 'terminal' | 'fenced'> {
    const attempts = row.processingAttempts + 1;
    const terminal = failure.permanent || attempts >= MATERIALIZE_MAX_ATTEMPTS;
    materializeFailTotal.inc({ failure_kind: failure.kind, terminal: String(terminal) });
    if (!terminal) {
      const { count } = await this.prisma.media.updateMany({
        where: { id: row.id, status: 'processing', processingLeaseUntil: row.processingLeaseUntil },   // lease fence（P2-②）
        data: {
          processingAttempts: attempts,
          nextMaterializeAt: new Date(Date.now() + computeMaterializeBackoffMs(attempts)),
          processingLeaseUntil: null,
        },
      }).catch((e) => {
        // 评审#4：基础设施错误≠fenced（0 行）——分日志；行留 processing+本代 lease，lease 过期自愈重试
        this.logger.warn(`[materialize] mediaId=${row.id} 退避写回基础设施错误（行留 processing+本代 lease——lease 过期自愈重试）: ${e}`);
        return { count: -1 };
      });
      if (count !== 1) {
        if (count === 0) {
          this.logger.warn(`[materialize] mediaId=${row.id} 退避写回 0 行（本代 lease 已被新代接管/他方终态）——fenced 放弃写回`);
          await this.closeRun(row.materializeRunId, 'FENCED');
        }
        return 'fenced';
      }
      await this.closeRun(row.materializeRunId, 'FENCED');   // 主动退避让渡（lease 释放交下轮 claim 新 run）
      this.logger.warn(`[materialize] mediaId=${row.id} 第 ${attempts}/${MATERIALIZE_MAX_ATTEMPTS} 次失败（${failure.kind} 瞬态）: ${failure.message}`);
      return 'retry-scheduled';
    }
    const marked = await this.terminate(row, attempts, failure);
    return marked ? 'terminal' : 'fenced';
  }

  /** 终态失败三步（序=资金正确性优先，见类头注）：⓪lease 失守前置读检（P2-②——旧代失守即放弃，
   *  不发退款不置 failed；TOCTOU 残窗由 markFailed 事务内 lease CAS 拦截+退款 CAS 幂等兜底）
   *  ①幂等补偿退款（rollbackDeliveryFailed——CAS SUCCEEDED→VOIDED+refund 台账，重跑恰一次；
   *  reason 同步落 intent.error〔schema :1065 error String?〕——fact payload 的 error 字段同源；
   *  **抛错=立即放弃终态+释放本代 lease**〔Critical#1〕——行留 processing 重 claim 重走终态）
   *  ②单事务 Media failed（status∧本代 lease CAS）+failed fact（payload 携带 errorCode——P1：
   *  durable 事实流=T16 pendingFacts 消费的 UI 真实通道）+NodeArtifact materializing→failed（不清
   *  mediaId）③Sentry 告警+emitNodeStatus（**worker 进程=WorkerEmitPort 计数 no-op——双进程拓扑
   *  下到不了客户端**；保留供 api-role/单进程形态——真实 UI 通道=②的 failed fact）。
   *  返回 marked=false=终态未达（lease 失守∨他方已终态∨退款抛错放弃）——调用方按 fenced 语义收敛。 */
  private async terminate(row: Media & { materializeRunId?: string }, attempts: number, failure: MaterializeFailure): Promise<boolean> {
    const reason = `MATERIALIZE_FAILED(${failure.kind}): ${failure.message}`.slice(0, 500);
    // ⓪ lease 失守前置读检：status/lease 与本代快照不符 → 旧代放弃（新代在飞不退款不终结）
    const owner = await this.prisma.media.findUnique({
      where: { id: row.id },
      select: { status: true, processingLeaseUntil: true },
    }).catch(() => null);
    if (!owner || owner.status !== 'processing'
      || (owner.processingLeaseUntil?.getTime() ?? null) !== (row.processingLeaseUntil?.getTime() ?? null)) {
      this.logger.warn(`[materialize] mediaId=${row.id} 终态前 lease 失守（新代接管/他方终态）——放弃退款与终态写回`);
      return false;
    }
    // ① 幂等补偿退款（rollbackDeliveryFailed——CAS SUCCEEDED→VOIDED+refund 台账，重跑恰一次；
    //    reason 同步落 intent.error〔schema :1065 error String?〕——fact payload 的 error 字段同源）。
    //    **Critical#1：抛错（lock_timeout/死锁/池超时瞬态）≠返回 false（CAS 未命中=先前已退/不适用）
    //    ——抛错必须立即放弃终态**：若仍置 failed ⇒ intent 永留 SUCCEEDED、failed 行永不再 claim、
    //    全仓无「SUCCEEDED∧failed Media」重扫 ⇒ 用户付了钱退款永不发生。放弃路径=best-effort 释放
    //    本代 lease（下轮 claim 即重试，不等 lease 自然过期）+行保持 processing。
    let refunded = false;
    if (row.sourceIntentRowId) {
      try {
        refunded = await this.teamCredit.rollbackDeliveryFailed(row.sourceIntentRowId, reason);
      } catch (e) {
        this.logger.error(`[materialize] mediaId=${row.id} 补偿退款抛错（终态放弃——行留 processing 重 claim 重走终态，退款 CAS 幂等恰一次）: ${e}`);
        await this.prisma.media.updateMany({
          where: { id: row.id, status: 'processing', processingLeaseUntil: row.processingLeaseUntil },
          data: { processingLeaseUntil: null, nextMaterializeAt: null },
        }).catch((releaseErr) => this.logger.warn(`[materialize] mediaId=${row.id} 退款抛错后 lease 释放失败（lease 自然过期自愈）: ${releaseErr}`));
        return false;
      }
      if (refunded) materializeRefundTotal.inc();
    }
    let emitTarget = null as { projectId: string; nodeId: string } | null;   // 闭包内赋值——显式宽化标注（TS 流分析不跟踪）
    const marked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: row.id, status: 'processing', processingLeaseUntil: row.processingLeaseUntil },   // lease fence（P2-②）
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
      // failed state fact 同事务——payload 携带 errorCode+error（P1：durable 事实流=UI 失败/重试真实
      // 通道，T16 pendingFacts 消费；error=reason 截断= intent.error 同源同义锚）
      const media = await tx.media.findUniqueOrThrow({ where: { id: row.id }, select: { factVersion: true, projectId: true } });
      const bindings = await tx.mediaBinding.findMany({ where: { mediaId: row.id }, select: { projectId: true } });
      const projects = new Set<string>([media.projectId, ...bindings.map((b) => b.projectId)].filter((p): p is string => !!p));
      if (projects.size > 0) {
        await tx.mediaFactOutbox.createMany({
          data: [...projects].map((projectId) => ({
            mediaId: row.id, projectId, factVersion: media.factVersion,
            factType: 'state',
            payload: { status: 'failed', errorCode: 'MATERIALIZE_FAILED', error: reason.slice(0, 180) },
          })),
          skipDuplicates: true,
        });
      }
      return true;
    }).catch((e) => {
      this.logger.error(`[materialize] mediaId=${row.id} 终态标记事务失败（行仍 processing——重 claim 自愈）: ${e}`);
      return false;
    });
    // ③ 告警（不落人工工单——spec 裁决①「终态失败→幂等补偿退款+artifactState=failed+告警」）：
    // 评审#2：告警面移入 marked 分支+文案按 refunded 区分（fenced=warn 降级；退款 CAS 未命中=先前
    // 已退/不适用——非「本轮已发」）。Sentry=运维告警面恒达；emitNodeStatus=**worker 进程计数
    // no-op**（WorkerEmitPort——双进程拓扑下到不了客户端，保留供 api-role/单进程形态）；UI 真实
    // 通道=上方 failed fact 的 errorCode。
    if (marked) {
      await this.closeRun(row.materializeRunId, 'FAILED');
      Sentry.captureException(new Error(`materialize 终态失败 mediaId=${row.id} intent=${row.sourceIntentRowId ?? '-'} 退款=${refunded ? '本轮已发' : '先前已发/不适用'}: ${reason}`));
      this.logger.error(`[materialize] mediaId=${row.id} 终态失败（attempts=${attempts} ${failure.kind}）——artifactState=failed+failed fact(errorCode)；补偿退款=${refunded ? '本轮已发' : '先前已发/不适用（CAS 未命中）'}: ${failure.message}`);
      if (emitTarget) {
        this.emit.emitNodeStatus(emitTarget.projectId, {
          nodeId: emitTarget.nodeId,
          status: 'error',
          error: `MATERIALIZE_FAILED: ${failure.message.slice(0, 180)}`,
        });
      }
    } else {
      await this.closeRun(row.materializeRunId, 'FENCED');
      this.logger.warn(`[materialize] mediaId=${row.id} 终态写回 0 行（lease 失守/他方已终态）——fenced：不告警不 emit`);
    }
    return marked;
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
