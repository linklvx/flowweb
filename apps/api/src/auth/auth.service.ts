import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { auth } from './auth';
import { parseSessionToken } from '../common/utils/parse-session-token';
import { REDIS_CLIENT } from '../common/redis/managed-redis';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  /** 批3-2 B6：拔除硬编码 localhost 直连 Redis——注入本模块受管 REDIS_CLIENT
   *  （env.REDIS_URL + onApplicationShutdown 收口，本机无 Redis 的环境不再隐性连 localhost）。
   *  批3-3：getSession 的手写 prisma.session.findUnique（每调用临时建 PrismaClient）统一走 SessionService.touch。 */
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async signIn(email: string, password: string) {
    return auth.api.signInEmail({ body: { email, password } });
  }

  async signUp(email: string, password: string, name: string) {
    return auth.api.signUpEmail({ body: { email, password, name } });
  }

  async signOut(sessionToken: string) {
    return auth.api.signOut({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
  }

  async signOutWithBlacklist(sessionToken: string) {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
    if (session?.session?.expiresAt) {
      const ttl = Math.max(1, Math.floor(
        (new Date(session.session.expiresAt).getTime() - Date.now()) / 1000
      ));
      await this.redis.set(`blacklist:rt:${sessionToken}`, '1', 'EX', ttl);
    }
    return auth.api.signOut({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const exists = await this.redis.exists(`blacklist:rt:${token}`);
    return exists === 1;
  }

  async phoneLogin(phoneNumber: string, code: string) {
    return auth.api.verifyPhoneNumber({
      body: {
        phoneNumber,
        code,
        updatePhoneNumber: false,
      },
    });
  }

  async updateProfile(cookieHeader: string, dto: { name?: string; image?: string }) {
    return auth.api.updateUser({
      body: { name: dto.name, image: dto.image },
      headers: new Headers({ cookie: cookieHeader }),
    });
  }

  async getSession(headers: Record<string, string>) {
    // Direct DB lookup — bypasses Better Auth's getSession which fails in NestJS context
    const token = parseSessionToken(headers.cookie);
    if (!token) return null;
    const session = await this.sessions.touch(token);   // 批3-3：touch（无效/过期→null，age>1d 顺带续期）
    return session ? { user: session.user } : null;
  }
}
