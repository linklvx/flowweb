import { Controller, Post, Req, Inject } from '@nestjs/common';
import { RechargeService } from './recharge.service';
import { NoTransform } from '../../common/decorators/no-transform.decorator';

// 批7 gate 真启动取证：同 media.controller——类级 AuthGuard 注册随批3-3 SessionService 依赖炸启动，
// 全局 APP_GUARD 已覆盖（notify 回调在 PUBLIC_PREFIXES 由 guard 自身放行）
@Controller('api/recharge')
export class RechargeController {
  constructor(@Inject(RechargeService) private readonly service: RechargeService) {}

  // 唯一回调路由：按 out_trade_no 前缀分发（SUB→订阅 / TEAM→团队 / 未知→FAIL）
  @Post('notify/wechat')
  @NoTransform()
  async notify(@Req() req: any) {
    try {
      const result = await this.service.handleCallback(
        req.headers || {},
        req.rawBody || Buffer.from(JSON.stringify(req.body || {})),
      );
      return result;
    } catch (err) {
      return { code: 'FAIL', message: (err as Error).message };
    }
  }
}
