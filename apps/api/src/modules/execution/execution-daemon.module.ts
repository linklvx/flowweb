// apps/api/src/modules/execution/execution-daemon.module.ts
import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IntentReconcileService } from './intent-reconcile.service';
import { EXECUTION_QUEUE_NAME, EXECUTION_CONNECTION_NAME } from './execution.constants';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit/ai-image-edit.constants';
import { TempCleanupSchedulerService } from '../temp-cleanup/temp-cleanup.scheduler.service';
import { TEMP_CLEANUP_QUEUE_NAME } from '../temp-cleanup/temp-cleanup.constants';
import { SubscriptionSchedulerService } from '../subscription/task/subscription-scheduler.service';
import { COLLAB_ROLE_DEFAULT } from '../../config/env';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

/** Y0c T23（Z98）：COLLAB_ROLE 角色门第四面「守护与定时器装配」——ExecutionDaemonModule。
 *  收编 Z98 点名三样：IntentReconcileService（onModuleInit 双 timer——5min verifyActive 含
 *  rollbackRunning/settleStranded 资金操作+24h reconcileDaily）+temp-cleanup/subscription-task
 *  repeatable 注册（两 scheduler 的 onModuleInit getRepeatableJobs/add）。worker 装配即
 *  双进程双倍回收钱（P0-3）——「reconcile 只在 api 进程」由本模块从口头前提变结构约束。
 *  仅 role=api｜all 装配（all=本地单进程形态，Z67①）；processor 注册门（四面之二）已落 T30
 *  （app.module forRoot extraOptions.manualRegistration 按 role——§0.6 偏离 40）。
 *
 *  形态=动态模块 register（自选依据：ES import 无法条件化、@nestjs/common 无内建
 *  ConditionalModule；register 方法体内读 env=collab.module useFactory 族同款容器装配期
 *  形态——census ㉒ 标 method 非模块级 const，Z79 边界①同款）。
 *  门控=正向白名单 role==='api'||role==='all'（任务断言形态）；未设读值 fallback
 *  COLLAB_ROLE_DEFAULT='api'（单源常量——zod default 与此共用，防双源 P3）⇒ 漏设永不
 *  静默丢守护（Z48 安全方向的安全反向）。 */
@Module({})
export class ExecutionDaemonModule {
  static register(): DynamicModule {
    const role = process.env.COLLAB_ROLE ?? COLLAB_ROLE_DEFAULT;
    if (role !== 'api' && role !== 'all') {
      // worker：providers/imports 全空——零 daemon 实例化（零 timer+零 repeatable 注册），
      // 且不拖 CollabModule（worker 面纯净——T25 census 组⑰ 的前置）
      return { module: ExecutionDaemonModule, imports: [], providers: [] };
    }
    return {
      module: ExecutionDaemonModule,
      imports: [
        CollabModule,   // CollabWritePort/CollabDocWriterService（reconcile 修复写直调 DocWriter——留 api 的归属依据）
        TeamModule,     // CreditLedgerService/TeamCreditService（资金冲销面）
        BullModule.registerQueue({
          name: EXECUTION_QUEUE_NAME,
          configKey: EXECUTION_CONNECTION_NAME,
        }),
        // 批0.5-8b 语义随迁：IntentReconcileService A 路径按 kind 路由查 ai-image-edit 队列
        BullModule.registerQueue({ name: AI_IMAGE_EDIT_QUEUE_NAME }),
        BullModule.registerQueue({ name: TEMP_CLEANUP_QUEUE_NAME }),
        // F1 语义随迁（评审）：bullmq addJob 以 {...jobsOpts, ...opts} 合并——注册不带 defaultJobOptions
        // 会使两 repeatable 扫描 attempts 静默 3→1（原 SubscriptionTaskModule 注册形态对照）
        BullModule.registerQueue({ name: 'subscription-expire', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } } }),
        BullModule.registerQueue({ name: 'subscription-grant-credit', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } } }),
      ],
      providers: [
        IntentReconcileService,
        TempCleanupSchedulerService,
        SubscriptionSchedulerService,
        // 受管工厂（批3-2 B6）：IntentReconcileService @Inject('REDIS_CLIENT')——与 auth/media/
        // execution 等模块各自 provide 的既有形态一致（模块作用域一连接，managed-redis.ts:4 注释自证）
        { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },
      ],
    };
  }
}
