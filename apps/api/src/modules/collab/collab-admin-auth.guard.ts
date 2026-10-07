// Y0a-3（Z15/W23）：drain 凭据独立——监控只读令牌（PROMETHEUS_TOKEN）≠停机权。COLLAB_ADMIN_TOKEN
// 未设时回退 PROMETHEUS_TOKEN（启动 WARN 标注回退态——Y0a-4 换独立令牌）；均未设=生产 fail-closed
//（dev fail-open 与 /metrics 同源先例）。header 形态同 x-prometheus-token（deploy.sh 工具链统一）。
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CollabAdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(CollabAdminAuthGuard.name);
  private warned = false;   // 回退 WARN 每 episode 一次（readonly 永不置位=每请求刷屏）
  canActivate(context: ExecutionContext): boolean {
    const admin = process.env.COLLAB_ADMIN_TOKEN;
    const token = admin ?? process.env.PROMETHEUS_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === 'development') return true;   // dev fail-open（/metrics 同源）
      throw new ForbiddenException('COLLAB_ADMIN_TOKEN/PROMETHEUS_TOKEN 均未设置——fail-closed');
    }
    if (!admin && !this.warned) {
      this.warned = true;
      this.logger.warn('COLLAB_ADMIN_TOKEN 未设——drain 回退 PROMETHEUS_TOKEN（监控令牌兼任停机权，Y0a-4 应换独立令牌）');
    }
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-prometheus-token'] === token) return true;
    throw new ForbiddenException('Forbidden');   // 令牌失配与 PrometheusAuthGuard 同形态
  }
}
