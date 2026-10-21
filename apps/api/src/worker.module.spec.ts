// apps/api/src/worker.module.spec.ts
// Y0c T26：worker.module——平铺 provider 装配面（spec §0.6 偏离 30：Core 模块闭包带 controller
// 不可导入——census ⑰ 闭包执法驱动）+零 controller 结构断言+DI compile 冒烟+3000/3001 双
// ECONNREFUSED（构造性——Z101：createApplicationContext 仍实例化 controller，零的只是监听；
// 本模块零 controller+装配面无任何 listen 挂钩⇒进程零监听者）。
// 静态元数据断言形态=module-split.spec 同款（Reflect decorator 元数据，不 compile 不连线）；
// WorkerModule 动态导入（module-scope validateEnv 在模块作用域——env 桩先行，ESM import 提升会
// 抢跑桩——app.module 同款纪律）。
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/db';
process.env.MINIO_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.MINIO_ACCESS_KEY ??= 'minioadmin';
process.env.MINIO_SECRET_KEY ??= 'minioadmin123';

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
// 求值序锚（worker.module.ts 同款注释）：既有文件环 team-subscription ↔ team-recharge——下方
// processor 静态 import（AiDownloadProcessor→StorageQuotaService→TeamSubscriptionService）会先触发
// subscription 半边使 team-recharge 装饰元数据读未初始化绑定；先锚 recharge 半边（函数声明提升安全）。
import './modules/team/team-recharge.service';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { register } from 'prom-client';
import net from 'node:net';
// 17 processor 全集（grep @Processor 全仓清单——workerProviders 装配面对齐锚）
import { StitchConsumer } from './modules/storyboard/stitch.consumer';
import { AiDownloadProcessor } from './modules/ai-download/ai-download.processor';
import { AiImageEditProcessor } from './modules/ai-image-edit/ai-image-edit.processor';
import { LightingConsumer } from './modules/ai-image-edit/lighting/lighting.consumer';
import { ExecutionProcessor } from './modules/execution/execution.processor';
import { VideoTrimProcessor } from './modules/execution/video-trim.processor';
import { VideoSeparateProcessor } from './modules/execution/video-separate.processor';
import { GrantCreditProcessor } from './modules/subscription/task/grant-credit.processor';
import { PaymentSuccessProcessor } from './modules/subscription/task/payment-success.processor';
import { ExpireSubscriptionProcessor } from './modules/subscription/task/expire-subscription.processor';
import { DailyReconProcessor } from './modules/subscription/task/daily-recon.processor';
import { CloseExpiredSubOrderProcessor } from './modules/subscription/task/close-expired-sub-order.processor';
import { BannerCleanupProcessor } from './modules/subscription/task/banner-cleanup.processor';
import { ThumbnailGeneratorConsumer } from './modules/material-library/consumers/thumbnail-generator.consumer';
import { TempCleanupProcessor } from './modules/temp-cleanup/temp-cleanup.processor';
import { TeamMediaCleanupProcessor } from './modules/team/task/team-media-cleanup.processor';
import { TeamActiveQueryProcessor } from './modules/team/task/team-recharge-active-query.processor';
import { TeamCloseExpiredProcessor } from './modules/team/task/team-recharge-close-expired.processor';
// 关键服务+端口形态
import { ExecutionService } from './modules/execution/execution.service';
import { GenerationIntentService } from './modules/execution/generation-intent.service';
import { NodeArtifactService } from './modules/artifact-core/node-artifact.service';
import { MediaRegistrationService } from './modules/artifact-core/media-registration.service';
import { ArtifactCommitService } from './modules/artifact-core/artifact-commit.service';
import { TeamCreditService } from './modules/team/team-credit.service';
import { TeamRechargeService } from './modules/team/team-recharge.service';
import { StorageQuotaService } from './modules/team/storage-quota.service';
import { CreditLedgerService } from './modules/team/credit-ledger.service';
import { CollabWritePort, HttpCollabWritePort } from './modules/collab/collab-write.port';
import { HttpCollabDocWriter } from './modules/collab/collab-write.port';
import { CollabDocWriterService } from './modules/collab/collab-doc-writer.service';
import { EmitPort, WorkerEmitPort } from './modules/gateway/emit.port';
import { MetricsCoreModule } from './metrics/metrics-core.module';
import { PrismaModule } from './prisma/prisma.module';
import { MinioModule } from './modules/minio/minio.module';

/** 模块类最小符号类型（T31 preflight 解阻：裸 Function 触 @typescript-eslint/no-unsafe-function-type——显式构造签名替换，纯类型面零行为变化；module-split.spec 同款） */
type ModuleClass = abstract new (...args: never[]) => unknown;
const meta = (key: string, mod: ModuleClass) => Reflect.getMetadata(key, mod) ?? [];
const controllersOf = (mod: ModuleClass) => meta(MODULE_METADATA.CONTROLLERS, mod);
const importsOf = (mod: ModuleClass) => meta(MODULE_METADATA.IMPORTS, mod);
function providerSymbols(mod: ModuleClass): unknown[] {
  return meta(MODULE_METADATA.PROVIDERS, mod).map((p: unknown) =>
    typeof p === 'function' ? p : (p as { provide?: unknown }).provide);
}

const PROCESSORS = [
  StitchConsumer, AiDownloadProcessor, AiImageEditProcessor, LightingConsumer,
  ExecutionProcessor, VideoTrimProcessor, VideoSeparateProcessor,
  GrantCreditProcessor, PaymentSuccessProcessor, ExpireSubscriptionProcessor,
  DailyReconProcessor, CloseExpiredSubOrderProcessor, BannerCleanupProcessor,
  ThumbnailGeneratorConsumer, TempCleanupProcessor,
  TeamMediaCleanupProcessor, TeamActiveQueryProcessor, TeamCloseExpiredProcessor,
];

