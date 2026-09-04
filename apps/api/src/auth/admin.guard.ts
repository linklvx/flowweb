import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';

// isAdmin 不从 @flowweb/shared 值导入：该包是纯 TS 源码包（main→src/index.ts，barrel 无扩展名相对导入），
// Node 运行时 require 会 ERR_MODULE_NOT_FOUND（Vitest/Vite 可解析；api 侧仅 import type 安全，值导入会在启动时崩溃）。
// shared 中的同名导出仍供 web 侧（RequireAdmin）使用，谓词语义保持一字不差。
const isAdmin = (role: unknown): role is 'ADMIN' => role === 'ADMIN';

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // execution/payment WS gateway 走各自鉴权
    const req = context.switchToHttp().getRequest();
    // Express 路由大小写不敏感（caseSensitive 默认 false），大写变体可命中控制器绕过守卫，必须小写化对齐
    const path: string = (req.path ?? '').toLowerCase();
    const isAdminPath = path === '/api/admin' || path.startsWith('/api/admin/');
    if (!isAdminPath) return true;
    if (!req.user) throw new UnauthorizedException('未登录');
    if (!isAdmin(req.user?.role)) throw new ForbiddenException('需要管理员权限');
    return true;
  }
}
