import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { parseSessionToken } from '../common/utils/parse-session-token';

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
  '/metrics',
];

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path;
    const isPublic = PUBLIC_PREFIXES.some(p => path.startsWith(p));

    // Try to authenticate from session cookie (optional for public routes)
    const token = parseSessionToken(request.headers.cookie);
    if (token) {
      try {
        const { PrismaClient } = await import('@prisma/client');
        const p = new PrismaClient();
        try {
          const session = await p.session.findUnique({
            where: { token },
            include: { user: true },
          });
          if (session && session.expiresAt >= new Date()) {
            request.user = session.user;
          }
        } finally {
          await p.$disconnect();
        }
      } catch {
        // Silently fail for public routes
      }
    }

    if (isPublic || request.user) return true;
    throw new UnauthorizedException('Unauthorized');
  }
}
