// apps/api/src/di-smoke.int.spec.ts —— Y0b-1（Z22）：nest build 不解析 provider 图——循环依赖/缺注册只在运行时炸。
// int 套件（Redis 在位）+ overrideProvider 覆盖链上全部队列 token（BullQueue_<name> 纯名字寻址，configKey 不影响 token）。
// 环境重建：①MinioModule 工厂触发 validateEnv（MediaProcessModule→MinioModule @Global）——按 ci.yml:28-33 先例
// 注入假值（compile 不触发 onModuleInit=ensureBucket，零 MinIO 消费）；②EventEmitterModule.forRoot/
// MetricsModule（均 @Global，AppModule 专属导入面）——CollabGateway 等消费方的生产提供方。
process.env.MINIO_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.MINIO_ACCESS_KEY ??= 'it-di-smoke';
process.env.MINIO_SECRET_KEY ??= 'it-di-smoke-key';

import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect } from 'vitest';

// ExecutionModule/TeamModule 传递闭包上 BullModule.registerQueue 全集：
// execution.module 5 + team.module 3 + subscription.module 3（经 TeamModule forwardRef RechargeModule→SubscriptionModule）
const CHAIN_QUEUES = [
  'execution', 'ai-image-edit', 'ai-result-download', 'video-trim', 'video-separate',
  'team-media-cleanup', 'team-recharge-close-expired', 'team-recharge-active-query',
  'banner-cleanup', 'subscription-close-expired', 'subscription-payment-success',
].map(getQueueToken);

const stubQueue = { add: async () => {} };

const hasDb = !!process.env.DATABASE_URL;

(hasDb ? describe : describe.skip)('DI 图可编译（PricingResolver/CreditLedger/FundsGate 跨模块注册零循环）', () => {
  it('ExecutionModule+TeamModule compile（队列 provider 全覆盖+gate/ledger 可解析——T6 注册缺口运行时门禁）', async () => {
    const { ExecutionModule } = await import('./modules/execution/execution.module');
    const { TeamModule } = await import('./modules/team/team.module');
    const { MetricsModule } = await import('./metrics/metrics.module');
    const { PricingResolverService } = await import('./modules/execution/pricing-resolver.service');
    const { TeamFundsGateService } = await import('./modules/team/team-funds-gate.service');
    const { CreditLedgerService } = await import('./modules/team/credit-ledger.service');
    let builder = Test.createTestingModule({ imports: [EventEmitterModule.forRoot(), MetricsModule, ExecutionModule, TeamModule] });
    for (const token of CHAIN_QUEUES) builder = builder.overrideProvider(token).useValue(stubQueue);
    const moduleRef = await builder.compile();
    expect(moduleRef.get(PricingResolverService, { strict: false })).toBeTruthy();
    expect(moduleRef.get(TeamFundsGateService, { strict: false })).toBeTruthy();
    expect(moduleRef.get(CreditLedgerService, { strict: false })).toBeTruthy();
  }, 60000);

  it('AdminModule+ProjectModule+TemplateModule compile（消费侧跨模块注入）', async () => {
    // prom-client register 是进程级单例（生产=单 MetricsService 实例）——第二次 compile 模拟新进程，先清注册表。
    // 安全性前提：vitest 默认 isolate:true（文件级独立模块表）——clear 影响域被封在本文件内；若未来关 isolate
    // 此 clear 会静默反注册其他文件的模块级 Counter（inc 仍工作但不进 /metrics）——届时须改为子进程隔离（T7 质量审 M-3）
    const { register } = await import('prom-client');
    register.clear();
    const { AdminModule } = await import('./modules/admin/admin.module');
    const { ProjectModule } = await import('./modules/project/project.module');
    const { TemplateModule } = await import('./modules/template/template.module');
    const { MetricsModule } = await import('./metrics/metrics.module');
    const { TeamFundsGateService } = await import('./modules/team/team-funds-gate.service');
    let builder = Test.createTestingModule({ imports: [EventEmitterModule.forRoot(), MetricsModule, AdminModule, ProjectModule, TemplateModule] });
    for (const token of CHAIN_QUEUES) builder = builder.overrideProvider(token).useValue(stubQueue);
    const moduleRef = await builder.compile();
    expect(moduleRef.get(TeamFundsGateService, { strict: false })).toBeTruthy();
  }, 60000);
});
