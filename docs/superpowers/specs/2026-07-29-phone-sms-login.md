<!-- doc-status: historical | verified_at: n/a -->
# Spec: 手机短信验证码登录

**日期**: 2026-07-29  
**状态**: 待确认  
**版本**: v8 (第八轮 — updatePhoneNumber 默认值阻断注册修正)

---

## 1. 概述

基于 Better Auth `phoneNumber` 插件实现手机验证码登录。

**职责边界（显式声明）**:
- **应用层**: 短信发送全流程自管 — DTO → IP 限流 → 手机号锁 → OTP 生成 → SMS 发送 → Redis Lua 管理 OTP 生命周期
- **Better Auth 插件**: 仅通过 `verifyOTP` 对接 Redis 校验，负责用户注册、session 签发、回调触发
- **不经过**: `sendPhoneNumberOTP` 端点（完全不调用），`sendOTP` 回调（空函数占位）
- **插件 DB 行为**: 自定义 verifyOTP 替换插件内部 OTP 存储/校验逻辑，插件数据库中**不会产生任何 OTP 验证记录**。仅用户表的 `phoneNumber`、`phoneNumberVerified` 字段由插件维护（验证成功后自动置 true）

## 2. 关键设计约束

### 2.1 verifyOTP 二元返回值

`verifyOTP(data, ctx) => Promise<boolean>` — 仅能返回 true/false。插件内部所有失败统一映射为 `INVALID_OTP`。

**后果**:
- 配置中的 `allowedAttempts`、`expiresIn`、`otpLength` 在自定义 verifyOTP 模式下**完全失效**（插件不管理 OTP 生命周期）
- 无法从插件返回值区分 NOT_FOUND / WRONG / TOO_MANY

**对策**:
- 插件配置中移除 `allowedAttempts`、`expiresIn`、`otpLength`
- OTP 生命周期全部由应用层 Redis Lua 脚本管理
- verifyOTP 内部失败时，将具体原因写入 Redis 临时 Key，Controller 层读取后映射错误码

### 2.2 发送与存储顺序

确保不变式：**用户收到的验证码一定有效，无效验证码用户一定收不到**。

```
1. 生成 OTP (crypto.randomInt)
2. Lua 写入 Redis (code + errors=0, TTL=300)
3. 腾讯云 SMS 发送
   ├─ 成功 → 200
   └─ 失败 → DEL Redis code + errors + 释放手机号锁 → 502
```

SMS 是最后一步，失败不会留下有效 OTP。

## 3. 架构图

```
POST /api/auth/send-sms-code (应用层全流程)
  ┌──────────────────────────────────────────────────┐
  │ 1. DTO: phone /^1[3-9]\d{9}$/                     │
  │ 2. IP 固定窗口: 20次/小时 (真实客户端 IP)           │
  │ 3. 手机号锁: SET sms:{e164}:send 1 EX 60 NX      │
  │ 4. OTP = crypto.randomInt(0,10) × 6               │
  │ 5. Lua: SET sms:{e164}:code + :errors TTL=300     │
  │ 6. 腾讯云 SMS.SendSms(phoneNumber, OTP)            │
  │    失败 → DEL sms:{e164}:code + :errors + :send   │
  └──────────────────────────────────────────────────┘

POST /api/auth/phone-login
  ┌──────────────────────────────────────────────────┐
  │ 1. DTO: phone + code (6位)                        │
  │ 2. IP 固定窗口: 10次/分钟                          │
  │ 3. auth.api.verifyPhoneNumber({                   │
  │      body: { phoneNumber, code,                    │
  │        updatePhoneNumber: false } })  ← 必须关闭!  │
  │    └→ verifyOTP 查 Redis Lua (原子校验+计数)       │
  │       失败 → 写 sms:{e164}:last_error TTL=60     │
  │       成功 → signUpOnVerification → session       │
  │              → callbackOnVerification → 文件夹    │
  │ 4. 失败 → 读 last_error → 映射 HTTP 状态码        │
  │    成功 → 从 result 取 token → res.cookie写入      │
  │           Cookie 属性与 Better Auth session 一致    │
  │           (httpOnly, Secure生产, SameSite=Lax, 7d) │
  │         → 200 { user }                             │
  └──────────────────────────────────────────────────┘
```

