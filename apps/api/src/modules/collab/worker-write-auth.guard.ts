// apps/api/src/modules/collab/worker-write-auth.guard.ts
// Y0c T26（偏离 29/32）：worker 内部通道令牌守卫——WORKER_WRITE_TOKEN（Bearer 形态+timingSafeEqual）。
// 消费面：GET /api/collab/doc/:projectId/canvas（T26 读端点）+T27 POST write-batch（模板复用——
// production 拒启与 nginx 纵深同批收口）。语义与 COLLAB_ADMIN_TOKEN/PrometheusAuthGuard 同源：
// dev（NODE_ENV=development）未设 fail-open；production 未设 fail-closed 403（请求级——进程拒启归
// T27）；token 失配 403。比较走 crypto.timingSafeEqual（等长前置守卫——长度不等直接拒）。
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class WorkerWriteAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.WORKER_WRITE_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === 'development') return true;   // dev fail-open（COLLAB_ADMIN_TOKEN 同源）
      throw new ForbiddenException('[CollabDoc] WORKER_WRITE_TOKEN must be configured in production（T27 拒启形态同批收口）');
    }
    const req = context.switchToHttp().getRequest();
    const header: unknown = req.headers?.authorization;
    const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (provided && provided.length === token.length && timingSafeEqual(Buffer.from(provided), Buffer.from(token))) {
      return true;
    }
    throw new ForbiddenException('Forbidden');
  }
}
