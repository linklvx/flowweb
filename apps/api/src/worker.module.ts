// apps/api/src/worker.module.ts
// Y0c T26（Z101/Z102/Z139；spec §0.6 偏离 30）：worker 进程装配面——**平铺 provider** 形态
// （Core 模块〔Execution/AiImageEdit〕imports CollabModule/TeamModule，其 ES import 闭包
// 含 14 个 controller 文件——census ⑰ 闭包执法〔Z131〕下不可被本模块导入；16 个 @Processor 文件
// 自身的传递闭包经实测全纯净 ⇒ processor+服务链直接列 providers）。main-worker.ts 引导序列消费。
//
// 装配面四件：
//  ①processor 全集 16+DB poller 2（grep @Processor 全仓清单——T12 ai-download 退役后 16；
//    BullMQ Worker 创建由 explorer 按 @Processor 元数据+forRoot('default') 共享配置承担，
//    registerQueue 仅服务 @InjectQueue 注入面；DB poller〔MediaProbePoller/MaterializeJob〕走
//    OnModuleInit 原生 setInterval——非 @Processor 面）；
//  ②MetricsCoreModule（Z139——collectDefaultMetrics 全仓唯一调用点=MetricsService 构造器，进程内
//    恰一次；worker 不装则 3002 无 process_*/nodejs_* 族）；
//  ③端口形态令牌（T32 起单令牌）：CollabWritePort=HttpCollabWritePort（baseUrl/token env 读——
//    WORKER_READ 门同源 loopback；
//    EmitPort=WorkerEmitPort（Z101 降级 no-op）；
//  ④资金/基础设施依赖平铺（PAYMENT_PROVIDER 工厂=RechargeModule 同款 verbatim——close-expired/
//    active-query 消费面非空转）。
// 零 controller（census ⑰ 承担充分性：本文件出发的 import 传递闭包 ∩ {*HttpModule,*Controller}=∅）。
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { MetricsCoreModule } from './metrics/metrics-core.module';
import { MinioModule } from './modules/minio/minio.module';
import { MediaProcessModule } from './modules/media-process/media-process.module';
import { REDIS_CLIENT, createManagedRedis } from './common/redis/managed-redis';
import { validateEnv } from './config/env';
import { QUEUE_NAMES } from './config/queue.constants';
// （Y1c T34 历史注记）既有文件环 team-subscription ↔ team-recharge（team-subscription:5 回引
// generateTeamOrderNo）已于 T34 解环（generateTeamOrderNo 迁 team.constants——两消费方同源）；
// 环期此处曾需「先 import recharge 半边」求值序锚（@Inject(TeamSubscriptionService) 装饰元数据
// 依加载序 undefined 的 workaround）。import 保留（worker 装配本就消费 TeamRechargeService）。
import { TeamRechargeService } from './modules/team/team-recharge.service';
// ── execution 链（Core 平铺——模块本体闭包脏不可导入，偏离 30） ──
import { ExecutionService } from './modules/execution/execution.service';
import { ExecutionRequestService } from './modules/execution/execution-request.service';   // Y1c T21：冻结请求执行路径（worker 零 doc 读）
import { GenerationIntentService } from './modules/execution/generation-intent.service';
import { NodeArtifactService } from './modules/artifact-core/node-artifact.service';
import { MediaRegistrationService } from './modules/artifact-core/media-registration.service';
import { ArtifactCommitService } from './modules/artifact-core/artifact-commit.service';
import { TopologyService } from './modules/execution/topology.service';
import { UpstreamMediaService } from './modules/execution/upstream-media.service';
import { ValidationService } from './modules/execution/validation.service';
import { ApiCallerService } from './modules/execution/api-caller.service';
import { PricingResolverService } from './modules/execution/pricing-resolver.service';
import { ExecutionProcessor } from './modules/execution/execution.processor';
import { VideoTrimService } from './modules/execution/video-trim.service';
import { VideoTrimProcessor } from './modules/execution/video-trim.processor';
import { VIDEO_TRIM_QUEUE, VIDEO_TRIM_CONNECTION } from './modules/execution/video-trim.constants';
import { VideoSeparateService } from './modules/execution/video-separate.service';
import { VideoSeparateProcessor } from './modules/execution/video-separate.processor';
import { VIDEO_SEPARATE_QUEUE } from './modules/execution/video-separate.constants';
// ── ai-image-edit 链（T12：ai-download 链退役——video materialize 归 MaterializeJob DB poller） ──
import { AiImageEditProcessor } from './modules/ai-image-edit/ai-image-edit.processor';
import { LightingConsumer } from './modules/ai-image-edit/lighting/lighting.consumer';
// T6：三处结果下载经 SafeRemoteFetch——MediaModule 闭包含 controller（census ⑰）不可导入，平铺注册（零依赖服务多实例语义等同）
import { SafeRemoteFetchService } from './modules/media/safe-remote-fetch.service';
// T7：probe 单相 poller（DB poller——sharp/ffprobe 上传路径重计算；同上闭包原因平铺注册，
// 仅 worker 进程装配——API 进程不注册〔spec §3.1 进程拓扑〕；依赖=Prisma/Minio 均已 import）
import { MediaProbePoller } from './modules/media/media-probe.poller';
// T12：video materialize DB poller（MaterializeJob——ai-download processor/队列整体退役后的接替面；
// 同 probe 形态：仅 worker 进程装配；依赖=Prisma/Minio/SafeRemoteFetch/TeamCredit/StorageQuota/EmitPort 均已 import）
import { MaterializeJob } from './modules/artifact-core/materialize-job.service';
// Y1c T23（迁移三）：ObjectManifest delete-claim 面（MaterializeJob 上传前 claim/锚定后 release+
// 有界 orphan sweep——worker 进程装配：GC 保护对象=materialize 产物，api 进程不双开定时器）
import { ObjectManifestService } from './modules/artifact-core/object-manifest.service';
// ── storyboard/material/temp-cleanup ──
import { StitchConsumer } from './modules/storyboard/stitch.consumer';
import { ThumbnailGeneratorConsumer } from './modules/material-library/consumers/thumbnail-generator.consumer';
import { TempCleanupProcessor } from './modules/temp-cleanup/temp-cleanup.processor';
// ── subscription task 6 processor+team 链服务 ──
import { GrantCreditProcessor } from './modules/subscription/task/grant-credit.processor';
import { PaymentSuccessProcessor } from './modules/subscription/task/payment-success.processor';
import { ExpireSubscriptionProcessor } from './modules/subscription/task/expire-subscription.processor';
import { DailyReconProcessor } from './modules/subscription/task/daily-recon.processor';
import { CloseExpiredSubOrderProcessor } from './modules/subscription/task/close-expired-sub-order.processor';
import { BannerCleanupProcessor } from './modules/subscription/task/banner-cleanup.processor';
import { TeamCreditService } from './modules/team/team-credit.service';
import { ProjectPermissionService } from './modules/team/project-permission.service';
import { CreditLedgerService } from './modules/team/credit-ledger.service';
import { TeamSubscriptionService } from './modules/team/team-subscription.service';
import { StorageQuotaService } from './modules/team/storage-quota.service';
import { AuditService } from './common/audit/audit.service';
import { TeamMediaCleanupProcessor } from './modules/team/task/team-media-cleanup.processor';
import { TeamActiveQueryProcessor } from './modules/team/task/team-recharge-active-query.processor';
import { TeamCloseExpiredProcessor } from './modules/team/task/team-recharge-close-expired.processor';
// ── recharge（PAYMENT_PROVIDER/PaymentGateway——平铺，RechargeModule 闭包带 controller） ──
import { PaymentGateway } from './modules/recharge/payment.gateway';
import { WechatPaymentProvider } from './modules/recharge/providers/wechat-payment.provider';
// ── 端口形态 ──
import { CollabWritePort, HttpCollabWritePort } from './modules/collab/collab-write.port';
import { EmitPort, WorkerEmitPort } from './modules/gateway/emit.port';
// ── Y1c T11：compact 轮询 DB poller（worker 进程——重放在 worker；MediaProbePoller/MaterializeJob
//    同款平铺先例；闭包纯净=repo 族〔canvas-doc.factory/sentry-scrub/store.metrics〕零 controller/
//    Http 面，census ⑰ 不破。API 进程不注册——compact 触发面在 api 侧经 maybeCompact 原位承接） ──
import { CanvasDocUpdateRepository } from './modules/collab/canvas-doc-update.repository';
import { CollabCompactPoller } from './modules/collab/collab-compact.poller';
// ── C1-1（生产就绪收尾批）：retention sweeper DB poller——worker 三扫面（request claim+void/input 批删/
//    event 批删）+stuck 计数，advisory xact 单飞一个事务内；api 侧 timer/武装已移除（api 进程
//    零注册——census ⑰ 闭包纯度=prisma/shared/prom-client/team-credit，零 controller/Http 面） ──
import { ExecutionRequestRetentionService } from './modules/execution/execution-request.retention.service';
import { RuntimeFeedRetentionService } from './modules/collab/runtime-feed.retention.service';
import { RetentionSweeperPoller } from './modules/collab/retention.sweeper.poller';
// ── C3-1（生产就绪收尾批·doc-append-gap-alert）：append 审计 DB poller——每 5min tick 单事务
//    （advisory 单飞+轮转游标批选择+单条 SQL CTE 三断批内审计+游标回写）；新 gap 边沿 inc+current gauge
//    +purge 义务年龄告警；api 进程零注册（census ⑰ 闭包纯度=prisma/shared/prom-client/sentry-scrub，
//    零 controller/Http 面——retention 同族平铺先例） ──
import { CollabAppendAuditWorker } from './modules/collab/collab-append-audit.worker';
// ── C2-2b（生产就绪收尾批·replay-canary 比对侧）：canary worker verify DB poller——READY pin
//    批读+TTL 续租→readAt 坐标重放（重放/hash 移出 api 事件循环——spec §6 R2 部分采纳面）→hash 主判
//    +SV 互支语义兜底→mismatch freeze 实弹（CANARY_FREEZE_ENABLED 生产默认 true）→compare-and-delete
//    +last_check_age gauge 维护；api 进程零注册（census ⑰ 闭包纯度=repo 族+ops-gate+sentry-scrub，
//    零 controller/Http 面——retention/append-audit 同族平铺先例；依赖 Prisma/CanvasDocUpdateRepository
//    均已 import） ──
import { CollabCanaryVerifyWorker } from './modules/collab/collab-canary-verify.worker';
// ── C4-a（生产就绪收尾批·project-erasure）：erasure run 轮询骨架（claim+team 分批置 DELETING+
//    WAITING_CHILDREN 会合判定——红④⑤⑤-b worker 面；api 进程零注册〔retention/append-audit 同族
//    平铺先例〕；闭包纯度=prisma/shared/credit-ledger/project-lock 族，零 controller/Http 面——
//    census ⑰ 不破。saga 完整态机〔PURGING_DB/OBJECTS/CACHE/VERIFYING+介质 manifest〕归 C4-c 扩展） ──
import { ErasureContextService } from './modules/collab/project-lock';
import { ProjectErasureRunPoller } from './modules/collab/project-erasure.poller';