**Session Cookie 写入**: `auth.api.verifyPhoneNumber` 成功后返回 `{ token, user }`。Controller 层手动调用 `res.cookie('flowweb.session_token', token, COOKIE_OPTIONS)`，配置必须与 `auth.options.session` 完全一致，禁止自定义属性，确保与邮箱登录态统一。

## 4. 数据模型

### 4.1 User 表

```prisma
model User {
  // ... 现有字段 ...
  phoneNumber         String?  @unique @db.VarChar(20)
  phoneNumberVerified Boolean  @default(false)
}
```

### 4.2 Redis Key 设计（Hash Tag 集群兼容）

所有 Key 使用 `{e164}` 包裹手机号，保证同一手机号的所有 Key 落在同一哈希槽。

| Key | 类型 | TTL | 说明 |
|-----|------|-----|------|
| `sms:{e164}:send` | String | 60s | 发送冷却锁, `SET NX` |
| `sms:{e164}:code` | String | 300s | 6位验证码 |
| `sms:{e164}:errors` | String | 300s | 错误计数 |
| `sms:{e164}:last_error` | String | 60s | 最后失败原因(NOT_FOUND\|WRONG\|TOO_MANY) |
| `ratelimit:ip:sms:send:{ip}` | String | 3600s | IP 发送计数 |
| `ratelimit:ip:sms:verify:{ip}` | String | 60s | IP 校验计数 |

**Hash Tag 说明**: `{e164}` 部分作为 Redis Cluster 哈希槽计算依据。单机 Redis 不受影响，提前兼容避免升级改造。

### 4.3 Redis Lua 脚本

#### 写入脚本 (send-sms-code)

```lua
-- KEYS[1] = sms:{e164}:code
-- KEYS[2] = sms:{e164}:errors
-- ARGV[1] = code
-- ARGV[2] = ttl (300)

redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], '0', 'EX', ARGV[2])
return 'OK'
```

#### 校验脚本 (verifyOTP 调用)

```lua
-- KEYS[1] = sms:{e164}:code
-- KEYS[2] = sms:{e164}:errors
-- KEYS[3] = sms:{e164}:last_error
-- ARGV[1] = submitted_code
-- ARGV[2] = max_attempts (5)

local code = redis.call('GET', KEYS[1])
if not code then
  redis.call('SET', KEYS[3], 'NOT_FOUND', 'EX', 60)
  return -1  -- NOT_FOUND
end

if ARGV[1] ~= code then
  local errors = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], 300)
  if errors >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    redis.call('SET', KEYS[3], 'TOO_MANY', 'EX', 60)
    return -2  -- TOO_MANY
  end
  redis.call('SET', KEYS[3], 'WRONG', 'EX', 60)
  return -3  -- WRONG
end

-- 正确
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return 0  -- OK
```

**返回值**: 0=成功, -1=过期/不存在, -2=超限作废, -3=错误

#### 预加载与降级策略

1. 应用启动时 `SCRIPT LOAD` 两个脚本，缓存 SHA 摘要
2. 运行时优先 `EVALSHA` 调用（减少网络传输）
3. 若返回 `NOSCRIPT` 错误（Redis 重启/主从切换导致脚本丢失）→ 自动回退 `EVAL` 并重新 `SCRIPT LOAD`
4. 单机 Redis 不受影响，提前兼容高可用架构升级

#### bcrypt 加固（可选，本期不实施）

当前 Redis 验证码明文存储，依托内网隔离与 5 分钟 TTL 风险可控。若后续等保合规升级，可改为 bcrypt 哈希存储，校验时慢哈希比对。

## 5. Better Auth 配置

```typescript
// auth.ts
import { phoneNumber } from "better-auth/plugins";

export const auth = betterAuth({
  // ... 现有配置不变 ...
  plugins: [
    phoneNumber({
      sendOTP: async () => { /* no-op: SMS已在Controller发送 */ },
      verifyOTP: async ({ phoneNumber, code }) => {
        // 返回 true/false，插件无法区分具体原因
        const result = await luaVerifyOtp(phoneNumber, code);
        return result === 0; // true=成功, false=失败
      },
      signUpOnVerification: {
        getTempEmail: (phone) =>
          `phone_${Buffer.from(phone).toString('base64url')}@sms.flowweb.local`,
        getTempName: (phone) => phone.slice(-4),
      },
      callbackOnVerification: async ({ phoneNumber, user }) => {
        if (!user?.id) {
          logger.warn({ phone: maskPhone(phoneNumber) },
            'callbackOnVerification: user null, skip folders');
          return;
        }
        try {
          await createDefaultFoldersForUser(user.id);
        } catch (err) {
          logger.error({ userId: user.id, err },
            'Default folders creation failed');
        }
      },
      phoneNumberValidator: (phone) => /^\+86\d{11}$/.test(phone),
      // 不配置 allowedAttempts/expiresIn/otpLength — 自定义 verifyOTP 时无效
    }),
  ],
});
```

