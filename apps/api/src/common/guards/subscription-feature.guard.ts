import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const FEATURE_MESSAGES: Record<string, string> = {
  SUBSCRIPTION_ENABLED: '订阅功能未开放',
  SUBSCRIPTION_UPGRADE_ENABLED: '升级功能未开放',
  SUBSCRIPTION_ADMIN_GRANT_ENABLED: '积分发放功能未开放',
};

@Injectable()
export class SubscriptionFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.get<string>('feature', context.getHandler());
    if (!feature) return true;

    const enabled = process.env[feature];
    if (enabled === 'false') {
      throw new HttpException(
        FEATURE_MESSAGES[feature] ?? '功能未开放',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
