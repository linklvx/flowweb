import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/content',
  '/api/node-types',
  '/api/auth',
  '/api/announcements',
  '/api/pricing/calculate',
  '/api/subscription',
];

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path;

    // Allow public routes
    if (PUBLIC_PREFIXES.some(p => path.startsWith(p))) {
      return true;
    }

    // Parse session token from cookie
    const cookieStr: string = request.headers.cookie || '';
    const match = cookieStr.match(/flowweb\.session_token=([^;]+)/);
    if (!match) throw new UnauthorizedException('Unauthorized');

    const token = match[1];

    // Direct DB lookup — bypasses Better Auth's getSession which fails in NestJS
    try {
      const { PrismaClient } = await import('@prisma/client');
      const p = new PrismaClient();
      try {
        const session = await p.session.findUnique({
          where: { token },
          include: { user: true },
        });
        if (!session || session.expiresAt < new Date()) {
          throw new UnauthorizedException('Unauthorized');
        }
        request.user = session.user;
        return true;
      } finally {
        await p.$disconnect();
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Unauthorized');
    }
  }
}
