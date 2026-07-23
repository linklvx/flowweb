import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/content',
  '/api/node-types',
  '/api/auth',
  '/api/announcements',
  '/api/pricing/calculate',
  '/api/subscription',
  '/api/media/by-key',
];

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path;
    const isPublic = PUBLIC_PREFIXES.some(p => path.startsWith(p));

    // Try to authenticate from session cookie (optional for public routes)
    const cookieStr: string = request.headers.cookie || '';
    const match = cookieStr.match(/flowweb\.session_token=([^;]+)/);
    if (match) {
      try {
        const { PrismaClient } = await import('@prisma/client');
        const p = new PrismaClient();
        try {
          const session = await p.session.findUnique({
            where: { token: match[1] },
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