## 6. Controller 错误码映射

Controller 调用 `auth.api.verifyPhoneNumber` 后：

```typescript
try {
  const result = await auth.api.verifyPhoneNumber({
    body: {
      phoneNumber: e164,
      code,
      updatePhoneNumber: false, // 必须关闭！
      // 默认 true 会走"已登录用户更新手机号"分支，无 session 返回
      // USER_NOT_FOUND，不会触发 signUpOnVerification 自动注册
    }
  });
  // 成功 → Set-Cookie → 200
} catch (err) {
  // 失败 → 读取 Redis last_error 映射
  const reason = await redis.get(`sms:${e164}:last_error`);
  await redis.del(`sms:${e164}:last_error`);

  switch (reason) {
    case 'NOT_FOUND': return res.status(400).json({
      error: '请先获取验证码', code: 'OTP_NOT_FOUND'
    });
    case 'WRONG': return res.status(400).json({
      error: '验证码错误', code: 'INVALID_OTP'
    });
    case 'TOO_MANY': return res.status(403).json({
      error: '错误次数过多，请重新获取验证码', code: 'TOO_MANY_ATTEMPTS'
    });
    default: return res.status(400).json({
      error: '验证失败，请重试', code: 'VERIFICATION_FAILED'
    });
  }
}
```

## 7. 限流设计

| 维度 | 接口 | 限制 | 算法 | Key |
|------|------|------|------|-----|
| 手机号 | send | 1次/60s | `SET NX` | `sms:{e164}:send` |
| IP | send | 20次/小时 | `INCR+EXPIRE` | `ratelimit:ip:sms:send:{ip}` |
| IP | verify | 10次/分钟 | `INCR+EXPIRE` | `ratelimit:ip:sms:verify:{ip}` |
| 手机号 | verify | 5次错误/300s | Lua 原子计数 | `sms:{e164}:errors` |

限流器位于 `apps/api/src/common/services/rate-limiter.service.ts`，预留 IP 白名单配置（环境变量 `RATE_LIMIT_IP_WHITELIST`），支持精确 IP 与 CIDR 网段（如 `10.0.0.0/8`）。

429 响应体:
```json
{ "error": "...", "code": "PHONE_RATE_LIMITED" }  // 手机号
{ "error": "...", "code": "IP_RATE_LIMITED" }      // IP
```

## 8. 真实 IP 获取

```typescript
// main.ts
app.set('trust proxy', true);

// rate-limiter.service.ts
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'] as string;
  return forwarded?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string)
    || req.ip;
}
```

## 9. 默认文件夹 — 回调 + 补建

- `callbackOnVerification`: 创建默认文件夹（user null 防御 + try/catch）
- `GET /api/auth/me` 末尾: `ensureDefaultFolders(userId)` 幂等补建

## 10. 日志脱敏

```typescript
function maskPhone(phone: string): string {
  // +8613800138000 → +86138****8000
  return phone.replace(/^(\+\d{2}\d{3})\d{4}(\d{4})$/, '$1****$2');
}
```

## 11. Prometheus 指标

```
sms_send_total{status="success|fail", rate_limit_dimension="phone|ip"}
phone_login_total{status="success|wrong|expired|too_many"}
```

## 12. 安全矩阵

| 威胁 | 防护 | 实现 |
|------|------|------|
| 同手机号高频发送 | `SET NX` 60s 原子锁 | Redis Hash Tag Key |
| 单 IP 批量不同手机号 | 固定窗口 20次/小时 | Redis INCR+EXPIRE |
| 单 IP 暴力校验 | 固定窗口 10次/分钟 | Redis INCR+EXPIRE |
| 验证码并发校验 | Lua 原子校验+删除 | Redis Eval |
| 验证码暴力破解 | Lua 原子计数, 5次作废 | Redis Eval |
| 弱随机数 | `crypto.randomInt` | Node.js crypto |
| SMS 失败残留 OTP | 先写 Redis 再发 SMS, 失败回滚 | Controller |
| 注册脏数据 | callback + GET /me 补偿 | 应用层 |
| Session 劫持 | HttpOnly+Secure+SameSite | Better Auth |
| 跨槽错误 | Hash Tag `{e164}` | Redis Key 设计 |

