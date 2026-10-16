// apps/api/src/module-split.spec.ts
// Y0c T25（Z42④/Z139）：Core/Http 模块拆分装配面断言——worker（T26 workerProviders）只装 Core 不带
// controller（Z131 模块图闭包 census ⑰ 前置）；api 侧 app.module=Http 子模块+Core 双导入。
// 静态元数据断言（pricing-coverage.controller.spec 同形态——Reflect decorator 运行时 metadata，
// 不 compile 不连线，零基础设施依赖；T23 execution-daemon.module.spec 的 register() 直读形态不适用
// 静态 @Module——元数据反射是本仓既有先例）。
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/db';
process.env.MINIO_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.MINIO_ACCESS_KEY ??= 'minioadmin';
process.env.MINIO_SECRET_KEY ??= 'minioadmin123';

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { MODULE_METADATA, GLOBAL_MODULE_METADATA } from '@nestjs/common/constants';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionCoreModule } from './modules/execution/execution-core.module';
import { ExecutionHttpModule } from './modules/execution/execution-http.module';
import { ExecutionService } from './modules/execution/execution.service';
import { ExecutionProcessor } from './modules/execution/execution.processor';
import { VideoTrimService } from './modules/execution/video-trim.service';
import { VideoSeparateService } from './modules/execution/video-separate.service';
import { IntentReconcileService } from './modules/execution/intent-reconcile.service';
import { EmitPort } from './modules/gateway/emit.port';
import { AiImageEditCoreModule } from './modules/ai-image-edit/ai-image-edit-core.module';
import { AiImageEditHttpModule } from './modules/ai-image-edit/ai-image-edit-http.module';
import { AiImageEditService } from './modules/ai-image-edit/ai-image-edit.service';
import { AiImageEditProcessor } from './modules/ai-image-edit/ai-image-edit.processor';
import { LightingService } from './modules/ai-image-edit/lighting/lighting.service';
import { LightingConsumer } from './modules/ai-image-edit/lighting/lighting.consumer';
import { GenerationIntentService } from './modules/execution/generation-intent.service';
import { AiImageEditController } from './modules/ai-image-edit/ai-image-edit.controller';
import { LightingController } from './modules/ai-image-edit/lighting/lighting.controller';
import { AiDownloadCoreModule } from './modules/ai-download/ai-download-core.module';
import { AiDownloadProcessor } from './modules/ai-download/ai-download.processor';
import { MetricsCoreModule } from './metrics/metrics-core.module';
import { MetricsHttpModule } from './metrics/metrics-http.module';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';

/** 模块类最小符号类型（T31 preflight 解阻：裸 Function 触 @typescript-eslint/no-unsafe-function-type——显式构造签名替换，纯类型面零行为变化） */
type ModuleClass = abstract new (...args: never[]) => unknown;
const meta = (key: string, mod: ModuleClass) => Reflect.getMetadata(key, mod) ?? [];
const controllersOf = (mod: ModuleClass) => meta(MODULE_METADATA.CONTROLLERS, mod);
const exportsOf = (mod: ModuleClass) => meta(MODULE_METADATA.EXPORTS, mod);
const importsOf = (mod: ModuleClass) => meta(MODULE_METADATA.IMPORTS, mod);

/** providers 符号面提取（TypeProvider 自身与 ClassProvider.provide 双形态——daemon spec 同款） */
function providerSymbols(mod: ModuleClass): unknown[] {
  return meta(MODULE_METADATA.PROVIDERS, mod).map((p: unknown) =>
    typeof p === 'function' ? p : (p as { provide?: unknown }).provide);
}

