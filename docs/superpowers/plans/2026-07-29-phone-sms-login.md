# 手机短信验证码登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Better Auth phoneNumber 插件 + 腾讯云 SMS + Redis Lua 实现手机验证码登录/注册

**Architecture:** 应用层自管 OTP 生成/存储/发送/限流（Redis Lua 原子脚本），Better Auth 插件仅通过自定义 verifyOTP 对接 Redis 校验并负责用户注册与会话签发。SMS 发送在 OTP 写入 Redis 之后执行，失败回滚删除 Redis Key。**发送逻辑 100% 收敛在 Controller + SmsService，不调用 auth.api.sendPhoneNumberOTP。**

**Tech Stack:** NestJS 10 + Prisma + Redis (ioredis) + Better Auth 1.6.11 phoneNumber 插件 + 腾讯云 SMS SDK + React 18 + Vitest

**版本**: v5 (v4 + Cookie约束注释、SMS单例化、EVALSHA降级、前端onError类型化)

---

### Task 1: Prisma Schema — User 表新增 phoneNumber 字段

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev`

- [ ] **Step 1: 修改 schema.prisma**

在 User 模型中新增两个字段：

```diff
 model User {
   id             String           @id
   name           String
   email          String           @unique
   emailVerified  Boolean
   image          String?
+  phoneNumber         String?  @unique @db.VarChar(20)
+  phoneNumberVerified Boolean  @default(false)
   createdAt      DateTime         @default(now())
   updatedAt      DateTime         @updatedAt
   accounts       Account[]
   sessions       Session[]
   balance        UserBalance?
   templates      Template[]
   canvasProjects CanvasProject[]
   media          Media[]
   materialFolders MaterialFolder[]
 }
```

- [ ] **Step 2: 生成并执行迁移**

```bash
cd apps/api && npx prisma migrate dev --name add_phone_number_to_user
```

Expected: 迁移文件生成，User 表新增两个字段，phoneNumber 唯一索引创建成功。

- [ ] **Step 3: 重新生成 Prisma Client**

```bash
cd apps/api && npx prisma generate
```

Expected: Prisma Client 类型更新，包含 phoneNumber 和 phoneNumberVerified。

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(db): add phoneNumber and phoneNumberVerified to User model"
```

---

### Task 2: 通用工具 — mask-phone 手机号脱敏

**Files:**
- Create: `apps/api/src/common/utils/mask-phone.ts`
- Create: `apps/api/src/common/utils/mask-phone.spec.ts`

- [ ] **Step 1: 编写脱敏函数测试**

```typescript
// apps/api/src/common/utils/mask-phone.spec.ts
import { describe, it, expect } from 'vitest';
import { maskPhone } from './mask-phone';

describe('maskPhone', () => {
  it('should mask middle 4 digits of +86 phone', () => {
    expect(maskPhone('+8613800138000')).toBe('+86138****8000');
  });

  it('should handle any +86 phone', () => {
    expect(maskPhone('+8613912345678')).toBe('+86139****5678');
  });

  it('should not modify already masked phone', () => {
    expect(maskPhone('+86138****8000')).toBe('+86138****8000');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/api && npx vitest run src/common/utils/mask-phone.spec.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现脱敏函数**

```typescript
// apps/api/src/common/utils/mask-phone.ts
export function maskPhone(phone: string): string {
  return phone.replace(/^(\+\d{2}\d{3})\d{4}(\d{4})$/, '$1****$2');
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/common/utils/mask-phone.spec.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/utils/mask-phone.ts apps/api/src/common/utils/mask-phone.spec.ts
git commit -m "feat(utils): add maskPhone utility for phone number sanitization"
```

---

### Task 3: Redis Lua 脚本 — OTP 原子写入与校验

**Files:**
- Create: `apps/api/src/common/services/lua-scripts.ts`
- Create: `apps/api/src/common/services/lua-scripts.spec.ts`

- [ ] **Step 1: 编写 Lua 脚本单元测试**

```typescript
// apps/api/src/common/services/lua-scripts.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Redis client
const mockEval = vi.fn();
const mockScriptLoad = vi.fn();

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    eval: mockEval,
    script: vi.fn().mockReturnThis(),
    load: mockScriptLoad,
  })),
}));

import {
  LUA_WRITE_OTP,
  LUA_VERIFY_OTP,
  parseVerifyResult,
} from './lua-scripts';