## 13. 文件变更清单

| 文件 | 操作 |
|------|------|
| `apps/api/src/auth/auth.ts` | 修改 — phoneNumber 插件 (verifyOTP, signUp, callback) |
| `apps/api/prisma/schema.prisma` | 修改 — User 新增字段 |
| `apps/api/src/common/services/rate-limiter.service.ts` | 新增 — 通用限流(IP窗口+手机号锁+白名单) |
| `apps/api/src/common/services/lua-scripts.ts` | 新增 — Lua 脚本常量+预加载 |
| `apps/api/src/modules/sms/sms.service.ts` | 新增 — 腾讯云SMS+Redis Lua调用 |
| `apps/api/src/modules/sms/sms.module.ts` | 新增 — SMS 模块 |
| `apps/api/src/common/utils/mask-phone.ts` | 新增 — 脱敏工具 |
| `apps/api/src/common/metrics/sms-metrics.ts` | 新增 — Prometheus |
| `apps/api/src/auth/dto/send-sms-code.dto.ts` | 新增 — DTO |
| `apps/api/src/auth/dto/phone-login.dto.ts` | 新增 — DTO |
| `apps/api/src/auth/auth.controller.ts` | 修改 — 新增端点+错误码映射 |
| `apps/api/src/auth/auth.module.ts` | 修改 — 导入 SmsModule |
| `apps/api/src/main.ts` | 修改 — `trust proxy` |
| `apps/web/src/components/auth/PhoneLoginForm.tsx` | 修改 — 接入API+区分限流提示 |
| `apps/web/src/pages/login/page.tsx` | 修改 — onLoginSuccess |
| `apps/web/src/components/auth/LoginModal.tsx` | 修改 — onLoginSuccess |
| `apps/web/src/components/AuthProvider.tsx` | 修改 — User 类型 |
| `apps/api/.env.example` | 修改 — SMS 环境变量 |

## 14. 环境变量

```env
TENCENT_SMS_SECRET_ID=AKIDQm047NQHwOiqnZAYlkXBd5Xpuy42ta9d
TENCENT_SMS_SECRET_KEY=MYYMzPceeWDl6NTQQKA963qhMp57zgAR
TENCENT_SMS_SDK_APP_ID=1400964061
TENCENT_SMS_TEMPLATE_ID=2680156
TENCENT_SMS_SIGN_NAME=FlowWeb
RATE_LIMIT_IP_WHITELIST=127.0.0.1,::1
```

## 15. 验收标准

### 功能
1. 正确验证码 → 登录成功，跳转 /canvas
2. 新手机号 → 自动注册 + 登录成功
3. 验证码不存在 → 400 "请先获取验证码" (code: OTP_NOT_FOUND)
4. 验证码输错 → 400 "验证码错误" (code: INVALID_OTP)
5. 5次错误 → 403 "错误次数过多" (code: TOO_MANY_ATTEMPTS) + 验证码作废

### 安全
6. SMS 发送失败 → Redis code/errors 已删除 + 锁释放 → 可立即重试
7. 同手机号并发发送 → 仅 1 条成功 (SET NX)
8. 单 IP 1h 超 20 次发送 → 429 IP_RATE_LIMITED
9. 单 IP 1min 超 10 次校验 → 429 IP_RATE_LIMITED
10. APISIX 网关 → IP 限流基于真实客户端 IP
11. 同一验证码并发登录 → Lua 原子校验仅 1 次成功
12. 自定义 verifyOTP 模式下 → 插件 DB 无 OTP 残留, OTP 由 Redis 全生命周期管理

### 运维
13. 手机号登录后 `GET /api/auth/me` 正确返回 + 触发文件夹补建
14. 生产 Cookie: HttpOnly + Secure + SameSite=Lax
15. callbackOnVerification user==null → 登录正常
16. 日志手机号脱敏, 无验证码明文
17. 429 响应含 code 字段区分限流维度
18. Lua 脚本单元测试覆盖 OK/NOT_FOUND/WRONG/TOO_MANY + 原子性
19. 所有现有测试通过
