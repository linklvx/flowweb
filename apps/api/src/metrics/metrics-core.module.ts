// apps/api/src/metrics/metrics-core.module.ts
// Y0c T25（Z139 Metrics 拆分=模块拆分第 7 处）：Core 半=MetricsService——保持 @Global（worker 也装：
// collectDefaultMetrics() 全仓唯一调用点=MetricsService 构造器〔metrics.service.ts:15〕，worker 不装
// 则 3002 无 process_*/nodejs_* 族——Z134 的 event_loop_lag{role='worker'} 读数 null 与 0 不可区分；
// T26 workerProviders 显式含本模块+进程内恰一次）。Http 半=MetricsHttpModule（controller）。
import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsCoreModule {}
