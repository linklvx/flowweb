import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { isAdmin } from '@flowweb/shared';

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // execution/payment WS gateway 走各自鉴权
    const req = context.switchToHttp().getRequest();
    const path: string = req.path ?? '';
    const isAdminPath = path === '/api/admin' || path.startsWith('/api/admin/');
    if (!isAdminPath) return true;
    if (!req.user) throw new UnauthorizedException('未登录');
    if (!isAdmin(req.user?.role)) throw new ForbiddenException('需要管理员权限');
    return true;
  }
}
