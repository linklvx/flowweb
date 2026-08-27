import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import { phoneNumber } from 'better-auth/plugins';
import Redis from 'ioredis';
import { LUA_VERIFY_OTP } from '../common/services/lua-scripts';
import { maskPhone } from '../common/utils/mask-phone';
import { DEFAULT_FOLDER_NAMES } from '../modules/material-library/constants/material-library.constants';

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
          // 注册即建默认团队（与 TeamService.ensureDefaultTeam 同逻辑；auth 在 DI 外，直写防循环依赖）
          try {
            const existing = await prisma.team.findFirst({ where: { ownerId: user.id } });
            if (existing) return;
            await prisma.$transaction(async (tx) => {
              const team = await tx.team.create({
                data: { name: `${user.name}的团队`, ownerId: user.id, status: 'ACTIVE' },
              });
              await tx.teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'OWNER' } });
              await tx.teamBalance.create({ data: { teamId: team.id, credits: 100 } });
              await tx.teamCreditTransaction.create({
                data: {
                  teamId: team.id,
                  operatorUserId: user.id,
                  amount: 100,
                  type: 'register_grant',
                  creditType: 'regular',
                  balanceAfter: 100,
                },
              });
            });
          } catch (err) {
            console.error(`[databaseHooks] default team creation failed for ${user.id}`, err);
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
      callbackOnVerification: async ({ phoneNumber, user }) => {
        if (!user?.id) {
          console.warn(`[callbackOnVerification] user null for ${maskPhone(phoneNumber)}`);
          return;
        }
        try {
          const existing = await prisma.materialFolder.count({ where: { userId: user.id } });
          if (existing === 0) {
            await prisma.materialFolder.createMany({
              data: DEFAULT_FOLDER_NAMES.map((name, i) => ({
                name, userId: user.id, isDefault: true, sortOrder: i,
              })),
            });
          }
        } catch (err) {
          console.error(`[callbackOnVerification] folder creation failed for ${user.id}`, err);
        }
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
