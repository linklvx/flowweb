# Spec: 微信扫码登录（开放平台网站应用）

**日期**: 2026-08-17
**状态**: 待确认（v2 — 方案改为 WxLogin iframe 嵌入，实测否决 qrcode.react 方案）
**版本**: v2

---

## 1. 概述

在登录弹窗/独立页中接入**微信开放平台「网站应用」扫码登录**，采用**微信官方 WxLogin JS SDK（iframe 嵌入真二维码）**方案。

- 微信体系：开放平台网站应用（`connect/qrconnect`，scope=`snsapi_login`）
- 交互：登录弹窗内嵌 iframe 显示微信真二维码，扫码确认后父页面跳转回调，**无需轮询**
- 测试：仅生产/测试服务器验证

**方案演进（v1→v2）**：
- v1 用 `qrcode.react` 把 qrconnect URL 渲染成二维码，实测**否决**：微信扫到 qrconnect URL 时不当登录请求，而当作普通链接打开 → 又显示微信登录页 → 死循环。
- v2 改用 **WxLogin JS SDK**：iframe 加载 `qrconnect?...&login_type=jssdk`，微信服务器返回可嵌入的真二维码页面。已实测 `wxLogin.js` 脚本（HTTP 200）与 `login_type=jssdk` 参数（返回含二维码的 iframe 页面）均可用。

---

## 2. 完整流程图

```
桌面浏览器                      微信服务器
    │ 加载 wxLogin.js + new WxLogin({...})
    │──────────────────────────────> 返回 iframe
    │<────────────────────────────── iframe 内显示微信真二维码（login_type=jssdk）
    │
    │  （用户手机微信扫 iframe 里的真二维码 → 微信弹「Flow123 确认登录」→ 确认）
    │
    │  微信回调 redirect_uri（父页面跳转，self_redirect=false）
    │──────────────────────────────────────────────────────────>  GET /api/auth/wechat/callback?code=C&state=S
    │
    │  [后端] code → access_token + openid + unionid → userinfo → 建用户 → 签发 session → Set-Cookie
    │<──────────────────────────────────────────────────────────  302 → /canvas（已登录）
```

**关键点**：`self_redirect: false` 使扫码确认后**父页面**（整个页面）跳转到 redirect_uri，弹窗随跳转自然消失。session 自然落在桌面浏览器，无需 Redis ticket + 轮询。

---

## 3. 微信 API 对接

| 步骤 | 端点 | 参数 | 返回关键字段 |
|------|------|------|-------------|
| 换 token | `https://api.weixin.qq.com/sns/oauth2/access_token` | `appid` `secret` `code` `grant_type=authorization_code` | `access_token` `openid` `unionid` |
| 用户信息 | `https://api.weixin.qq.com/sns/userinfo` | `access_token` `openid` `lang=zh_CN` | `openid` `nickname` `headimgurl` `unionid` |

### 调用策略（`wechat.service.ts` 统一封装）

- **HTTP 超时 5s**（axios timeout）
- **有限重试**：微信偶发 5xx，重试 1-2 次，指数退避
- **errcode 解析**：微信错误不是 HTTP 状态码，而是 200 响应 body 里的 `errcode`/`errmsg` 字段，需显式判断

---

## 4. 数据模型

### User 表新增字段（不变）

```prisma
model User {
  // ...现有字段...
  wechatOpenid   String? @unique @db.VarChar(64)
  wechatUnionid  String? @db.VarChar(64)
}
```

微信用户首次登录自动注册：`name`=昵称，`email`=`wechat_{base64url(openid)}@wechat.flowweb.local`，`emailVerified`=false，`image`=头像，`wechatOpenid`=openid。同时创建默认素材文件夹。`UserBalance` 惰性创建。

---

## 5. Session 签发机制（关键，不变）

**已通过源码实证**：Better Auth 1.6.11 的 session token = `generateId(32)`（32 字符随机串 `[a-zA-Z0-9]`，明文无哈希无签名）。本项目 `AuthService.getSession` 直接 `session.findUnique({ where: { token } })`。因此手动创建明文 token 的 session 可被识别。

**手动签发 session**：token 32 随机串，`expiresAt = now + SESSION_COOKIE_OPTIONS.maxAge`（同源常量，不硬编码）。Cookie 复用 `SESSION_COOKIE_OPTIONS`（httpOnly + SameSite=Lax + Secure(生产) + maxAge 7d，无 domain；生产同域反代 `www.flow123.com/api`）。

---

## 6. 后端接口设计（大幅简化：2 个端点）

新增 `apps/api/src/auth/wechat/` 模块。

### 6.1 `GET /api/auth/wechat/config`（公开）

返回 WxLogin 前端初始化所需的非敏感配置：

```json
{ "appid": "wx3fbc0883483c161a" }
```

> appid 非敏感（微信官方前端跳转本就携带），secret 绝不返回。

### 6.2 `GET /api/auth/wechat/callback?code=C&state=S`

- 用 `code` 换 `access_token` + `openid` + `unionid`
- 用 `access_token` + `openid` 换 `nickname` + `headimgurl`
- `findOrCreateUser`（按 wechatOpenid 查，不存在则建 User + 默认文件夹）
- `createSession`（手动签发）
- `res.cookie('flowweb.session_token', token, SESSION_COOKIE_OPTIONS)`
- `302 重定向` 到 `/canvas`（或前端登录前的来源页）

**失败处理**：callback 是父页面跳转（非 AJAX），失败时不能返回 502 错误页（浏览器默认错误页体验差）。改为 `302 重定向` 到 `/login?error=wechat_failed`，登录页读取 query 显示「微信登录失败，请重试」。

---

