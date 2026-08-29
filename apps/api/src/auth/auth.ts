import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import { phoneNumber } from 'better-auth/plugins';
import Redis from 'ioredis';
import * as Sentry from '@sentry/nestjs';
import { LUA_VERIFY_OTP } from '../common/services/lua-scripts';
import { bootstrapPersonalTeam } from '../modules/team/team.bootstrap';

const prisma = new PrismaClient();

const trustedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl); // 顶层单例，不复用项目 REDIS_CLIENT（auth.ts 在 DI 容器外）

/** 纯函数：Lua 原子校验 OTP（复用顶层 Redis 单例） */
async function luaVerifyOtp(phoneNumber: string, code: string): Promise<boolean> {
  const keys = [
    `sms:{${phoneNumber}}:code`,
    `sms:{${phoneNumber}}:errors`,
    `sms:{${phoneNumber}}:last_error`,
  ];
  const result = await redis.eval(LUA_VERIFY_OTP, keys.length, ...keys, code, '5');
  return result === 0;
}

/**
 * 统一 Session Cookie 配置，供 Controller 层手动 Set-Cookie 使用。
 * ⚠️ 强约束: maxAge 必须与下方 session.expiresIn (7d) 完全对齐，
 * 修改 session.expiresIn 时必须同步更新此处 maxAge。
 * 两个值从不同维度描述同一会话生命周期，不一致会导致提前过期或孤儿 Cookie。
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // = session.expiresIn (7 days), 必须同步修改
};

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // 统一 Bootstrap：唯一建团入口（含默认素材文件夹），判据 ownerId+isDefault
          try {
            await bootstrapPersonalTeam(prisma, user.id, user.name);
          } catch (err) {
            console.error(`[databaseHooks] personal team bootstrap failed for ${user.id}`, err);
            Sentry.captureException(err);
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    phoneNumber({
      sendOTP: async () => { /* no-op: SMS 在 Controller 发送 */ },
      verifyOTP: async ({ phoneNumber, code }) => {
        return luaVerifyOtp(phoneNumber, code);
      },
      signUpOnVerification: {
        getTempEmail: (phone) =>
          `phone_${Buffer.from(phone).toString('base64url')}@sms.flowweb.local`,
        getTempName: (phone) => phone.slice(-4),
      },
      phoneNumberValidator: (phone) => /^\+86\d{11}$/.test(phone),
    }),
  ],
  advanced: {
    cookiePrefix: 'flowweb',
    useArgon2id: true,
  },
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
  trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
});
