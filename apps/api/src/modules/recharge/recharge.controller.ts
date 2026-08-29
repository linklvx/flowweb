import { Controller, Post, Req, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { RechargeService } from './recharge.service';
import { NoTransform } from '../../common/decorators/no-transform.decorator';

@Controller('api/recharge')
@UseGuards(AuthGuard)
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
