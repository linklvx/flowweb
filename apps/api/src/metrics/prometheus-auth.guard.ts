import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class PrometheusAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.PROMETHEUS_TOKEN;
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
