import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { auth } from './auth';

const redis = new Redis({ host: 'localhost', port: 6379 });

@Injectable()
export class AuthService {
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
      await redis.set(`blacklist:rt:${sessionToken}`, '1', 'EX', ttl);
    }
    return auth.api.signOut({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const exists = await redis.exists(`blacklist:rt:${token}`);
    return exists === 1;
  }

  async updateProfile(userId: string, dto: { name?: string; image?: string }) {
    const { PrismaClient } = await import('@prisma/client');
    const p = new PrismaClient();
    try {
      const session = await p.session.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      await p.$disconnect();
      if (!session) throw new Error('No active session');
      return auth.api.updateUser({
        body: { name: dto.name, image: dto.image },
        headers: new Headers({ cookie: `flowweb.session_token=${session.token}` }),
      });
    } finally {
      await p.$disconnect();
    }
  }

  async getSession(headers: Record<string, string>) {
    // Direct DB lookup — bypasses Better Auth's getSession which fails in NestJS context
    const cookieStr = headers.cookie || '';
    const match = cookieStr.match(/flowweb\.session_token=([^;]+)/);
    if (!match) return null;
    const token = match[1];
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
