// apps/api/src/metrics/metrics-http.module.ts
// Y0c T25（Z139）：Http 半=/metrics controller——worker 闭包禁入面（Z131 census ⑰）。
// MetricsCoreModule 显式导入：@Global 导出面在 worker（T26 只装 Core 不装本模块）不适用，
// api 侧本模块独立可测（不依赖 @Global 全局注册的隐式可达）。
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsCoreModule } from './metrics-core.module';

@Module({
  imports: [MetricsCoreModule],
  controllers: [MetricsController],
})
export class MetricsHttpModule {}