## 7. 配置与环境变量（不变）

```env
WECHAT_APP_ID=wx3fbc0883483c161a
WECHAT_APP_SECRET=<仅 .env，不入 DB/git/前端>
WECHAT_LOGIN_REDIRECT_URI=https://www.flow123.com/api/auth/wechat/callback
```

- `WECHAT_APP_ID`：DB 白名单（后台可编辑）+ `.env` 兜底（main.ts preload 覆盖 process.env）
- `WECHAT_APP_SECRET`：仅 `.env`（sensitive，SettingsTab 标记只读）
- `WECHAT_LOGIN_REDIRECT_URI`：仅 `.env`

---

## 8. 前端改造（WxLogin iframe）

### 8.1 `WeChatQRLogin.tsx`

- 动态加载 `https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js`
- 先调 `GET /api/auth/wechat/config` 获取 appid
- `new WxLogin({ self_redirect:false, id, appid, scope:'snsapi_login', redirect_uri:encodeURIComponent(callback), state })`
- 在容器 div 渲染 iframe（微信真二维码）
- 保留「或」分隔线 + 「邮箱登录」按钮（`onAlternativeLogin`）

**iframe 尺寸约束**：WxLogin 默认渲染约 300×400px（二维码 + 提示文字），而当前微信区域仅 320px 宽。实现时需调整 LoginModal 微信区域容器宽度（≥300px），或通过 WxLogin 的 `style` 参数自定义 iframe 尺寸；iframe 内二维码不能过小（影响扫码）。

**wxLogin.js 加载失败降级**：脚本加载超时（5s）/失败 → 显示「微信登录暂时不可用，请使用邮箱登录」占位，保留「邮箱登录」按钮可切换。

### 8.2 `LoginModal.tsx` / `pages/login/page.tsx`

- 传入 `onLoginSuccess`（弹窗：`refresh()+onClose()`；独立页：跳 `/canvas`）

> 注意：WxLogin `self_redirect:false` 下，扫码确认后整个页面跳转，`onLoginSuccess` 实际不触发（页面已跳走）。onLoginSuccess 仅作兼容保留。

---

## 9. 安全矩阵

| 威胁 | 防护 |
|------|------|
| AppSecret 泄露 | 仅 .env；config 接口只返回 appid |
| CSRF（伪造回调） | state 传随机串但**不校验**（微信回调由用户主动扫码触发，CSRF 风险极低，本期明确不做 state 校验） |
| openid 枚举 | openid 只存后端 |
| 会话劫持 | HttpOnly + SameSite=Lax + Secure(生产)，token 32 随机串 |
| 微信昵称注入 | React 默认转义 |

---

## 10. 测试覆盖清单（TDD）

### 后端（Vitest，mock 微信 HTTP + Prisma）

- [ ] `config`：返回 `{ appid }`，不含 secret
- [ ] `callback`：微信换 token 失败 → 302 重定向 `/login?error=wechat_failed`（不返回 502 错误页）
- [ ] `callback`：新 openid → 创建 User（临时 email + openid + 默认文件夹）
- [ ] `callback`：已存在 openid → 复用 User
- [ ] `callback`：成功 → Set-Cookie + 302 重定向 `/canvas`
- [ ] `createSession`：token 32 字符明文 + expiresAt 用 SESSION_COOKIE_OPTIONS.maxAge
- [ ] `findOrCreateUser`：临时 email 格式正确

### 前端（Testing Library + Vitest，mock wxLogin.js + config fetch）

- [ ] 挂载后加载 wxLogin.js + 调 config 接口
- [ ] 初始化 WxLogin（验证容器 div 渲染）
- [ ] 保留「邮箱登录」按钮触发 onAlternativeLogin

---

## 11. 验收标准

1. 登录弹窗内 iframe 显示微信真二维码（非 qrcode.react 渲染的 URL 二维码）
2. 手机扫码 → 微信弹「Flow123 确认登录」→ 确认后桌面端自动登录跳转 `/canvas`
3. 首次扫码自动注册，二次扫码复用同一账号
4. AppSecret 不出现在前端 bundle、git、DB 中
5. 现有测试通过，新增测试覆盖 §10

---

## 12. 文件变更清单

| 文件 | 操作 |
|------|------|
| `apps/api/prisma/schema.prisma` | 已改 — User 新增 wechatOpenid/wechatUnionid |
| `apps/api/src/config/env.ts` | 已改 — 新增 3 个微信登录环境变量 |
| `apps/api/src/modules/admin/settings/settings.service.ts` | 已改 — wechat_login 白名单 |
| `apps/api/src/main.ts` | 已改 — WECHAT_APP_ID 白名单 |
| `apps/api/src/auth/wechat/wechat.service.ts` | 保留 — 微信 API + findOrCreateUser + createSession |
| `apps/api/src/auth/wechat/wechat.controller.ts` | 修改 — 删 qr-code/status，改为 config + callback(302) |
| `apps/api/src/auth/wechat/wechat.controller.spec.ts` | 修改 — 测试改为 config + callback |
| `apps/web/src/components/auth/WeChatQRLogin.tsx` | 修改 — qrcode.react → WxLogin iframe |
| `apps/web/src/components/auth/WeChatQRLogin.test.tsx` | 修改 — 测试改为 WxLogin 初始化 |
| `apps/web/src/components/auth/LoginModal.tsx` | 保留 onLoginSuccess（可选） |
| `apps/web/src/pages/login/page.tsx` | 修改 — 读取 `?error=wechat_failed` 显示失败提示 |

---

## 13. 非目标（本期不做）

- 公众号/小程序登录、账号绑定合并、unionid 跨应用打通、移动端适配、Socket.io 替代轮询
