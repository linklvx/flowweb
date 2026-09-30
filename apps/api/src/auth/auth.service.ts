import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { auth } from './auth';
import { parseSessionToken } from '../common/utils/parse-session-token';
import { REDIS_CLIENT } from '../common/redis/managed-redis';

@Injectable()
export class AuthService {
  /** 批3-2 B6：拔除硬编码 localhost 直连 Redis——注入本模块受管 REDIS_CLIENT
   *  （env.REDIS_URL + onApplicationShutdown 收口，本机无 Redis 的环境不再隐性连 localhost） */
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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
    try {
      const { PrismaClient } = await import('@prisma/client');
      const p = new PrismaClient();
      const session = await p.session.findUnique({
        where: { token },
        include: { user: true },
      });
      await p.$disconnect();
      if (!session || session.expiresAt < new Date()) return null;
      return { user: session.user };
    } finally {
      // ensure disconnect
    }
  }
}
