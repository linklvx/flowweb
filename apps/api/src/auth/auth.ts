import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import { phoneNumber } from 'better-auth/plugins';
import * as Sentry from '@sentry/nestjs';
import { LUA_VERIFY_OTP } from '../common/services/lua-scripts';
import { bootstrapPersonalTeam } from '../modules/team/team.bootstrap';
import { CreditLedgerService } from '../modules/team/credit-ledger.service';
import { createManagedRedis, type ManagedRedis } from '../common/redis/managed-redis';
import { resolveSecureTransport } from '../config/env';   // T35（Z13）：secure 判据单点——禁第二处判断

/** Y0a-4/E46：模块级 PrismaClient 纳管（authRedis 同款受管形态）——AuthModule.onApplicationShutdown 断开 */
export const authPrisma = new PrismaClient();

/** Y0b-1（Z23）：bootstrapPersonalTeam 显式 ledger 参数——auth.ts 非 DI 上下文，模块级构造（CreditLedgerService 无状态仅包 prisma） */
export const authLedger = new CreditLedgerService(authPrisma as any);

// ===== Y0c T34（Z12/Z79/RC3）：模块加载期 env 读惰性化 =====
// 原模块级 const 四点（trustedOrigins=CORS_ORIGIN / redisUrl=REDIS_URL /
// SESSION_COOKIE_OPTIONS.secure=NODE_ENV / betterAuth baseURL=BETTER_AUTH_URL）在 import 期求值——
// 先于 dotenv→validateEnv 写回（CJS require 序：auth.ts 随 app.module import 树求值，validateEnv
// 在 app.module 模块体/请求期才跑），NODE_ENV 未设档读到 undefined。改惰性单例/函数：调用期求值
// 恒在 validateEnv 之后（DI 装配/请求时序），process.env.NODE_ENV 写回（Z45②）使惰性
// process.env 读与 env 单源等价。

/** 批3-2 B6：顶层单例仍不复用 DI REDIS_CLIENT（auth.ts 在 DI 容器外），但统一受管工厂，
 *  由 AuthModule.onApplicationShutdown 经 closeAuthRedis() 关闭。T34：惰性构造——首次 OTP
 *  校验调用才建连；REDIS_URL 读在本函数体内=调用期求值（原 :21 模块级 const redisUrl 退役）。
 *  T35 注（T34 质量评审 Minor-4）：worker 进程现无 getAuthRedis 触发面——引入时须同批接关停钩。 */
let authRedisCache: ManagedRedis | null = null;
function getAuthRedis(): ManagedRedis {
  if (!authRedisCache) {
    authRedisCache = createManagedRedis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return authRedisCache;
}
/** T34：关停入口（AuthModule.onApplicationShutdown 消费）——惰性构造后未建连亦安全（缓存判空）。 */
export function closeAuthRedis(): void {
  authRedisCache?.disconnect();
  authRedisCache = null;
}

/** 纯函数：Lua 原子校验 OTP（复用顶层 Redis 单例） */
async function luaVerifyOtp(phoneNumber: string, code: string): Promise<boolean> {
  const keys = [
    `sms:{${phoneNumber}}:code`,
    `sms:{${phoneNumber}}:errors`,
    `sms:{${phoneNumber}}:last_error`,
  ];
  const result = await getAuthRedis().eval(LUA_VERIFY_OTP, keys.length, ...keys, code, '5');
  return result === 0;
}

/**
 * 统一 Session Cookie 配置，供 Controller 层手动 Set-Cookie 使用。
 * ⚠️ 强约束: maxAge 必须与下方 buildAuth 的 session.expiresIn (7d) 完全对齐，
 * 修改 session.expiresIn 时必须同步更新此处 maxAge。
 * 两个值从不同维度描述同一会话生命周期，不一致会导致提前过期或孤儿 Cookie。
 * T34：const 对象→惰性函数（调用期求值——写回后恒有确定档位，未设档 undefined 假 dev 面退役）。
 * T35（Z13+Z45⑤）：secure 判据改 resolveSecureTransport() 单点——COOKIE_SECURE 显式优先
 * （本地 HTTPS 出路）→未设按档位兜底；本函数禁第二处 NODE_ENV 判断（RC7 边界兑现）。
 */
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: resolveSecureTransport(),
    maxAge: 7 * 24 * 60 * 60 * 1000, // = session.expiresIn (7 days), 必须同步修改
  };
}

function buildAuth() {
  return betterAuth({
    database: prismaAdapter(authPrisma, { provider: 'postgresql' }),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // 统一 Bootstrap：唯一建团入口（含默认素材文件夹），判据 ownerId+isDefault
            try {
              await bootstrapPersonalTeam(authPrisma, authLedger, user.id, user.name);
            } catch (err) {
              console.error(`[databaseHooks] personal team bootstrap failed for ${user.id}`, err);
              Sentry.captureException(err);
            }
          },
        },
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string' as const, defaultValue: 'USER', returned: true, input: false },
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
    // T34：baseURL/trustedOrigins env 读随惰性单例移入函数体（调用期求值——validateEnv 写回后）
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
    trustedOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim()),
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;
let authCache: AuthInstance | null = null;
/** T34：betterAuth 实例惰性单例——初始化后移至首调用（auth.service 请求面/payment.gateway 握手面），
 *  env 读点（baseURL/trustedOrigins）恒在 validateEnv 写回之后。getSession 直查 DB 链
 *  （prismaAdapter/databaseHooks）共用模块级 authPrisma（T32 connection_limit 重写时序不变），
 *  betterAuth 构造本身零 DB I/O——后移不改 DB 时序（auth.role.spec 真库链路回归承担）。 */
export function getAuth(): AuthInstance {
  if (!authCache) {
    authCache = buildAuth();
  }
  return authCache;
}
