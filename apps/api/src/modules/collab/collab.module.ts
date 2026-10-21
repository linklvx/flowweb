import { Module } from '@nestjs/common';
import { CollabGateway, resolveCollabDebounce } from './collab.gateway';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabPersistenceService } from './collab-persistence.service';
import { CollabDocRegistryService } from './collab-doc-registry.service';
import { CollabSessionGuardService } from './collab-session-guard.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabDocWriterService } from './collab-doc-writer.service';
import { CollabResidencyService } from './collab-residency.service';
import { CollabWritePort, DirectCollabWritePort } from './collab-write.port';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { CollabLeaseService } from './collab-lease.service';
import { CollabReadyController } from './collab-ready.controller';
import { CollabReadyService } from './collab-ready.service';
import { CollabDocController } from './collab-doc.controller';
import { CollabReadController } from './collab-read.controller';
import { CollabWriteController } from './collab-write.controller';
import { CollabMediaController } from './collab-media.controller';   // Y1a T11：replaceMedia/clearMedia 命令（用户写 fileId 必经命令——PG NodeArtifact CAS）
import { CollabShrinkService } from './collab-shrink.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { AuditService } from '../../common/audit/audit.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';
import { SessionService } from '../../auth/session.service';
import { TeamModule } from '../team/team.module';
import { CanvasModule } from '../canvas/canvas.module';   // Y0b-4 T9：CanvasService（export-fresh 副本创建）——单向依赖无环
import { WorkerPresenceModule } from '../worker-presence/worker-presence.module';   // Y0c T29-II（Z130②）：CollabReadyService workers 维度供数
import { ArtifactCoreModule } from '../artifact-core/artifact-core.module';   // Y1a T11：CollabMediaController 消费 NodeArtifactService/MediaRegistrationService（CAS+bindInTx）

@Module({
  imports: [TeamModule, CanvasModule, WorkerPresenceModule, ArtifactCoreModule],
  controllers: [CollabReadyController, CollabDocController, CollabReadController, CollabWriteController, TelemetryController, CollabMediaController],   // Y0a-3 T7（Z14）：providers 不注册路由——HTTP 面必须 controllers；Y0b-4 T8：shrink 端点；Y0b-5 T1：遥测端点；Y0c T26：worker 读端点（偏离 29）/T27：worker 写端点；Y1a T11：媒体命令端点
  providers: [
    // T34（Z45③）：三 token useValue→useFactory——useValue 实参在模块加载期求值（dotenv→validateEnv
    // 写回之前=Z79 违规面），useFactory 在 DI 解析期（NestFactory.create，恒在 main.ts validateEnv 后）
    // 求值⇒写回等价成立（resolveCollabDebounce 的 NODE_ENV/COLLAB_DEBOUNCE 读随之自然惰性化；
    // 同文件 REDIS_CLIENT useFactory :48 先例同款形态）
    { provide: 'COLLAB_PORT', useFactory: () => Number(process.env.COLLAB_PORT) || 3001 },
    { provide: 'COLLAB_DEBOUNCE', useFactory: () => resolveCollabDebounce() },   // 批3-4：dev 1000/prod 2000（env COLLAB_DEBOUNCE 可调；原 5000）
    { provide: 'COLLAB_TIMEOUT', useFactory: () => Number(process.env.COLLAB_TIMEOUT) || 30_000 },   // 批3-4：握手超时+检查周期双语义
    SessionService,   // 批3-3：gateway authenticate 走 touchWithReason（PrismaModule 全局可见）
    CollabGateway,
    CollabDocumentService,
    CollabResidencyService,   // Y0c T15（A2）：常驻会话单例——会话表/withSession 读写二分/releaseSessionFor 原语（Z59/Z109/Z111/Z113）
    CollabDocWriterService,   // Y0c T8：writeBatch 同事务组批写门面（execution.service 首个消费方；T13b 端口化前直注入）
    DirectCollabWritePort,   // Y0c T13b：写端口 Direct 形态（api 进程内直调 CollabDocumentService）
    { provide: CollabWritePort, useExisting: DirectCollabWritePort },   // Y0c T13b：端口令牌→Direct 形态（T24 补 Http 形态）
    CanvasDocUpdateRepository,
    CollabSpoolService,
    CollabLeaseService,   // Y0a-3 T5：PG 租约（gateway 构造参数 4——必填）
    CollabPgBreakerService,   // Y0b-5 T16：PG 熔断器（准入+store 短路——单例供 gateway/ready 同读）
    CollabPersistenceService,   // Y0c T40（B1）：Persistence 域 service（store/spool/drain/pending 单一所有者——gateway 尾参 @Optional 注入+bindHost 后置绑定；单例=与 gateway 自建路径同一 pgBreaker/repo/spool 实例面）
    CollabDocRegistryService,   // Y0c T41（W3a/B2）：DocRegistry 域 service（doc 生命周期账目单一所有者——truth/冻结族/真空代际/doc-status/stuck 账目/residency 释放入口〔RC1=B 组合持有〕；gateway 尾参 @Optional 注入+bindHost 后置绑定，B1 同款；单例=与 gateway 自建路径同一 repo/persistence/pgBreaker 实例面，quota 四值构造期 env 解析单点在 DR）
    CollabSessionGuardService,   // Y0c T41（W3b/B2）：SessionGuard 域 service（连接鉴权/限流/awareness 判定单一所有者——限流四桶/认证防线三层/连接寿命标识台账/awareness 归属双索引/writeFreeze 冻结层单源/heap 采样闸〔RC3〕/sweep 复验；gateway 尾参 @Optional 注入+bindHost 后置绑定，B1/W3a 同款；SG→DR 构造直引〔RC4 connected/RC2 老化清理〕，DR→SG 能力经 DR host 缝 gateway 侧转发 sg.*〔DR 文件两波零改动〕；单例=与 gateway 自建路径同一 sessionSvc/perm/pgBreaker/persistence/docRegistry 实例面）
    CollabReadyService,   // Y0a-3 T7：/api/ready 组装（G-4 九档+1s 单飞）
    CollabShrinkService,   // Y0b-4 T8：REST shrink（Q-G 影子预演/TOCTOU 同步段/信号量/thaw）
    TelemetryService,   // Y0b-5 T1：sendBeacon 遥测批次 ingest（一律 204——计数族在 store.metrics）
    AuditService,   // T5 递延至此——drain 审计消费（team/subscription module 直注册同款先例）
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis(process.env.REDIS_URL, {
      lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 1,
      retryStrategy: () => null, enableOfflineQueue: false,   // B11/Z10③：探针参数收紧
    }) },
  ],
  // Y0c T13b：exports += CollabWritePort（写端口面）。CollabDocumentService 既有 exports 原样保留——
  // Y0c T25 实况（偏离 21 处置）：跨模块 4 直注文件仍在（video-work.service〔readCanvasSnapshotCached
  // 快照域〕+execution/ai-image-edit/lighting 三 controller〔assertSyncAdmitted 的 readServerSV 读域〕）
  // ——断 exports 即解析红，维持 exports+本登记；收口归片 B 读端口化（读域 4 文件改道读端口/快照域服务
  // 后移除本行），shrink 模块内直注不受 exports 影响。
  exports: [CollabDocumentService, CollabDocWriterService, CollabWritePort, CollabResidencyService],   // Y0c T8：消费面逐步扩（T12 收编 shrink/intent-reconcile）；Y0c T15：residency 面导出（T16/T17 reaper/释放入口消费）
})
export class CollabModule {}
