import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { auth } from './auth';

const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/content',
  '/api/node-types',
  '/api/auth',
  '/api/announcements',
  '/api/pricing/calculate',
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

    // Verify session
    try {
      const session = await auth.api.getSession({
        headers: new Headers(request.headers as any),
      });
      if (!session) throw new UnauthorizedException('Unauthorized');
      request.user = session.user;
      return true;
    } catch {
      throw new UnauthorizedException('Unauthorized');
    }
  }
}
