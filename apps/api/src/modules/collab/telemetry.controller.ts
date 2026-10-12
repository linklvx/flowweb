// apps/api/src/modules/collab/telemetry.controller.ts
// Y0b-5 T1（spec §5.6）：POST /api/collab/telemetry——sendBeacon 唯一凭据面（cookie）。
// **一律 204**（@HttpCode(204)+@NoTransform）：sendBeacon 不可观测响应，4xx/413=客户端盲重试
// 风暴面；未知 type/超限/text/plain 空 body 全部 204（计数在 service）。
import { Controller, HttpCode, Inject, Injectable, Post, Req } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { NoTransform } from '../../common/decorators/no-transform.decorator';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { TelemetryService } from './telemetry.service';

const TELEMETRY_PATH = '/api/collab/telemetry';

/** Y0b-5 T1：限流桶 tracker 子类——仅 telemetry 路由以 cookie 哈希区分用户
 *  （req.headers.cookie 直接读+sha256(parseSessionToken)[0:16]，不依赖 req.user ⇒ 与
 *  APP_GUARD 顺序解耦，边缘限流先于鉴权的安全不变量保持；缺 cookie 回落 req.ip）。
 *  其余路由回落 super（=req.ip）——全站行为不变；替换 app.module 的 ThrottlerGuard 注册
 *  （cookie 键源失效模式〔guard 退化=静默全站单桶〕已发生过两次——注册序由 spec 静态守卫锁死）。 */
@Injectable()
export class TelemetryThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    if (req.path === TELEMETRY_PATH) {
      const token = parseSessionToken(req.headers?.cookie);
      if (token) return Promise.resolve(createHash('sha256').update(token).digest('hex').slice(0, 16));
    }
    return super.getTracker(req);
  }
}

@Controller('api/collab')
export class TelemetryController {
  constructor(@Inject(TelemetryService) private readonly telemetry: TelemetryService) {}

  @Post('telemetry')
  @HttpCode(204)
  @NoTransform()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })   // 独立桶（覆盖全局 300/min——sendBeacon 面专用容量）
  ingest(@Req() req: { body?: unknown }): void {
    this.telemetry.ingest(req.body);
  }
}
