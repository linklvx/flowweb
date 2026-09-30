import { Injectable } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 与 auth.ts better-auth 配置逐字对齐（session.expiresIn/updateAge）——改那边必须同步这边 */
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;   // expiresIn: 7d
const SESSION_UPDATE_AGE_MS = 24 * 3600 * 1000;   // updateAge: 1d

export type SessionWithUser = Session & { user: User };

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 单查询富结果：token 无效 vs 已过期的分型保留（collab.gateway 批3-1 reason 契约——
   *  unauthenticated/session-expired 两档客户端分流依赖此区分） */
  async resolve(token: string): Promise<{ session: SessionWithUser | null; expired: boolean }> {
    const session = await this.prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (!session) return { session: null, expired: false };
    if (session.expiresAt < new Date()) return { session: null, expired: true };   // 终态禁复活
    return { session, expired: false };
  }

  /** 批3-3：better-auth 式滑动续期——session 年龄 > updateAge(1d) 即续，expiresAt 顺延 7d。
   *  仅未过期能话（过期一律 null 终态禁复活、零写）；HTTP 路径 touch 后由 /api/auth/me 重发
   *  cookie（新 maxAge）——WS 路径只能 touch DB（cookie 靠画布页 15min me 探活——F8）。 */
  async touch(token: string): Promise<SessionWithUser | null> {
    const { session } = await this.resolve(token);
    if (!session) return null;
    return this.renewIfDue(token, session);
  }

  /** WS 鉴权面：touch 的分型版——同一次查询，null 的折叠原因由 expired 区分 */
  async touchWithReason(token: string): Promise<{ session: SessionWithUser | null; expired: boolean }> {
    const { session, expired } = await this.resolve(token);
    if (!session) return { session: null, expired };
    return { session: await this.renewIfDue(token, session), expired: false };
  }

  private async renewIfDue(token: string, session: SessionWithUser): Promise<SessionWithUser> {
    // createdAt 缺失（异常形状/旧数据）按 age=0 处理——不续期零写，安全侧
    const age = session.createdAt ? Date.now() - session.createdAt.getTime() : 0;
    if (age <= SESSION_UPDATE_AGE_MS) return session;
    return this.prisma.session.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      include: { user: true },
    });
  }
}
