import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class PrometheusAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.PROMETHEUS_TOKEN;
    // T34（Z45②）：canActivate 惰性读（非 DI 上下文合规形态）——validateEnv 写回后 process.env.NODE_ENV ≡ env.NODE_ENV 单源同答案
    const isDev = process.env.NODE_ENV === 'development';

    // Development: allow without token
    if (!token && isDev) return true;

    // Production (or no NODE_ENV): token is mandatory
    if (!token) {
      throw new ForbiddenException('[Metrics] PROMETHEUS_TOKEN must be configured in production');
    }

    const request = context.switchToHttp().getRequest();
    const providedToken = request.headers['x-prometheus-token'];

    if (providedToken === token) return true;
    throw new ForbiddenException('Forbidden');
  }
}