const env = validateEnv();

@Module({
  imports: [
    // forRoot connection/prefix/defaultJobOptions 五键与 app.module 逐字同款（共享连接 default——
    // processor Worker 创建按 configKey 回落本配置；prefix:'bull' 显式=T31/§0.6 偏离 46——本图 12 队列
    // 无 registerQueue/Queue 实例〔平铺装配，头注①〕，worker opts 全走本回落，缺省即 "undefined:" 命名
    // ⇒api 侧 getWorkers 侦测失明）；app.module 侧另有 extraOptions.manualRegistration 注册门
    // （T30/Z98 四面之二）——worker 进程恒注册（消费面本体），本 forRoot 不带门
    BullModule.forRoot('default', {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      prefix: 'bull',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 * 7 },
      },
    }),
    // worker 图内 @InjectQueue 消费面（ExecutionService/VideoTrim/VideoSeparate/PaymentSuccess/
    // TeamRecharge）——registerQueue 形态逐字对齐各源模块
    BullModule.registerQueue({ name: VIDEO_TRIM_QUEUE, configKey: VIDEO_TRIM_CONNECTION }),
    BullModule.registerQueue({
      name: VIDEO_SEPARATE_QUEUE,
      configKey: 'default',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 * 7 },
      },
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED, defaultJobOptions: { attempts: 1 } }),
    BullModule.registerQueue({ name: 'team-recharge-close-expired' }),
    PrismaModule,
    MetricsCoreModule,   // Z139：3002 的 process_*/nodejs_* 族载体（collectDefaultMetrics 进程内恰一次）
    MinioModule,
    MediaProcessModule,
  ],
  providers: [
    // ── processor 全集 17 ──
    ExecutionProcessor,
    VideoTrimProcessor,
    VideoSeparateProcessor,
    AiImageEditProcessor,
    LightingConsumer,
    StitchConsumer,
    ThumbnailGeneratorConsumer,
    TempCleanupProcessor,
    GrantCreditProcessor,
    PaymentSuccessProcessor,
    ExpireSubscriptionProcessor,
    DailyReconProcessor,
    CloseExpiredSubOrderProcessor,
    BannerCleanupProcessor,
    TeamMediaCleanupProcessor,
    TeamActiveQueryProcessor,
    TeamCloseExpiredProcessor,
    // ── execution 链服务（processor 传递依赖平铺） ──
    ExecutionService,
    ExecutionRequestService,   // Y1c T21（G4 门）
    SafeRemoteFetchService,   // T6：ai-image-edit/lighting/materialize 下载原语（SSRF 四门+限长）
    MediaProbePoller,         // T7：probe 单相 DB poller（图片批 4/lease 180s+视频 batch 1/lease 5min）
    MaterializeJob,           // T12：video materialize DB poller（SKIP LOCKED claim/lease 退避+终态失败幂等补偿退款）
    ObjectManifestService,    // Y1c T23：对象登记+delete-claim（MaterializeJob 消费+有界 orphan sweep）
    GenerationIntentService,
    NodeArtifactService,   // T10：claimCapture 依赖（zero-dep——ArtifactCoreModule 闭包含 TeamModule controller，worker 平铺先例=SafeRemoteFetchService）
    MediaRegistrationService,   // T10：唯一 Media 写入点（registerInTx stage durable——ArtifactCommit 消费）
    ArtifactCommitService,   // T10：资金路径唯一 finalize（worker 是真实调用方——生产 API manualRegistration:true 不消费队列）
    TopologyService,
    UpstreamMediaService,   // Y1a T8：上游媒体解析（NodeArtifact 读源/身份 canonicalize/外呼 URL 解析）
    ValidationService,
    ApiCallerService,
    PricingResolverService,
    ProjectPermissionService,
    TeamCreditService,
    VideoTrimService,
    VideoSeparateService,
    // ── team/资金链服务 ──
    CreditLedgerService,
    TeamSubscriptionService,
    StorageQuotaService,
    TeamRechargeService,
    AuditService,
    PaymentGateway,   // WS gateway 类在 application context 实例化不监听（@WebSocketServer 恒 undefined；emit 调用面 try/catch best-effort 既有）
    // ── Y1c T11：compact 轮询面（DB poller——启动续跑 purgeBelowSeq 清理义务+周期扫描前缀折叠；
    // 授权=行锁+generation/pgSeq CAS 不拿租约——worker 进程零 CollabLease 依赖） ──
    CanvasDocUpdateRepository,
    CollabCompactPoller,
    // ── C1-1（生产就绪收尾批）：retention sweeper 面（DB poller——request claim+void ≤50/tick
    // 多 tick 排空/input+event 批删 loop-to-empty/stuck 计数，advisory xact 单飞四扫面一事务；
    // api 侧 RuntimeFeedService timer 已移除=worker 唯一触发面） ──
    ExecutionRequestRetentionService,
    RuntimeFeedRetentionService,
    RetentionSweeperPoller,
    // C3-1（生产就绪收尾批·doc-append-gap-alert）：append 审计 poller（每 5min tick——boot 首 tick
    // +轮转游标批选择+SQL CTE 三断言审计+新 gap 边沿 inc/purge 义务年龄告警；api 进程零注册）
    CollabAppendAuditWorker,
    // C2-2b（生产就绪收尾批·replay-canary 比对侧）：canary verify poller（每 tick READY pin 批读
    // +TTL 续租+readAt 重放比对+mismatch freeze 实弹+compare-and-delete+last_check_age gauge；api
    // 进程零注册——捕获面在 api〔collab.module〕比对面在 worker 的进程分工）
    CollabCanaryVerifyWorker,
    // C4-a（project-erasure）：erasure run 轮询骨架（run 行=唯一唤醒源——claim 租约恢复+team 分批
    // tombstone+会合判定；CreditLedgerService 通行证消费已平铺在位）
    ErasureContextService,
    ProjectErasureRunPoller,
    // ── recharge 域（PAYMENT_PROVIDER 工厂=RechargeModule 同款 verbatim——close-expired/active-query 消费面） ──
    {
      provide: 'PAYMENT_PROVIDER',
      useFactory: () => {
        if (!process.env.WECHAT_PAY_APP_ID) return null;
        return new WechatPaymentProvider({
          WECHAT_PAY_APP_ID: process.env.WECHAT_PAY_APP_ID!,
          WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID!,
          WECHAT_PAY_API_V3_KEY: process.env.WECHAT_PAY_API_V3_KEY!,
          WECHAT_PAY_MERCHANT_SERIAL_NO: process.env.WECHAT_PAY_MERCHANT_SERIAL_NO!,
          WECHAT_PAY_PRIVATE_KEY: process.env.WECHAT_PAY_PRIVATE_KEY!,
          WECHAT_PAY_PUBLIC_KEY_ID: process.env.WECHAT_PAY_PUBLIC_KEY_ID!,
          WECHAT_PAY_PUBLIC_KEY: process.env.WECHAT_PAY_PUBLIC_KEY!,
        });
      },
    },
    // ── 端口形态三令牌（Z99/Z101/偏离 31） ──
    {
      provide: CollabWritePort,
      useFactory: () => new HttpCollabWritePort({
        baseUrl: `http://127.0.0.1:${env.PORT}`,   // Z102 ready 门同源 loopback（api 同 .env 同 PORT）
        token: env.WORKER_WRITE_TOKEN,
      }),
    },
    // Y1c T32：HttpCollabDocWriter（writeBatch worker 令牌）随 write-batch 端点退役删除——worker
    // 通道唯一写面=HttpCollabWritePort.writeExecStatus（exec-status 端点，RuntimeEvent feed 写）。
    { provide: EmitPort, useValue: new WorkerEmitPort() },
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂（video-separate 链消费）
  ],
})
export class WorkerModule {}
