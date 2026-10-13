import { Controller, Get, Inject } from '@nestjs/common';
import { PricingService } from './pricing.service';

/** Y0b-5 T14（Y0b-1 移交收口）：GET /api/admin/pricing/coverage——admin 定价页红标数据源。
 *  守卫=全局 AdminGuard（APP_GUARD 按 /api/admin/* 路径前缀承载——intent.controller 同款先例，
 *  浏览器拿不到 prometheus token 故红标必须走 admin 端点）；判据=PricingService.coverage()
 *  （与 check-pricing-coverage.mjs 同源表驱动）。ready 布尔不因 coverage 翻转——deploy gate 不受
 *  pricing 缺失影响（脚本载体归 verify/preflight 链）。 */
@Controller('api/admin/pricing')
export class PricingCoverageController {
  constructor(@Inject(PricingService) private readonly service: PricingService) {}

  @Get('coverage')
  coverage() {
    return this.service.coverage();
  }
}
