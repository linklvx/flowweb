import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { REDIS_CLIENT, createManagedRedis } from './common/redis/managed-redis';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';
import { HomeBannerModule } from './modules/home-banner/home-banner.module';
import { ProjectModule } from './modules/project/project.module';
import { TeamModule } from './modules/team/team.module';
import { CollabModule } from './modules/collab/collab.module';
import { TelemetryThrottlerGuard } from './modules/collab/telemetry.controller';
import { AdminModule } from './modules/admin/admin.module';
import { CreditModule } from './modules/credit/credit.module';
import { ExecutionCoreModule } from './modules/execution/execution-core.module';
import { ExecutionHttpModule } from './modules/execution/execution-http.module';
import { ExecutionDaemonModule } from './modules/execution/execution-daemon.module';
import { TemplateModule } from './modules/template/template.module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { AdminSubscriptionModule } from './modules/subscription/admin/admin-subscription.module';
import { SubscriptionTaskModule } from './modules/subscription/task/subscription-task.module';
import { VideoProjectModule } from './modules/video-project/video-project.module';
import { VideoWorkModule } from './modules/video-work/video-work.module';
import { MinioModule } from './modules/minio/minio.module';
import { StorageModule } from './modules/storage/storage.module';
import { MediaModule } from './modules/media/media.module';
import { AiDownloadCoreModule } from './modules/ai-download/ai-download-core.module';
import { AiImageEditCoreModule } from './modules/ai-image-edit/ai-image-edit-core.module';
import { AiImageEditHttpModule } from './modules/ai-image-edit/ai-image-edit-http.module';
import { TempCleanupModule } from './modules/temp-cleanup/temp-cleanup.module';
import { MaterialLibraryModule } from './modules/material-library/material-library.module';
import { StylesModule } from './modules/styles/styles.module';
import { FolderModule } from './modules/folder/folder.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { RechargeModule } from './modules/recharge/recharge.module';
import { MetricsCoreModule } from './metrics/metrics-core.module';
import { MetricsHttpModule } from './metrics/metrics-http.module';
import { StoryboardModule } from './modules/storyboard/storyboard.module';
import { AuthGuard } from './auth/auth.guard';
import { AdminGuard } from './auth/admin.guard';
import { validateEnv } from './config/env';

const env = validateEnv();

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    BullModule.forRoot('default', {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      // Y0c T31（§0.6 偏离 46）：显式 prefix=bullmq 默认值。BullExplorer 建 worker 时 opts 优先取
      // registerQueue 的 Queue 实例（.opts.prefix='bull'），图内无 Queue 实例的队列回落本共享配置——
      // 缺省则 `prefix: undefined` 显式覆盖 bullmq 默认 ⇒ worker 连接命名 "undefined:<b64>" ⇒
      // getWorkers()（CLIENT LIST 按自身 prefix 过滤）侦测失明（registered=0 假阴性⇒enqueue 门 503
      // +巡检 P0；键前缀走 QueueKeys 默认参数不受影响——消费正常故单进程时代未暴露）。
      prefix: 'bull',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 * 7 },
      },
      // Y0c T30（Z98 四面之二/§0.6 偏离 40）：processor 注册门——@nestjs/bullmq BullExplorer 对本图
      // 每个 @Processor 无条件 new Worker（17 个消费面全装）；manualRegistration 使 BullRegistrar
      // onModuleInit 早退整个 register()（dist/bull.registrar.js:14-20 实证）。role=api⇒不建（api 进程
      // 零消费面=内存隔离+Z130/Z148② 侦测前提）；all⇒建（Z67① 降级单进程消费面保活）。
      // role 经 :46 validateEnv 单源（zod default='api'——漏设永不静默装配消费面，Z48 安全方向）。
      // worker.module 同款 forRoot 无此门（worker 进程恒注册——消费面本体）。
      extraOptions: { manualRegistration: env.COLLAB_ROLE === 'api' },
    }),
    // 批0c-8（B3 约束：首屏零 429）：全局抬至 300/min 安全带宽——原 10/min 会打死画布首屏
    // （一次画布打开即触发数十请求）。敏感端点（登录/付费任务）显式 @Throttle 收紧至 20/min。
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PrismaModule,
    HealthModule,
    ContentModule,
    HomeBannerModule,
    StylesModule,
    ProjectModule,
    TeamModule,
    CollabModule,
    AdminModule,
    CreditModule,
    // Y0c T25（Z42④/Z139）：模块拆分——Http 子模块（controllers）+Core（service+processor）双导入；
    // worker（T26）只装 Core（Z131 模块图闭包禁 Http 面）
    ExecutionCoreModule,
    ExecutionHttpModule,
    // Y0c T23（Z98）：守护与定时器装配面（IntentReconcileService 双 timer+temp-cleanup/
    // subscription-task repeatable）——register() 内读 COLLAB_ROLE 门控（api|all 装配/worker 空）。
    // 装饰器元数据求值在 :42 validateEnv() 之后⇒非法 role 已 fail-fast 先死，此处只见合法值
    ExecutionDaemonModule.register(),
    MinioModule,
    StorageModule,
    TemplateModule,
    FolderModule,
    CanvasModule,
    AuthModule,
    MediaModule,
    AiDownloadCoreModule,
    TempCleanupModule,
    MaterialLibraryModule,
    AiImageEditCoreModule,
    AiImageEditHttpModule,
    RechargeModule,
    MetricsCoreModule,
    MetricsHttpModule,
    StoryboardModule,
    SubscriptionModule,
    AdminSubscriptionModule,
    SubscriptionTaskModule,
    VideoProjectModule,
    VideoWorkModule,
  ],
  providers: [
    // 批0c-8：ThrottlerGuard 挂 APP_GUARD（此前 ThrottlerModule 注册但守卫从未生效）。
    // 注册在 AuthGuard 之前（边缘限流不依赖 req.user，未认证流量同样计数）。
    // Y0c T36 核销（原「部署前提 tech-debt：反代后 req.ip 全是代理 IP」注释失实）：trust proxy
    // 'loopback' 已落 main.ts:122——req.ip 吃 XFF 链右起首个非 loopback（真源键控非共享单桶；
    // Z14③ ThrottlerModule 通道与手写消费方同吃 req.ip 单源，语义锚 xff-trust-proxy.spec+runbook §3.8）。
    // Y0b-5 T1：TelemetryThrottlerGuard 子类——仅 /api/collab/telemetry 以 cookie 哈希分桶
    // （sendBeacon 唯一凭据面），其余路由回落 super（req.ip）行为不变；注册序由
    // telemetry.controller.spec 静态守卫锁死（限流先于鉴权——安全不变量禁调换）。
    { provide: APP_GUARD, useClass: TelemetryThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    // AdminGuard 必须注册在 AuthGuard 之后（Nest APP_GUARD 按注册顺序执行，否则 req.user 尚未挂载）
    { provide: APP_GUARD, useClass: AdminGuard },
    {
      provide: REDIS_CLIENT,   // 批3-2 B6：受管工厂（onApplicationShutdown duck-typing disconnect）
      useFactory: () => createManagedRedis(),
    },
  ],
})
export class AppModule {}