describe('Y0c T26 worker.module——结构面（Z131 闭包纯净的模块侧对偶）', () => {
  it('零 controller（createApplicationContext 零监听的必要非充分件——census ⑰ 闭包执法承担充分性）', async () => {
    const { WorkerModule } = await import('./worker.module');
    expect(controllersOf(WorkerModule)).toEqual([]);
  });

  it('imports 无 *HttpModule 且无 Controller 类（worker 不装 Http 面——Z131）', async () => {
    const { WorkerModule } = await import('./worker.module');
    const imports = importsOf(WorkerModule);
    expect(imports.filter((m: any) => typeof m?.name === 'string' && /HttpModule$/.test(m.name))).toEqual([]);
    expect(imports.filter((m: any) => typeof m === 'function' && meta(MODULE_METADATA.CONTROLLERS, m).length > 0)).toEqual([]);
    for (const m of [MetricsCoreModule, PrismaModule, MinioModule]) {
      expect(imports, `imports 应含 ${m.name}`).toContain(m);
    }
  });

  it('providers 含 17 processor 全集+execution/team 链关键服务+三令牌（CollabWritePort/CollabDocWriterService/EmitPort）', async () => {
    const { WorkerModule } = await import('./worker.module');
    const syms = providerSymbols(WorkerModule);
    for (const p of PROCESSORS) expect(syms, `providers 应含 ${p.name}`).toContain(p);
    for (const s of [ExecutionService, GenerationIntentService, TeamCreditService, TeamRechargeService, StorageQuotaService, CreditLedgerService]) {
      expect(syms, `providers 应含 ${s.name}`).toContain(s);
    }
    for (const t of [CollabWritePort, CollabDocWriterService, EmitPort]) {
      expect(syms, `providers 应含令牌 ${t.name}`).toContain(t);
    }
  });
});

describe('Y0c T26 worker.module——DI compile 冒烟（平铺装配缺注册即红）+端口形态', () => {
  it('全图可解析；CollabWritePort=Http 形态（baseUrl/token 工厂注入）、EmitPort=WorkerEmitPort、CollabDocWriterService=HttpCollabDocWriter', async () => {
    const { WorkerModule } = await import('./worker.module');
    const stubQueue = { add: async () => {} };
    let builder = Test.createTestingModule({ imports: [WorkerModule] });
    // worker 图内 @InjectQueue 消费面（registerQueue 名全集——processor 的 Worker 创建不依赖注册）
    for (const name of ['ai-result-download', 'video-trim', 'video-separate', 'subscription-close-expired', 'team-recharge-close-expired']) {
      builder = builder.overrideProvider(getQueueToken(name)).useValue(stubQueue);
    }
    const moduleRef = await builder.compile();
    expect(moduleRef.get(ExecutionProcessor, { strict: false })).toBeInstanceOf(ExecutionProcessor);
    // Y1a T10：shared artifact-core 双 role DI——worker 是 ArtifactCommit 真实调用方（生产 API
    // manualRegistration:true 不消费队列）：三服务必须可解析（缺注册即 compile 红——DI 冒烟承担）。
    expect(moduleRef.get(ArtifactCommitService, { strict: false })).toBeInstanceOf(ArtifactCommitService);
    expect(moduleRef.get(NodeArtifactService, { strict: false })).toBeInstanceOf(NodeArtifactService);
    expect(moduleRef.get(MediaRegistrationService, { strict: false })).toBeInstanceOf(MediaRegistrationService);
    expect(moduleRef.get(AiImageEditProcessor, { strict: false })).toBeInstanceOf(AiImageEditProcessor);
    expect(moduleRef.get(AiDownloadProcessor, { strict: false })).toBeInstanceOf(AiDownloadProcessor);
    const port = moduleRef.get(CollabWritePort, { strict: false });
    expect(port).toBeInstanceOf(HttpCollabWritePort);
    expect((port as unknown as { baseUrl: string }).baseUrl).toBe(`http://127.0.0.1:${process.env.PORT ?? '3000'}`);
    expect(moduleRef.get(EmitPort, { strict: false })).toBeInstanceOf(WorkerEmitPort);
    expect(moduleRef.get(CollabDocWriterService, { strict: false })).toBeInstanceOf(HttpCollabDocWriter);
  }, 60000);

  it('双 ECONNREFUSED（构造性——Z101 措辞修正：装配后 3000/3001 均无监听者）', async () => {
    register.clear();   // di-smoke 同款：第二次 compile 模拟新进程——collectDefaultMetrics 重注册先清表
    const { WorkerModule } = await import('./worker.module');
    const stubQueue = { add: async () => {} };
    let builder = Test.createTestingModule({ imports: [WorkerModule] });
    for (const name of ['ai-result-download', 'video-trim', 'video-separate', 'subscription-close-expired', 'team-recharge-close-expired']) {
      builder = builder.overrideProvider(getQueueToken(name)).useValue(stubQueue);
    }
    await builder.compile();
    const probe = (port: number) => new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const s = net.connect({ port, host: '127.0.0.1' });
      s.once('error', (e: NodeJS.ErrnoException) => { s.destroy(); resolve(e); });
      s.once('connect', () => { s.destroy(); resolve(null); });
    });
    for (const port of [3000, 3001]) {
      const err = await probe(port);
      expect(err?.code, `端口 ${port} 应 ECONNREFUSED（worker 零监听——构造性）`).toBe('ECONNREFUSED');
    }
  }, 60000);
});
