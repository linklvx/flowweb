import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';

const userRateLimit = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class ThrottleUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) return true;

    const now = Date.now();
    const key = userId;
    const entry = userRateLimit.get(key);

    if (!entry || now > entry.resetAt) {
      userRateLimit.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    const newCount = entry.count + 1;
    if (newCount > 3) {
      throw new BusinessException('RATE_LIMITED', '操作过于频繁，请稍后重试');
    }

    entry.count = newCount;
    return true;
  }
}