describe('Y0c T25 模块拆分（Z42④/Z139）——Execution Core/Http', () => {
  it('ExecutionCoreModule：零 controller；service+processor+EmitPort 工厂全在；不含 IntentReconcileService（归 DaemonModule——Z98）', () => {
    expect(controllersOf(ExecutionCoreModule)).toEqual([]);
    const syms = providerSymbols(ExecutionCoreModule);
    for (const s of [ExecutionService, ExecutionProcessor, VideoTrimService, VideoSeparateService, EmitPort]) {
      expect(syms, `providers 应含 ${s?.name}`).toContain(s);
    }
    expect(syms, 'IntentReconcileService 归 ExecutionDaemonModule（Z98——worker 装 Core 不得双倍回收钱）')
      .not.toContain(IntentReconcileService);
  });

  it('ExecutionCoreModule：exports 面=Http 子模块 controller 消费闭包（Video 两 service+BullModule 队列再导出）', () => {
    const exp = exportsOf(ExecutionCoreModule);
    for (const s of [ExecutionService, VideoTrimService, VideoSeparateService, EmitPort, GenerationIntentService, BullModule]) {
      expect(exp, `exports 应含 ${s?.name}`).toContain(s);
    }
  });

  it('ExecutionHttpModule：controllers 恰三（Execution/VideoTrim/VideoSeparate）+零 provider+imports 含 Core', () => {
    expect(controllersOf(ExecutionHttpModule)).toHaveLength(3);
    expect(providerSymbols(ExecutionHttpModule)).toEqual([]);
    expect(importsOf(ExecutionHttpModule)).toContain(ExecutionCoreModule);
  });
});

describe('Y0c T25 模块拆分——ai-image-edit Core/Http', () => {
  it('AiImageEditCoreModule：零 controller；processor/consumer/service 装配面+GenerationIntentService 导出（Http controller 消费）', () => {
    expect(controllersOf(AiImageEditCoreModule)).toEqual([]);
    const syms = providerSymbols(AiImageEditCoreModule);
    for (const s of [AiImageEditService, AiImageEditProcessor, LightingService, LightingConsumer, GenerationIntentService]) {
      expect(syms, `providers 应含 ${s?.name}`).toContain(s);
    }
    expect(exportsOf(AiImageEditCoreModule)).toContain(AiImageEditService);
    expect(exportsOf(AiImageEditCoreModule)).toContain(GenerationIntentService);
  });

  it('AiImageEditHttpModule：controllers 恰二（AiImageEdit/Lighting）+imports 含 Core', () => {
    expect(controllersOf(AiImageEditHttpModule)).toHaveLength(2);
    expect(controllersOf(AiImageEditHttpModule)).toContain(AiImageEditController);
    expect(controllersOf(AiImageEditHttpModule)).toContain(LightingController);
    expect(importsOf(AiImageEditHttpModule)).toContain(AiImageEditCoreModule);
  });
});

describe('Y0c T25 模块拆分——ai-download（无 controllers：Http 半空壳禁入，Core 单体即终态——偏离登记见报告）', () => {
  it('AiDownloadCoreModule：零 controller；providers 恰 [AiDownloadProcessor]', () => {
    expect(controllersOf(AiDownloadCoreModule)).toEqual([]);
    expect(providerSymbols(AiDownloadCoreModule)).toEqual([AiDownloadProcessor]);
  });
});

describe('Y0c T25 模块拆分——Metrics Core/Http（Z139：collectDefaultMetrics 唯一点=MetricsService 构造器，worker 也装 Core）', () => {
  it('MetricsCoreModule：保持 @Global+零 controller+providers/exports 恰 [MetricsService]', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, MetricsCoreModule)).toBe(true);
    expect(controllersOf(MetricsCoreModule)).toEqual([]);
    expect(providerSymbols(MetricsCoreModule)).toEqual([MetricsService]);
    expect(exportsOf(MetricsCoreModule)).toEqual([MetricsService]);
  });

  it('MetricsHttpModule：controllers 恰 [MetricsController]+imports 含 Core', () => {
    expect(controllersOf(MetricsHttpModule)).toEqual([MetricsController]);
    expect(importsOf(MetricsHttpModule)).toContain(MetricsCoreModule);
  });
});

describe('Y0c T25 模块拆分——app.module 导入面（Http 子模块+Core；旧聚合模块名清零）', () => {
  it('imports 含全部新模块且旧名（ExecutionModule/AiImageEditModule/AiDownloadModule/MetricsModule）零残留', async () => {
    const { AppModule } = await import('./app.module');   // 动态导入：validateEnv 在模块作用域（env 桩先行）
    const imports = importsOf(AppModule);
    for (const m of [ExecutionCoreModule, ExecutionHttpModule, AiImageEditCoreModule, AiImageEditHttpModule,
      AiDownloadCoreModule, MetricsCoreModule, MetricsHttpModule]) {
      expect(imports, `app.module imports 应含 ${m.name}`).toContain(m);
    }
    const legacy = imports.filter((m: any) =>
      ['ExecutionModule', 'AiImageEditModule', 'AiDownloadModule', 'MetricsModule'].includes(m?.name));
    expect(legacy).toEqual([]);
  });
});
