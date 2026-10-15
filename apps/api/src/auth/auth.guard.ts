import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ServiceUnavailableException, Inject } from '@nestjs/common';
import { parseSessionToken } from '../common/utils/parse-session-token';
import { SessionService } from './session.service';

const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/content',
  '/api/node-types',
  '/api/auth',
  '/api/announcements',
  '/api/home-banners',
  '/api/pricing/calculate',
  '/api/subscription',
  '/api/media/by-key',
  '/api/video-works',   // D4：前缀放行 + handler 自守，clone/like 在 handler 内验 req.user
  '/api/recharge/notify',
  '/api/ready',    // Y0a-3：就绪探针（PUBLIC+@SkipThrottle——503 判据=PG+租约+collabState，Redis 仅报）
  '/api/drain',    // Y0a-3：部署链停写入口（PUBLIC 放行 AuthGuard，CollabAdminAuthGuard 把关）
  '/metrics',
];

/** Y0c T26（偏离 32）：worker 读端点精确放行谓词——GET ^/api/collab/doc/[^/]+/canvas$。
 *  不进 PUBLIC_PREFIXES（前缀 startsWith 会连 ':projectId/shrink|export-fresh|vacuum' 用户面一起
 *  放行）；/api/drain 同构=会话面放行+专守卫（WorkerWriteAuthGuard）把关。 */
const WORKER_CANVAS_READ_RE = /^\/api\/collab\/doc\/[^/]+\/canvas$/;
const isWorkerCanvasRead = (method: unknown, path: string): boolean =>
  method === 'GET' && WORKER_CANVAS_READ_RE.test(path);

/** Y0c T27：worker 写端点精确放行谓词——POST /api/collab/doc/write-batch 静态路径全等
 *  （无 :projectId 段无需 regex；同批 GET canvas 谓词的精确匹配形态——偏离 32 对齐）。 */
const isWorkerWriteBatch = (method: unknown, path: string): boolean =>
  method === 'POST' && path === '/api/collab/doc/write-batch';

/** 批3-3：session 查询统一走 SessionService.touch（单例 PrismaService——原实现每请求临时建
 *  PrismaClient 再断开的连接风暴收口）；DB 异常不再吞成 401（protected 路径 503——DB 抖动不是
 *  "请登录"），public 路径维持静默放行（公共面可用性不受 DB 抖动影响）。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path;
    const isPublic = PUBLIC_PREFIXES.some(p => path.startsWith(p))
      || isWorkerCanvasRead(request.method, path)   // Y0c T26：worker 读端点（token 守卫在专 guard）
      || isWorkerWriteBatch(request.method, path);   // Y0c T27：worker 写端点（WorkerWriteAuthGuard 把关）

    // Try to authenticate from session cookie (optional for public routes)
    const token = parseSessionToken(request.headers.cookie);
    if (token) {
      try {
        const session = await this.sessions.touch(token);
        if (session) {
          request.user = session.user;
        }
      } catch {
        if (!isPublic) throw new ServiceUnavailableException('数据库暂不可用，请稍后重试');
        // Silently fail for public routes
      }
    }

    if (isPublic || request.user) return true;
    throw new UnauthorizedException('Unauthorized');
  }
}
