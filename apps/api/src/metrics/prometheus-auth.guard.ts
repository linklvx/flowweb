import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class PrometheusAuthGuard implements CanActivate {
  private readonly token: string | undefined = process.env.PROMETHEUS_TOKEN;

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) return true;

    const request = context.switchToHttp().getRequest();
    const providedToken = request.headers['x-prometheus-token'];

    if (providedToken === this.token) return true;
    throw new ForbiddenException('Forbidden');
  }
}