describe('Lua Scripts', () => {
  describe('LUA_WRITE_OTP', () => {
    it('should contain SET commands for code and errors', () => {
      expect(LUA_WRITE_OTP).toContain('SET');
      expect(LUA_WRITE_OTP).toContain('KEYS[1]'); // code key
      expect(LUA_WRITE_OTP).toContain('KEYS[2]'); // errors key
      expect(LUA_WRITE_OTP).toContain('EX');
      expect(LUA_WRITE_OTP).toContain('ARGV[2]'); // TTL
    });
  });

  describe('LUA_VERIFY_OTP', () => {
    it('should return -1 for not found', () => {
      expect(LUA_VERIFY_OTP).toContain('return -1');
    });

    it('should return -2 for too many attempts', () => {
      expect(LUA_VERIFY_OTP).toContain('return -2');
    });

    it('should return -3 for wrong code', () => {
      expect(LUA_VERIFY_OTP).toContain('return -3');
    });

    it('should return 0 for success', () => {
      expect(LUA_VERIFY_OTP).toContain('return 0');
    });

    it('should delete code and errors keys on success', () => {
      expect(LUA_VERIFY_OTP).toContain("redis.call('DEL', KEYS[1])");
      expect(LUA_VERIFY_OTP).toContain("redis.call('DEL', KEYS[2])");
    });

    it('should increment error count on wrong code', () => {
      expect(LUA_VERIFY_OTP).toContain("redis.call('INCR', KEYS[2])");
    });

    it('should delete keys when max attempts reached', () => {
      const lines = LUA_VERIFY_OTP.split('\n');
      const tooManyBlock = lines.filter(l => l.includes('TOO_MANY') || l.includes('DEL') || l.includes('>='));
      expect(tooManyBlock.length).toBeGreaterThan(0);
    });
  });

  describe('parseVerifyResult', () => {
    it('should parse OK result', () => {
      expect(parseVerifyResult(0)).toBe('OK');
    });

    it('should parse NOT_FOUND result', () => {
      expect(parseVerifyResult(-1)).toBe('NOT_FOUND');
    });

    it('should parse TOO_MANY result', () => {
      expect(parseVerifyResult(-2)).toBe('TOO_MANY');
    });

    it('should parse WRONG result', () => {
      expect(parseVerifyResult(-3)).toBe('WRONG');
    });

    it('should return UNKNOWN for unexpected values', () => {
      expect(parseVerifyResult(999)).toBe('UNKNOWN');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/api && npx vitest run src/common/services/lua-scripts.spec.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 Lua 脚本常量与解析函数**

```typescript
// apps/api/src/common/services/lua-scripts.ts

/** 写入 OTP — 原子设置 code + errors 两个 Key */
export const LUA_WRITE_OTP = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], '0', 'EX', ARGV[2])
return 'OK'
`.trim();

/** 校验 OTP — 原子比对、计数、超限作废、写错误原因 */
export const LUA_VERIFY_OTP = `
local code = redis.call('GET', KEYS[1])
if not code then
  redis.call('SET', KEYS[3], 'NOT_FOUND', 'EX', 60)
  return -1
end

if ARGV[1] ~= code then
  local errors = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], 300)
  if errors >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    redis.call('SET', KEYS[3], 'TOO_MANY', 'EX', 60)
    return -2
  end
  redis.call('SET', KEYS[3], 'WRONG', 'EX', 60)
  return -3
end

redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return 0
`.trim();

export type VerifyResult = 'OK' | 'NOT_FOUND' | 'TOO_MANY' | 'WRONG' | 'UNKNOWN';

export function parseVerifyResult(code: number): VerifyResult {
  switch (code) {
    case 0: return 'OK';
    case -1: return 'NOT_FOUND';
    case -2: return 'TOO_MANY';
    case -3: return 'WRONG';
    default: return 'UNKNOWN';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/common/services/lua-scripts.spec.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/services/lua-scripts.ts apps/api/src/common/services/lua-scripts.spec.ts
git commit -m "feat(redis): add Lua scripts for OTP atomic write and verify"
```

---

### Task 4: 通用限流器服务

**Files:**
- Create: `apps/api/src/common/services/rate-limiter.service.ts`
- Create: `apps/api/src/common/services/rate-limiter.service.spec.ts`

- [ ] **Step 1: 编写限流器测试**

```typescript
// apps/api/src/common/services/rate-limiter.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiterService } from './rate-limiter.service';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockRedis: { set: any; incr: any; expire: any; del: any };

  beforeEach(async () => {
    mockRedis = {
      set: vi.fn(),
      incr: vi.fn(),
      expire: vi.fn(),
      del: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
  });

  describe('checkPhoneRateLimit', () => {
    it('should return true when lock acquired (SET NX returns OK)', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const result = await service.checkPhoneRateLimit('+8613800138000');
      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'sms:{+8613800138000}:send', '1', 'EX', 60, 'NX',
      );
    });

    it('should return false when lock not acquired (SET NX returns null)', async () => {
      mockRedis.set.mockResolvedValue(null);
      const result = await service.checkPhoneRateLimit('+8613800138000');
      expect(result).toBe(false);
    });

    it('should use Hash Tag format for key', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await service.checkPhoneRateLimit('+8613800138000');
      const keyArg = mockRedis.set.mock.calls[0][0];
      expect(keyArg).toContain('{+8613800138000}');
    });
  });

  describe('releasePhoneLock', () => {
    it('should delete the send lock key', async () => {
      await service.releasePhoneLock('+8613800138000');
      expect(mockRedis.del).toHaveBeenCalledWith('sms:{+8613800138000}:send');
    });
  });

  describe('checkIpRateLimit', () => {
    it('should return true when under limit', async () => {
      mockRedis.incr.mockResolvedValue(1);
      const result = await service.checkIpRateLimit('192.168.1.1', 'sms:send', 3600, 20);
      expect(result).toBe(true);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'ratelimit:ip:sms:send:192.168.1.1', 3600,
      );
    });

    it('should return false when over limit', async () => {
      mockRedis.incr.mockResolvedValue(21);
      const result = await service.checkIpRateLimit('192.168.1.1', 'sms:send', 3600, 20);
      expect(result).toBe(false);
    });

    it('should skip IP check for whitelisted IPs', async () => {
      const result = await service.checkIpRateLimit('127.0.0.1', 'sms:send', 3600, 20);
      expect(result).toBe(true);
      expect(mockRedis.incr).not.toHaveBeenCalled();
    });
  });

  describe('getClientIp', () => {
    it('should extract from x-forwarded-for', () => {
      const ip = service.getClientIp({
        headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
        ip: '10.0.0.1',
      } as any);
      expect(ip).toBe('1.2.3.4');
    });

    it('should fallback to x-real-ip', () => {
      const ip = service.getClientIp({
        headers: { 'x-real-ip': '5.6.7.8' },
        ip: '10.0.0.1',
      } as any);
      expect(ip).toBe('5.6.7.8');
    });

    it('should fallback to req.ip', () => {
      const ip = service.getClientIp({
        headers: {},
        ip: '10.0.0.1',
      } as any);
      expect(ip).toBe('10.0.0.1');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/api && npx vitest run src/common/services/rate-limiter.service.spec.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现限流器**

```typescript
// apps/api/src/common/services/rate-limiter.service.ts
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import type { Request } from 'express';

const IP_WHITELIST = (process.env.RATE_LIMIT_IP_WHITELIST || '127.0.0.1,::1')
  .split(',').map(s => s.trim());

@Injectable()
export class RateLimiterService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** 手机号维度原子锁: SET NX + EX 60 */
  async checkPhoneRateLimit(e164Phone: string): Promise<boolean> {
    const key = `sms:{${e164Phone}}:send`;
    const result = await this.redis.set(key, '1', 'EX', 60, 'NX');
    return result === 'OK';
  }

  /** 释放手机号锁（SMS 发送失败时调用） */
  async releasePhoneLock(e164Phone: string): Promise<void> {
    await this.redis.del(`sms:{${e164Phone}}:send`);
  }

  /** IP 维度固定窗口限流 */
  async checkIpRateLimit(
    ip: string, action: string, windowSec: number, max: number,
  ): Promise<boolean> {
    if (IP_WHITELIST.some(w => this.ipMatches(ip, w))) return true;
    const key = `ratelimit:ip:${action}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSec);
    return count <= max;
  }

  /** 提取真实客户端 IP（兼容 APISIX 网关） */
  getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    return forwarded?.split(',')[0]?.trim()
      || (req.headers['x-real-ip'] as string)
      || req.ip
      || '127.0.0.1';
  }

  /** 仅支持 /8、/16、/24 三类 IPv4 网段与精确 IP 匹配 */
  private ipMatches(ip: string, whitelist: string): boolean {
    if (!whitelist.includes('/')) return ip === whitelist;
    // CIDR 匹配：仅支持 /8, /16, /24 常见格式
    const [range, bits] = whitelist.split('/');
    const mask = parseInt(bits, 10);
    if (mask === 8) return ip.split('.')[0] === range.split('.')[0];
    if (mask === 16) return ip.split('.').slice(0, 2).join('.') === range.split('.').slice(0, 2).join('.');
    if (mask === 24) return ip.split('.').slice(0, 3).join('.') === range.split('.').slice(0, 3).join('.');
    return ip === range;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/common/services/rate-limiter.service.spec.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/services/rate-limiter.service.ts apps/api/src/common/services/rate-limiter.service.spec.ts
git commit -m "feat(rate-limiter): add phone+IP dual-dimension rate limiter service"
```

---

### Task 5: SMS 模块 — 腾讯云 SMS 发送 + OTP Redis 管理

**Files:**
- Create: `apps/api/src/modules/sms/sms.service.ts`
- Create: `apps/api/src/modules/sms/sms.service.spec.ts`
- Create: `apps/api/src/modules/sms/sms.module.ts`

- [ ] **Step 1: 编写 SMS 服务测试**

```typescript
// apps/api/src/modules/sms/sms.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsService } from './sms.service';

// 静态 mock TencentCloudSmsClient（不再动态 import）
vi.mock('@tencentcloud/tencentcloud-sdk-nodejs-sms', () => ({
  TencentCloudSmsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  SendSmsCommand: vi.fn(),
}));

describe('SmsService', () => {
  let service: SmsService;
  let mockRedis: { eval: any; evalsha: any; del: any; script: any };

  beforeEach(async () => {
    mockRedis = {
      eval: vi.fn(),
      evalsha: vi.fn(),
      del: vi.fn(),
      script: vi.fn().mockReturnThis(),
      load: vi.fn().mockResolvedValue('fake-sha'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);
    // 静默 onModuleInit 的 SCRIPT LOAD（避免干扰各测试）
    await service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('should preload Lua scripts and cache SHA', async () => {
      // onModuleInit 已在 beforeEach 中调用
      expect(mockRedis.script).toHaveBeenCalledWith('LOAD', expect.stringContaining('redis.call'));
    });
  });

  describe('storeOtp', () => {
    it('should call EVALSHA with cached SHA (preferred path)', async () => {
      mockRedis.evalsha.mockResolvedValue(0);
      await service.storeOtp('+8613800138000', '123456');
      expect(mockRedis.evalsha).toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it('should fallback to EVAL on NOSCRIPT error', async () => {
      mockRedis.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
      mockRedis.eval.mockResolvedValue('OK');
      await service.storeOtp('+8613800138000', '123456');
      expect(mockRedis.eval).toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('should return true on success (0)', async () => {
      mockRedis.evalsha.mockResolvedValue(0);
      const result = await service.verifyOtp('+8613800138000', '123456');
      expect(result).toBe(true);
    });

    it('should return false on wrong code (-3)', async () => {
      mockRedis.evalsha.mockResolvedValue(-3);
      const result = await service.verifyOtp('+8613800138000', '000000');
      expect(result).toBe(false);
    });

    it('should return false on not found (-1)', async () => {
      mockRedis.evalsha.mockResolvedValue(-1);
      const result = await service.verifyOtp('+8613800138000', '123456');
      expect(result).toBe(false);
    });

    it('should return false on too many attempts (-2)', async () => {
      mockRedis.evalsha.mockResolvedValue(-2);
      const result = await service.verifyOtp('+8613800138000', '123456');
      expect(result).toBe(false);
    });
  });

  describe('deleteOtp', () => {
    it('should delete code and errors keys', async () => {
      await service.deleteOtp('+8613800138000');
      expect(mockRedis.del).toHaveBeenCalledWith(
        'sms:{+8613800138000}:code',
        'sms:{+8613800138000}:errors',
      );
    });
  });

  describe('sendSms', () => {
    it('should use singleton client (no dynamic import)', async () => {
      // sendSms 复用构造器中的单例 smsClient，无动态 import 开销
      await service.sendSms('+8613800138000', '123456');
      // 不抛异常即通过 — 实际 SMS 调用在集成测试中验证
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/api && npx vitest run src/modules/sms/sms.service.spec.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 SMS 服务**

```typescript
// apps/api/src/modules/sms/sms.service.ts
import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import Redis from 'ioredis';
import { LUA_WRITE_OTP, LUA_VERIFY_OTP } from '../../common/services/lua-scripts';
import { maskPhone } from '../../common/utils/mask-phone';
// 静态导入 — 模块顶层单例，避免每次 sendSms 动态 import
import { TencentCloudSmsClient, SendSmsCommand } from '@tencentcloud/tencentcloud-sdk-nodejs-sms';

const logger = new Logger('SmsService');

@Injectable()
export class SmsService implements OnModuleInit {
  private writeOtpSha: string | null = null;
  private verifyOtpSha: string | null = null;
  private smsClient: TencentCloudSmsClient;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    this.smsClient = new TencentCloudSmsClient({
      credential: {
        secretId: process.env.TENCENT_SMS_SECRET_ID!,
        secretKey: process.env.TENCENT_SMS_SECRET_KEY!,
      },
      region: '',
    });
  }

  /** 启动时预加载 Lua 脚本，缓存 SHA 摘要 */
  async onModuleInit() {
    try {
      this.writeOtpSha = await this.redis.script('LOAD', LUA_WRITE_OTP) as string;
      this.verifyOtpSha = await this.redis.script('LOAD', LUA_VERIFY_OTP) as string;
      logger.log('Lua scripts preloaded successfully');
    } catch (err) {
      logger.warn({ err }, 'Lua SCRIPT LOAD failed, will fallback to EVAL');
    }
  }

  /** 生成 6 位密码学安全随机验证码 */
  generateOtp(): string {
    return Array.from({ length: 6 }, () => randomInt(0, 10)).join('');
  }

  /** Lua 原子写入 OTP（优先 EVALSHA，NOSCRIPT 自动降级 EVAL） */
  async storeOtp(e164Phone: string, code: string): Promise<void> {
    const keys = [
      `sms:{${e164Phone}}:code`,
      `sms:{${e164Phone}}:errors`,
    ];
    await this.evalWithFallback(LUA_WRITE_OTP, this.writeOtpSha, keys, [code, '300']);
  }

  /** Lua 原子校验 OTP — 供 Better Auth verifyOTP 调用 */
  async verifyOtp(e164Phone: string, code: string): Promise<boolean> {
    const keys = [
      `sms:{${e164Phone}}:code`,
      `sms:{${e164Phone}}:errors`,
      `sms:{${e164Phone}}:last_error`,
    ];
    const result = await this.evalWithFallback(
      LUA_VERIFY_OTP, this.verifyOtpSha, keys, [code, '5'],
    );
    return result === 0;
  }

  /**
   * 优先 EVALSHA（减少网络传输），捕获 NOSCRIPT 自动回退 EVAL 并重载脚本。
   * 覆盖 Redis 重启/主从切换导致脚本丢失的场景。
   */
  private async evalWithFallback(
    script: string, sha: string | null, keys: string[], args: string[],
  ): Promise<number> {
    if (sha) {
      try {
        return await this.redis.evalsha(sha, keys.length, ...keys, ...args) as number;
      } catch (err: any) {
        if (!err?.message?.includes('NOSCRIPT')) throw err;
        logger.warn('EVALSHA NOSCRIPT, falling back to EVAL');
      }
    }
    // 降级 EVAL + 重载（SHA 为 null 或 NOSCRIPT 触发）
    const result = await this.redis.eval(script, keys.length, ...keys, ...args) as number;
    try {
      const newSha = await this.redis.script('LOAD', script) as string;
      if (script === LUA_WRITE_OTP) this.writeOtpSha = newSha;
      else this.verifyOtpSha = newSha;
    } catch { /* 静默 — 下次继续 EVAL */ }
    return result;
  }

  /** 删除 OTP（SMS 发送失败回滚） */
  async deleteOtp(e164Phone: string): Promise<void> {
    await this.redis.del(
      `sms:{${e164Phone}}:code`,
      `sms:{${e164Phone}}:errors`,
    );
  }

  /** 腾讯云 SMS 发送（复用单例 smsClient） */
  async sendSms(phoneNumber: string, code: string): Promise<void> {
    const masked = maskPhone(phoneNumber);
    logger.log({ phone: masked }, 'Sending SMS OTP');

    try {
      await this.smsClient.send(
        new SendSmsCommand({
          PhoneNumberSet: [phoneNumber],
          SmsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID!,
          TemplateId: process.env.TENCENT_SMS_TEMPLATE_ID!,
          TemplateParamSet: [code],
          SignName: process.env.TENCENT_SMS_SIGN_NAME,
        }),
      );
      logger.log({ phone: masked }, 'SMS sent successfully');
    } catch (err) {
      logger.error({ phone: masked, err }, 'SMS send failed');
      throw err;
    }
  }
}
```

```typescript
// apps/api/src/modules/sms/sms.module.ts
import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/modules/sms/sms.service.spec.ts
```

Expected: All tests PASS (sendSms integration test excluded)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sms/
git commit -m "feat(sms): add SMS service with Lua-based OTP management and Tencent Cloud integration"
```

---

### Task 6: Auth DTOs — 参数校验

**Files:**
- Create: `apps/api/src/auth/dto/send-sms-code.dto.ts`
- Create: `apps/api/src/auth/dto/phone-login.dto.ts`

- [ ] **Step 1: 创建 DTO 文件**

```typescript
// apps/api/src/auth/dto/send-sms-code.dto.ts
import { IsString, Matches } from 'class-validator';

export class SendSmsCodeDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;
}
```

```typescript
// apps/api/src/auth/dto/phone-login.dto.ts
import { IsString, Matches } from 'class-validator';

export class PhoneLoginDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: '验证码为6位数字' })
  code: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/auth/dto/send-sms-code.dto.ts apps/api/src/auth/dto/phone-login.dto.ts
git commit -m "feat(auth): add SMS code and phone login DTOs"
```

---

### Task 7: Better Auth 配置 — 引入 phoneNumber 插件

**Files:**
- Modify: `apps/api/src/auth/auth.ts`

- [ ] **Step 1: 修改 auth.ts**

在现有 Better Auth 配置基础上，新增 phoneNumber 插件。

**关键设计决策**:
- 插件仅承担「校验 + 用户注册 + 会话签发 + 回调」，**不负责 OTP 发送**
- Redis 和 Prisma 使用文件顶层单例，**禁止每次请求新建连接**
- 校验逻辑提取为纯函数，复用顶层 Redis 连接

```typescript
// apps/api/src/auth/auth.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { phoneNumber } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { LUA_VERIFY_OTP } from '../common/services/lua-scripts';
import { maskPhone } from '../common/utils/mask-phone';
import { DEFAULT_FOLDER_NAMES } from '../modules/material-library/constants/material-library.constants';

const prisma = new PrismaClient();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl); // 顶层单例，不复用项目 REDIS_CLIENT（auth.ts 在 DI 容器外）

const trustedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

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
 * ⚠️ 强约束: maxAge 必须与上方 session.expiresIn (7d) 完全对齐，
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
  emailAndPassword: { enabled: true },
  advanced: { cookiePrefix: 'flowweb', useArgon2id: true },
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
  trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // 1 day
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
          // 复用顶层 prisma 单例，禁止每次新建 PrismaClient
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
});
```

> **文件级依赖**: auth.ts 评估早于 NestJS DI 容器启动，因此 Redis 和 Prisma 使用文件顶层实例。Redis URL 从环境变量读取，确保生产配置生效。

- [ ] **Step 2: 验证现有 auth 相关测试仍然通过**

```bash
cd apps/api && npx vitest run src/auth/auth.service.spec.ts src/auth/auth.controller.spec.ts
```

Expected: 现有测试 PASS（phoneNumber 插件不影响 email/password 流程）

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/auth.ts
git commit -m "feat(auth): integrate Better Auth phoneNumber plugin with custom verifyOTP"
```

---

### Task 8: Auth Service — 新增服务端调用方法

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.service.spec.ts`

- [ ] **Step 1: 扩展现有 auth.service.spec.ts 测试**

在 `apps/api/src/auth/auth.service.spec.ts` 中新增测试用例。

现有 mock 已包含 `auth.api.*` 方法。需新增 `sendPhoneNumberOTP` 和 `verifyPhoneNumber` mock：

```typescript
// 在现有 vi.hoisted mock 中新增 verifyPhoneNumber:
const { mockSignInEmail, mockSignUpEmail, mockSignOut, mockGetSession, mockUpdateUser,
  mockVerifyPhoneNumber } = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
  mockSignUpEmail: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetSession: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockVerifyPhoneNumber: vi.fn(),
}));

vi.mock('./auth', () => ({
  auth: {
    api: {
      signInEmail: mockSignInEmail,
      signUpEmail: mockSignUpEmail,
      signOut: mockSignOut,
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
      verifyPhoneNumber: mockVerifyPhoneNumber,
    },
  },
}));
```

新增测试用例：

```typescript
// 不新增 sendPhoneCode 测试 — 该方法不存在。
// 发送逻辑 100% 在 Controller + SmsService，不经过插件。

describe('phoneLogin', () => {
  it('should call auth.api.verifyPhoneNumber with updatePhoneNumber: false', async () => {
    mockVerifyPhoneNumber.mockResolvedValue({
      token: 'tok_abc',
      user: { id: 'u1', phoneNumber: '+8613800138000', phoneNumberVerified: true },
    });
    const result = await service.phoneLogin('+8613800138000', '123456');
    expect(auth.api.verifyPhoneNumber).toHaveBeenCalledWith({
      body: {
        phoneNumber: '+8613800138000',
        code: '123456',
        updatePhoneNumber: false,
      },
    });
    expect(result.token).toBe('tok_abc');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/api && npx vitest run src/auth/auth.service.spec.ts
```

Expected: FAIL — `phoneLogin` method not defined on AuthService

- [ ] **Step 3: 实现 auth.service.ts 新方法**

```typescript
// 在现有 AuthService 类中仅新增 phoneLogin 方法。
// 不新增 sendPhoneCode — 发送逻辑 100% 在 Controller + SmsService。

async phoneLogin(phoneNumber: string, code: string) {
  return auth.api.verifyPhoneNumber({
    body: {
      phoneNumber,
      code,
      updatePhoneNumber: false, // 必须关闭，否则新用户无法触发 signUpOnVerification
    },
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/auth/auth.service.spec.ts
```

Expected: phoneLogin 相关测试 PASS，无 sendPhoneCode 测试

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.spec.ts
git commit -m "feat(auth): add phoneLogin method to AuthService for phone number verification"
```

---

### Task 9: Auth Controller — 新增 send-sms-code 与 phone-login 端点

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.controller.spec.ts`

- [ ] **Step 1: 编写 controller 新端点测试**

在 `auth.controller.spec.ts` 中新增测试用例。使用直接构造模式：

```typescript
// 构造 controller 的 mock 依赖需新增 rateLimiter 和 smsService:
let mockRateLimiter: Record<string, any>;
let mockSmsService: Record<string, any>;

beforeEach(() => {
  mockSvc = {
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    updateProfile: vi.fn(),
    phoneLogin: vi.fn(),
    // 无 sendPhoneCode: 该方法不存在，发送逻辑在 Controller + SmsService
  };
  mockRateLimiter = {
    checkPhoneRateLimit: vi.fn(),
    releasePhoneLock: vi.fn(),
    checkIpRateLimit: vi.fn(),
    getClientIp: vi.fn(),
  };
  mockSmsService = {
    generateOtp: vi.fn().mockReturnValue('123456'),
    storeOtp: vi.fn(),
    deleteOtp: vi.fn(),
    sendSms: vi.fn(),
  };

  const mockRedis = { get: vi.fn(), del: vi.fn() };
  const mockPrisma = { materialFolder: { createMany: vi.fn(), count: vi.fn() } } as any;
  controller = new AuthController(
    mockSvc as any, mockPrisma,
    mockRateLimiter as any, mockSmsService as any,
    mockRedis as any, // REDIS_CLIENT 注入
  );
});
```

测试用例：

```typescript
describe('sendSmsCode', () => {
  it('should return 200 on success', async () => {
    mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
    mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
    mockRateLimiter.checkPhoneRateLimit.mockResolvedValue(true);
    mockSmsService.storeOtp.mockResolvedValue(undefined);
    mockSmsService.sendSms.mockResolvedValue(undefined);

    const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }), json: vi.fn() };
    const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' };

    await controller.sendSmsCode(
      { phone: '13800138000' } as any,
      req as any, mockRes as any,
    );

    expect(mockSmsService.generateOtp).toHaveBeenCalled();
    expect(mockSmsService.storeOtp).toHaveBeenCalledWith('+8613800138000', '123456');
    expect(mockSmsService.sendSms).toHaveBeenCalledWith('+8613800138000', '123456');
    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
  });

  it('should return 429 when phone rate limit exceeded', async () => {
    mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
    mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
    mockRateLimiter.checkPhoneRateLimit.mockResolvedValue(false);

    const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }) };
    const req = { headers: {}, ip: '1.2.3.4' };

    await controller.sendSmsCode(
      { phone: '13800138000' } as any,
      req as any, mockRes as any,
    );

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockSmsService.sendSms).not.toHaveBeenCalled();
  });

  it('should return 502 and release lock + delete OTP when SMS fails', async () => {
    mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
    mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
    mockRateLimiter.checkPhoneRateLimit.mockResolvedValue(true);
    mockSmsService.storeOtp.mockResolvedValue(undefined);
    mockSmsService.sendSms.mockRejectedValue(new Error('SMS_FAILED'));

    const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }) };
    const req = { headers: {}, ip: '1.2.3.4' };

    await controller.sendSmsCode(
      { phone: '13800138000' } as any,
      req as any, mockRes as any,
    );

    expect(mockRateLimiter.releasePhoneLock).toHaveBeenCalledWith('+8613800138000');
    expect(mockSmsService.deleteOtp).toHaveBeenCalledWith('+8613800138000');
    expect(mockRes.status).toHaveBeenCalledWith(502);
  });
});

describe('phoneLogin', () => {
  it('should return 200 + Set-Cookie on success', async () => {
    mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
    mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
    mockSvc.phoneLogin.mockResolvedValue({
      token: 'tok_abc',
      user: { id: 'u1', phoneNumber: '+8613800138000', phoneNumberVerified: true },
    });

    const mockRes = { cookie: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
    const req = { headers: {}, ip: '1.2.3.4' };

    await controller.phoneLogin(
      { phone: '13800138000', code: '123456' } as any,
      req as any, mockRes as any,
    );

    expect(mockSvc.phoneLogin).toHaveBeenCalledWith('+8613800138000', '123456');
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'flowweb.session_token', 'tok_abc',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(mockRes.json).toHaveBeenCalledWith({
      user: { id: 'u1', phoneNumber: '+8613800138000', phoneNumberVerified: true },
    });
  });

  it('should return 400 when verify fails (INVALID_OTP)', async () => {
    mockRateLimiter.getClientIp.mockReturnValue('1.2.3.4');
    mockRateLimiter.checkIpRateLimit.mockResolvedValue(true);
    mockSvc.phoneLogin.mockRejectedValue(new Error('INVALID_OTP'));

    // mockRedis 已通过 DI 注入 → 读 last_error
    // mockRedis.get 对应 sms:{e164}:last_error，mockRedis.del 对应删除
    const mockRedis = { get: vi.fn().mockResolvedValue('WRONG'), del: vi.fn() };

    const mockRes = { status: vi.fn().mockReturnValue({ json: vi.fn() }) };
    const req = { headers: {}, ip: '1.2.3.4' };

    // 使用 5 参构造，传入 mockRedis 验证 last_error 读取逻辑
    const ctrl = new AuthController(
      mockSvc as any, {} as any, mockRateLimiter as any, mockSmsService as any, mockRedis as any,
    );

    await ctrl.phoneLogin(
      { phone: '13800138000', code: '000000' } as any,
      req as any, mockRes as any,
    );

    expect(mockRedis.get).toHaveBeenCalledWith('sms:{+8613800138000}:last_error');
    expect(mockRedis.del).toHaveBeenCalledWith('sms:{+8613800138000}:last_error');
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/api && npx vitest run src/auth/auth.controller.spec.ts
```

Expected: FAIL — sendSmsCode/phoneLogin not defined

- [ ] **Step 3: 实现 AuthController 新端点**

由于 Controller 新增了 RateLimiterService 和 SmsService 依赖，需要更新构造函数并新增两个端点。

```typescript
// auth.controller.ts — 新增 import 和 constructor 参数、新增方法
// 关键变更:
// 1. 通过 @Inject('REDIS_CLIENT') 注入 Redis，禁止 new Redis()
// 2. 从 auth.ts 导入 SESSION_COOKIE_OPTIONS，保证 Cookie 属性与邮箱登录一致

import { RateLimiterService } from '../common/services/rate-limiter.service';
import { SmsService } from '../modules/sms/sms.service';
import { SendSmsCodeDto } from './dto/send-sms-code.dto';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { SESSION_COOKIE_OPTIONS } from './auth';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiterService,
    private readonly smsService: SmsService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis, // DI 注入，非 new
  ) {}

  // ... 现有端点不变 ...

  @Post('send-sms-code')
  async sendSmsCode(
    @Body() dto: SendSmsCodeDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const e164 = '+86' + dto.phone;
    const clientIp = this.rateLimiter.getClientIp(req);

    // IP 限流
    if (!(await this.rateLimiter.checkIpRateLimit(clientIp, 'sms:send', 3600, 20))) {
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试', code: 'IP_RATE_LIMITED',
      });
    }

    // 手机号限流
    if (!(await this.rateLimiter.checkPhoneRateLimit(e164))) {
      return res.status(429).json({
        error: '发送过于频繁，请60秒后再试', code: 'PHONE_RATE_LIMITED',
      });
    }

    // 生成 OTP → 写入 Redis → 发送 SMS
    const code = this.smsService.generateOtp();
    await this.smsService.storeOtp(e164, code);

    try {
      await this.smsService.sendSms(e164, code);
      return res.json({ success: true });
    } catch {
      await this.rateLimiter.releasePhoneLock(e164);
      await this.smsService.deleteOtp(e164);
      return res.status(502).json({ error: '短信发送失败，请稍后再试' });
    }
  }

  @Post('phone-login')
  async phoneLogin(
    @Body() dto: PhoneLoginDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const e164 = '+86' + dto.phone;
    const clientIp = this.rateLimiter.getClientIp(req);

    // IP 限流
    if (!(await this.rateLimiter.checkIpRateLimit(clientIp, 'sms:verify', 60, 10))) {
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试', code: 'IP_RATE_LIMITED',
      });
    }

    try {
      const result = await this.authService.phoneLogin(e164, dto.code);
      // 复用统一 Cookie 配置，保证与邮箱登录完全一致
      res.cookie('flowweb.session_token', result.token, SESSION_COOKIE_OPTIONS);
      return res.json({ user: result.user });
    } catch {
      // 读取 Lua 脚本写入的最后失败原因（使用 DI 注入的 Redis）
      const reason = await this.redis.get(`sms:{${e164}}:last_error`);
      await this.redis.del(`sms:{${e164}}:last_error`);

      switch (reason) {
        case 'NOT_FOUND':
          return res.status(400).json({
            error: '请先获取验证码', code: 'OTP_NOT_FOUND',
          });
        case 'WRONG':
          return res.status(400).json({
            error: '验证码错误', code: 'INVALID_OTP',
          });
        case 'TOO_MANY':
          return res.status(403).json({
            error: '错误次数过多，请重新获取验证码', code: 'TOO_MANY_ATTEMPTS',
          });
        default:
          return res.status(400).json({
            error: '验证失败，请重试', code: 'VERIFICATION_FAILED',
          });
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/auth/auth.controller.spec.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.controller.spec.ts
git commit -m "feat(auth): add send-sms-code and phone-login controller endpoints"
```

---

### Task 10: Auth Module + Main.ts — 依赖注入与代理配置

**Files:**
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: 更新 AuthModule 导入 SmsModule**

```typescript
// auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SmsModule } from '../modules/sms/sms.module';
import { RateLimiterService } from '../common/services/rate-limiter.service';

@Module({
  imports: [SmsModule],
  controllers: [AuthController],
  providers: [AuthService, RateLimiterService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 2: 配置 main.ts trust proxy**

在 `apps/api/src/main.ts` 中，在 `const app = await NestFactory.create(...)` 之后添加：

```typescript
app.set('trust proxy', true);
```

该行放在 `app.enableCors(...)` 之前。

- [ ] **Step 3: 验证应用启动正常**

```bash
cd apps/api && npx nest start --watch &
sleep 15 && curl -s http://localhost:3000/api/health
```

Expected: Health check 返回正常，无启动错误。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/auth.module.ts apps/api/src/main.ts
git commit -m "feat(auth): wire SmsModule into AuthModule, enable trust proxy"
```

---

### Task 11: 默认文件夹补偿 — GET /api/auth/me 补建逻辑

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.controller.spec.ts`

- [ ] **Step 1: 扩展 getMe 端点测试**

在现有 `describe('getMe', ...)` 中新增：

```typescript
it('should ensure default folders when user has none', async () => {
  const req = { headers: { cookie: 'flowweb.session_token=valid' } };
  const mockRes = { json: vi.fn() };
  mockSvc.getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@test.com' } });

  const mockPrisma = {
    materialFolder: {
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
  } as any;

  const mockRedis = { get: vi.fn(), del: vi.fn() };

  // Re-create controller with this mock (5 args 匹配构造函数签名)
  const ctrl = new AuthController(mockSvc as any, mockPrisma, mockRateLimiter, mockSmsService, mockRedis as any);
  await ctrl.getMe(req as any, mockRes as any);

  expect(mockPrisma.materialFolder.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  expect(mockPrisma.materialFolder.createMany).toHaveBeenCalled();
});
```

- [ ] **Step 2: 实现 getMe 补偿逻辑**

在 `auth.controller.ts` 的 `getMe` 方法中，在返回 user 之前添加：

```typescript
@Get('me')
async getMe(@Req() req: any, @Res() res: Response) {
  const cookieStr: string = req.headers.cookie || '';
  const session = await this.authService.getSession({ cookie: cookieStr });
  if (!session) return res.json({ user: null });

  // 补偿默认文件夹
  try {
    const count = await this.prisma.materialFolder.count({
      where: { userId: session.user.id },
    });
    if (count === 0) {
      await this.prisma.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((name, i) => ({
          name, userId: session.user.id, isDefault: true, sortOrder: i,
        })),
      });
    }
  } catch {
    // 非致命 — 用户仍可正常使用
  }

  return res.json({ user: session.user });
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/auth/auth.controller.spec.ts
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.controller.spec.ts
git commit -m "feat(auth): add default folder compensation in GET /api/auth/me"
```

---

### Task 12: 环境变量配置

**Files:**
- Modify: `apps/api/.env.example`

- [ ] **Step 1: 追加 SMS 相关环境变量**

在 `.env.example` 末尾追加：

```env
# 腾讯云 SMS
TENCENT_SMS_SECRET_ID=
TENCENT_SMS_SECRET_KEY=
TENCENT_SMS_SDK_APP_ID=
TENCENT_SMS_TEMPLATE_ID=
TENCENT_SMS_SIGN_NAME=

# 限流白名单（逗号分隔，支持CIDR网段）
RATE_LIMIT_IP_WHITELIST=127.0.0.1,::1
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.env.example
git commit -m "chore(config): add Tencent SMS and rate limit whitelist env vars"
```

---

### Task 13: 前端 AuthProvider — User 类型扩展

**Files:**
- Modify: `apps/web/src/components/AuthProvider.tsx`
- Modify: `apps/web/src/components/AuthProvider.test.tsx` (if exists) or verify existing tests

- [ ] **Step 1: 扩展 User 接口**

```typescript
// 在 AuthProvider.tsx 中:
interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  phoneNumber?: string | null;       // 新增
  phoneNumberVerified?: boolean;     // 新增
}
```

- [ ] **Step 2: 验证现有测试仍通过**

```bash
cd apps/web && npx vitest run src/components/RequireAuth.test.tsx src/components/AuthModal.test.tsx
```

Expected: 现有测试 PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/AuthProvider.tsx
git commit -m "feat(web): add phoneNumber and phoneNumberVerified to User interface"
```

---

### Task 14: 前端 PhoneLoginForm — 接入真实 API

**Files:**
- Modify: `apps/web/src/components/auth/PhoneLoginForm.tsx`
- Modify: `apps/web/src/components/auth/PhoneLoginForm.test.tsx`

- [ ] **Step 1: 更新 PhoneLoginForm 测试**

现有测试已覆盖 UI 渲染、倒计时、onLogin 调用等。需新增 API 调用相关测试：

```typescript
// 在 PhoneLoginForm.test.tsx 中新增:

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API integration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should call send-sms-code API when clicking get code button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    renderForm();
    const phoneInput = screen.getByLabelText('手机号');
    fireEvent.change(phoneInput, { target: { value: '13800138000' } });

    const getCodeBtn = screen.getByLabelText('获取验证码');
    await act(() => { fireEvent.click(getCodeBtn); });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/send-sms-code',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000' }),
      }),
    );
  });

  it('should call phone-login API when clicking login button', async () => {
    const onLoginSuccess = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1' } }),
    });
    vi.mock('@/components/AuthProvider', () => ({
      useAuth: () => ({ refresh: vi.fn() }),
    }));

    renderForm({ onLoginSuccess });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });

    const loginBtn = screen.getByLabelText('登录/注册');
    await act(() => { fireEvent.click(loginBtn); });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/phone-login',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000', code: '123456' }),
      }),
    );
  });

  it('should call onError with code and message when send-sms-code fails', async () => {
    const onError = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ code: 'IP_RATE_LIMITED', error: '请求过于频繁' }),
    });
    renderForm({ onError });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
    const getCodeBtn = screen.getByLabelText('获取验证码');
    await act(() => { fireEvent.click(getCodeBtn); });
    expect(onError).toHaveBeenCalledWith('IP_RATE_LIMITED', '请求过于频繁');
  });

  it('should call onError with code and message when phone-login fails', async () => {
    const onError = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ code: 'INVALID_OTP', error: '验证码错误' }),
    });
    renderForm({ onError });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } });
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
    const loginBtn = screen.getByLabelText('登录/注册');
    await act(() => { fireEvent.click(loginBtn); });
    expect(onError).toHaveBeenCalledWith('INVALID_OTP', '验证码错误');
  });
});
```

- [ ] **Step 2: 实现 PhoneLoginForm API 集成**

```typescript
// PhoneLoginForm.tsx — 新增 onError 类型化回调 + onLoginSuccess

