import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../../modules/team/credit-ledger.service';
import { SESSION_COOKIE_OPTIONS } from '../auth';
import { bootstrapPersonalTeam } from '../../modules/team/team.bootstrap';

const WECHAT_API_BASE = 'https://api.weixin.qq.com';

@Injectable()
export class WechatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
  ) {}

  async getAccessToken(code: string) {
    const data = await this.getJson('/sns/oauth2/access_token', {
      appid: process.env.WECHAT_APP_ID || '',
      secret: process.env.WECHAT_APP_SECRET || '',
      code,
      grant_type: 'authorization_code',
    });
    if (data.errcode) {
      throw new Error(`WeChat access_token error: ${data.errcode} ${data.errmsg}`);
    }
    return {
      openid: data.openid,
      unionid: data.unionid,
      accessToken: data.access_token,
    };
  }

  async getUserInfo(accessToken: string, openid: string) {
    const data = await this.getJson('/sns/userinfo', {
      access_token: accessToken,
      openid,
      lang: 'zh_CN',
    });
    if (data.errcode) {
      throw new Error(`WeChat userinfo error: ${data.errcode} ${data.errmsg}`);
    }
    return {
      nickname: data.nickname,
      headimgurl: data.headimgurl,
    };
  }

  async findOrCreateUser(input: {
    openid: string;
    unionid?: string | null;
    nickname: string;
    headimgurl?: string | null;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { wechatOpenid: input.openid },
    });
    if (existing) return existing;

    const email = `wechat_${Buffer.from(input.openid).toString('base64url')}@wechat.flowweb.local`;
    const user = await this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name: input.nickname,
        email,
        emailVerified: false,
        image: input.headimgurl ?? undefined,
        wechatOpenid: input.openid,
        wechatUnionid: input.unionid ?? undefined,
      },
    });

    // 微信直连 prisma.create 绕过 better-auth 钩子，此处是唯一 bootstrap 入口
    await bootstrapPersonalTeam(this.prisma as any, this.ledger, user.id, user.name ?? '用户');

    return user;
  }

  async createSession(userId: string) {
    const token = this.generateToken(32);
    const session = await this.prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        token,
        expiresAt: new Date(Date.now() + SESSION_COOKIE_OPTIONS.maxAge),
        ipAddress: '',
        userAgent: '',
      },
    });
    return { token: session.token };
  }

  private async getJson(path: string, params: Record<string, string>, retries = 1) {
    let lastError: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await axios.get(`${WECHAT_API_BASE}${path}`, { params, timeout: 5000 });
        return res.data;
      } catch (err) {
        lastError = err;
        if (i < retries) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
        }
      }
    }
    throw lastError;
  }

  private generateToken(size: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(size);
    let result = '';
    for (let i = 0; i < size; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }
}
