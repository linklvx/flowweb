// Y0a-3（Z15）→Y0a-4（W23 换装完成）：drain 凭据独立——监控只读令牌（PROMETHEUS_TOKEN）≠停机权。
// COLLAB_ADMIN_TOKEN 未设：production fail-closed 403（不回退——v2 裁定 P16）；dev fail-open 维持（/metrics 同源）。
// ready 授权档视图（读 pending）仍认双 token——读视图非停机权。
// header 形态同 x-prometheus-token（deploy.sh 工具链统一）。
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class CollabAdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.COLLAB_ADMIN_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === 'development') return true;   // dev fail-open（/metrics 同源）
      throw new ForbiddenException('COLLAB_ADMIN_TOKEN 未设置——drain fail-closed（W23：独立停机令牌，runbook 先建令牌再部署）');
    }
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-prometheus-token'] === token) return true;
    throw new ForbiddenException('Forbidden');   // 令牌失配与 PrometheusAuthGuard 同形态
  }
}
