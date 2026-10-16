import { Injectable, Inject } from '@nestjs/common';
import { getAuth } from './auth';   // T34：betterAuth 惰性单例（构造后移至首调用——env 读恒在 validateEnv 写回后）
import { parseSessionToken } from '../common/utils/parse-session-token';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  /** 批3-3：getSession 的手写 prisma.session.findUnique（每调用临时建 PrismaClient）统一走 SessionService.touch。 */
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async signIn(email: string, password: string) {
    return getAuth().api.signInEmail({ body: { email, password } });
  }

  async signUp(email: string, password: string, name: string) {
    return getAuth().api.signUpEmail({ body: { email, password, name } });
  }

  async signOut(sessionToken: string) {
    return getAuth().api.signOut({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
  }

  async phoneLogin(phoneNumber: string, code: string) {
    return getAuth().api.verifyPhoneNumber({
      body: {
        phoneNumber,
        code,
        updatePhoneNumber: false,
      },
    });
  }

  async updateProfile(cookieHeader: string, dto: { name?: string; image?: string }) {
    return getAuth().api.updateUser({
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