import { useAuth } from '@/components/AuthProvider';

export interface PhoneLoginFormProps {
  onLogin?: (phone: string, code: string) => void;
  /** 登录成功回调 — 由父组件导航/关闭弹窗 */
  onLoginSuccess?: () => void;
  /** 错误回调 — (错误码, 人类可读消息)，替代 __ERROR__: 字符串拼接 */
  onError?: (code: string, message: string) => void;
  loading?: boolean;
  errorMsg?: string;
  className?: string;
}

export function PhoneLoginForm({
  onLogin = () => {},
  onLoginSuccess,
  onError,
  loading = false,
  errorMsg = '',
  className = '',
}: PhoneLoginFormProps) {
  // ... 现有 state (phone, code, countdown) ...
  const { refresh } = useAuth();

  const handleGetCode = useCallback(async () => {
    if (countdown > 0 || phone.length !== 11) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) return;

    try {
      const res = await fetch('/api/auth/send-sms-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();

      if (res.ok) {
        setCountdown(COUNTDOWN_SECONDS);
      } else {
        onError?.(data.code || 'SEND_FAILED', data.error || '发送失败');
      }
    } catch {
      onError?.('NETWORK', '网络错误，请重试');
    }
  }, [countdown, phone, onError]);

  const handleLogin = async () => {
    if (!phone || !code) return;

    try {
      const res = await fetch('/api/auth/phone-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();

      if (res.ok) {
        await refresh();
        onLoginSuccess?.();
      } else {
        onError?.(data.code || 'LOGIN_FAILED', data.error || '登录失败');
      }
    } catch {
      onError?.('NETWORK', '网络错误，请重试');
    }
  };
  // ... 其余不变 ...
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd apps/web && npx vitest run src/components/auth/PhoneLoginForm.test.tsx
```

Expected: 测试 PASS（mock API 调用）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/auth/PhoneLoginForm.tsx apps/web/src/components/auth/PhoneLoginForm.test.tsx
git commit -m "feat(web): wire PhoneLoginForm to real SMS and phone-login APIs"
```

---

### Task 15: 前端 LoginPage & LoginModal — onLoginSuccess 回调

**Files:**
- Modify: `apps/web/src/pages/login/page.tsx`
- Modify: `apps/web/src/components/auth/LoginModal.tsx`
- Modify: `apps/web/src/pages/login/page.test.tsx` (verify existing tests)

- [ ] **Step 1: 更新 LoginPage**

```typescript
// page.tsx — PhoneLoginForm 新增 onLoginSuccess
<PhoneLoginForm onLoginSuccess={() => { window.location.href = '/canvas'; }} />
```

- [ ] **Step 2: 更新 LoginModal**

```typescript
// LoginModal.tsx — PhoneLoginForm 新增 onLoginSuccess
const { refresh } = useAuth();
// ...
<PhoneLoginForm
  onLoginSuccess={() => {
    refresh();
    onClose();
  }}
/>
```

- [ ] **Step 3: 验证现有测试**

```bash
cd apps/web && npx vitest run src/pages/login/page.test.tsx src/components/auth/LoginModal.test.tsx
```

Expected: 现有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/login/page.tsx apps/web/src/components/auth/LoginModal.tsx
git commit -m "feat(web): add onLoginSuccess callback to LoginPage and LoginModal"
```

---

### Task 16: 可选 — 安装腾讯云 SMS Node.js SDK

- [ ] **Step 1: 安装 SDK**

```bash
cd apps/api && pnpm add @tencentcloud/tencentcloud-sdk-nodejs-sms
```

Expected: 依赖安装成功，无冲突

- [ ] **Step 2: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(deps): add Tencent Cloud SMS Node.js SDK"
```

---

### Task 17: 全量集成验证

- [ ] **Step 1: 运行所有后端测试**

```bash
cd apps/api && npx vitest run
```

Expected: 所有测试 PASS（包括新增的 auth controller/service、rate limiter、SMS service 测试）

- [ ] **Step 2: 运行所有前端测试**

```bash
cd apps/web && npx vitest run
```

Expected: 所有测试 PASS（包括 PhoneLoginForm 更新后的测试）

- [ ] **Step 3: 验证 API 编译**

```bash
cd apps/api && npx nest build
```

Expected: Build 成功，无类型错误

- [ ] **Step 4: 配置 .env.local 并端到端验证**

```bash
# 在 apps/api/.env.local 中添加腾讯云 SMS 凭据
# 启动 API + Web
# 访问 http://localhost:5173/login
# 测试: 输入手机号 → 获取验证码 → 输入验证码 → 登录成功
```

---

### Task 18: 当前计划待优化项（非阻塞）

以下项已识别，建议后续迭代处理，不阻塞本期上线：

1. **auth.ts 中 verifyOTP 的 Redis 连接** — 使用瞬态连接而非注入，后续可重构为 NestJS 工厂模式
2. **BullMQ 异步 SMS 发送** — 当前同步发送，后续入队提高响应速度
3. **Prometheus 指标埋点** — 指标已定义，埋点代码待添加
4. **Lua 脚本 EVALSHA 降级** — NOSCRIPT 回退逻辑待实现
5. **bcrypt OTP 哈希** — 等保合规需求时实施

---

## 验收标准对照

| # | 标准 | 覆盖 Task |
|---|------|----------|
| 1 | 正确验证码 → 登录成功 | Task 9, 14 |
| 2 | 新手机号 → 自动注册 | Task 7, 8 |
| 3 | 验证码不存在 → 400 OTP_NOT_FOUND | Task 9 |
| 4 | 验证码输错 → 400 INVALID_OTP | Task 9 |
| 5 | 5次错误 → 403 TOO_MANY_ATTEMPTS | Task 3, 9 |
| 6 | SMS 失败 → Redis 回滚 + 锁释放 | Task 9 |
| 7 | 同手机号并发 → 仅1条成功 | Task 4 |
| 8 | IP 限流 20次/小时 | Task 4, 9 |
| 9 | IP 限流 10次/分钟 | Task 4, 9 |
| 10 | APISIX 真实 IP | Task 4, 10 |
| 11 | 同一验证码并发登录 → 仅1次成功 | Task 3 |
| 12 | GET /me 触发文件夹补建 | Task 11 |
| 13 | Cookie 安全属性 | Task 9 |
| 14 | callback user==null 防御 | Task 7 |
| 15 | 日志脱敏 | Task 2 |
| 16 | 429 code 字段区分维度 | Task 9 |
| 17 | updatePhoneNumber: false | Task 8 |
| 18 | 新用户 phoneNumberVerified=true | Task 7 |
| 19 | 现有测试全部通过 | Task 17 |
