<!-- doc-status: historical | verified_at: n/a -->
# Plan: 微信扫码登录（WxLogin iframe 方案）

**日期**: 2026-08-17
**状态**: 待确认（v2）
**关联 Spec**: `docs/superpowers/specs/2026-08-17-wechat-qr-login.md`

---

## 0. 关键决策（对齐 spec v2）

| 决策 | 方案 |
|------|------|
| 前端方案 | WxLogin JS SDK（iframe 嵌入微信真二维码） |
| self_redirect | false（父页面跳转回调） |
| 后端端点 | config（公开返回 appid）+ callback（302 重定向） |
| callback 失败 | 302 → `/login?error=wechat_failed` |
| state | 传随机串，前后端都不校验 |
| wxLogin.js 加载失败 | 5s 超时降级 + 邮箱登录按钮 |
| Session 签发 | 手动创建（token 32 明文 + SESSION_COOKIE_OPTIONS.maxAge） |

**复用已实现的**（v1 已通过测试，无需改动）：`wechat.service` 的 getAccessToken / getUserInfo / findOrCreateUser / createSession；User 表字段；`.env`/DB 白名单/main.ts 配置。

---

## 1. 任务分解（TDD：每任务先改测试 → 红 → 绿 → 重构）

### 阶段 A：精简 wechat.service（删 v1 的 ticket/URL 方法）

#### A1. 删除 `generateTicket` + `buildQrConnectUrl`

- **文件**：`wechat.service.ts` + `wechat.service.spec.ts`
- WxLogin 方案下前端 SDK 自行构建 iframe URL，后端不再需要这两个方法
- **验证**：删除对应测试后，剩余 6 个测试（getAccessToken×2、getUserInfo、findOrCreateUser×2、createSession×2）通过

### 阶段 B：改造 wechat.controller（config + callback 302）

#### B1. 删除 `qr-code` + `status` 端点，去掉 Redis/RateLimiter 依赖

- 删除 `createQrCode`、`status` 方法
- 构造函数只保留 `WechatService` 依赖（去掉 `@Inject('REDIS_CLIENT')`、`RateLimiterService`）

#### B2. 新增 `GET /api/auth/wechat/config`

- 返回 `{ appid: process.env.WECHAT_APP_ID }`（非敏感）

#### B3. 改造 `GET /api/auth/wechat/callback?code&state`

- 成功：换 token → userinfo → findOrCreateUser → createSession → Set-Cookie → **302 `/canvas`**（本期固定 `/canvas`，来源页回跳为后续优化）
- 失败：**302 `/login?error=wechat_failed`**（不返回 502 错误页）

**测试用例**（`wechat.controller.spec.ts` 重写，直接构造 controller mock service）：

- [ ] `config` 返回 `{ appid }`，不含 secret
- [ ] `callback` 微信换 token 失败 → 302 `/login?error=wechat_failed`
- [ ] `callback` 新 openid → findOrCreateUser 被调用 + createSession 被调用
- [ ] `callback` 成功 → Set-Cookie（复用 SESSION_COOKIE_OPTIONS）+ 302 `/canvas`

### 阶段 C：前端 WeChatQRLogin（WxLogin）

#### C1. qrcode.react → WxLogin iframe

- 动态加载 `https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js`
- 先调 `GET /api/auth/wechat/config` 获取 appid
- `new window.WxLogin({ self_redirect:false, id, appid, scope:'snsapi_login', redirect_uri:encodeURIComponent(callback), state:随机串 })`
- 容器 div 渲染 iframe

#### C2. 降级处理

- 脚本加载 5s 超时/失败 → 显示「微信登录暂时不可用，请使用邮箱登录」，保留邮箱登录按钮

**测试用例**（`WeChatQRLogin.test.tsx` 重写，mock window.WxLogin + global.fetch + 动态脚本）：

- [ ] 挂载后调 config 接口 + 加载 wxLogin.js
- [ ] 初始化 WxLogin（验证 `window.WxLogin` 被调用，参数含 self_redirect:false + appid）
- [ ] 脚本加载失败 → 显示降级占位 + 邮箱登录按钮可用
- [ ] 「邮箱登录」按钮触发 onAlternativeLogin

### 阶段 D：前端 LoginModal/page 适配

#### D1. LoginModal 微信区域尺寸适配

- 微信区域容器**宽高**调整为可容纳 WxLogin iframe（约 300×400px），或通过 WxLogin `style` 参数自定义 iframe 尺寸适配现有容器（原二维码区仅 145px 高，需同时调高度）

#### D2. page.tsx 读取 error query

- `?error=wechat_failed` → 显示「微信登录失败，请重试」提示

---

## 2. 验证命令

```bash
# 后端（阶段 A/B）
cd apps/api && pnpm test

# 前端（阶段 C/D）
cd apps/web && pnpm exec vitest run src/components/auth/

# 类型检查（后端严格模式）
cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json
```

---

## 3. 风险与回退

| 风险 | 缓解 |
|------|------|
| WxLogin SDK 未来下线 | 已实测脚本 200 + login_type=jssdk 可用；若微信下线则回退整页跳转 |
| iframe 尺寸溢出 | 阶段 D1 调整容器宽度；WxLogin `style` 参数可自定义 |
| wxLogin.js 加载失败 | 阶段 C2 降级 + 邮箱登录按钮兜底 |
| 手动签发 session 不兼容 | 已源码实证 token 明文无哈希；createSession 测试锁定格式 |

---

## 4. 非目标（对齐 spec §13）

公众号/小程序登录、账号绑定合并、unionid 打通、移动端适配、Socket.io 替代轮询
