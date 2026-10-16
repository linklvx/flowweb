// apps/api/src/modules/collab/worker-write-auth.guard.ts
// Y0c T26（偏离 29/32）：worker 内部通道令牌守卫——WORKER_WRITE_TOKEN（Bearer 形态+timingSafeEqual）。
// 消费面：GET /api/collab/doc/:projectId/canvas（T26 读端点）+POST /api/collab/doc/write-batch
// （T27 写端点——模板复用）。语义与 COLLAB_ADMIN_TOKEN/PrometheusAuthGuard 同源：dev
// （NODE_ENV=development）未设 fail-open；production 未设 fail-closed 403；token 失配 403。
// T27 收口后主防线=进程拒启（env.ts envSchemaValidated superRefine：production 未设
// WORKER_WRITE_TOKEN 即拒启，api/worker 双进程同款）——本 guard 的 production 未设 403 分支为
// 纵深冗余保留（拒启层被绕过时的请求级兜底）。比较走 crypto.timingSafeEqual（等长前置守卫——
// 长度不等直接拒）。
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class WorkerWriteAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.WORKER_WRITE_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === 'development') return true;   // dev fail-open（COLLAB_ADMIN_TOKEN 同源）；T34（Z45②）canActivate 惰性读——写回后与 env.NODE_ENV 单源同答案
      throw new ForbiddenException('[CollabDoc] WORKER_WRITE_TOKEN must be configured in production（主防线=env 拒启，本分支纵深冗余）');
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
