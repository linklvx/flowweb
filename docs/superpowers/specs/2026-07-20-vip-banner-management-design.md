<!-- doc-status: historical | verified_at: n/a -->
# VIP 促销 Banner 后台管理 — 设计文档

## 概述

为会员订阅页面的促销 Banner 提供后台管理能力。在 Admin 后台「会员订阅」分区下新增「Banner 管理」Tab，支持编辑 Banner 的标题、副标题、背景图片、倒计时等配置。前端 VIP Modal 改为数据驱动渲染。

---

## 一、数据模型

新增 `SubscriptionBanner` 表（单例，全局唯一记录）：

```prisma
model SubscriptionBanner {
  id                  String    @id @default("subscription-banner-singleton")
  /// Banner 标题文字，最多64字符
  title               String    @db.VarChar(64)
  /// Banner 副标题/描述文字，最多200字符
  subtitle            String    @db.VarChar(200)
  /// 外部图片URL，优先使用已上传图片
  backgroundImageUrl  String?   @db.VarChar(500)
  /// MinIO 对象存储 Key，优先级高于外部URL
  backgroundImageKey  String?   @db.VarChar(255)
  /// 倒计时截止时间，UTC存储；为空则不展示倒计时
  countdownEndAt      DateTime?
  /// 倒计时归零后自动顺延3天，仅countdownEndAt非空时生效
  autoExtend          Boolean   @default(false)
  isActive            Boolean   @default(true)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
```

**设计要点：**
- 固定主键 `"subscription-banner-singleton"`，Service 层统一 upsert，杜绝多行
- DTO 校验：`autoExtend=true` 时 `countdownEndAt` 必填
- 迁移脚本 upsert 初始化一条默认记录（`isActive=false`，其余字段为空），保证幂等

---

## 二、API 设计

### Admin 端（复用 Admin 角色守卫）

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/admin/subscription/banner` | 获取完整 banner 配置（含内部字段） |
| `PATCH` | `/api/admin/subscription/banner` | 部分更新 banner 配置 |
| `POST` | `/api/admin/subscription/banner/upload` | 上传背景图片（multipart/form-data） |

**PATCH 校验规则：**
- `autoExtend=true` 时 `countdownEndAt` 必填
- `title` ≤ 64，`subtitle` ≤ 200
- `backgroundImageUrl`：仅允许 `http://` / `https://`，拦截内网 IP / 内网域名（防 SSRF），过滤 `javascript:`、`data:` 等危险协议。复用项目现有 URL 安全校验工具
- 字符串字段 XSS 过滤

**图片上传校验：**
- MIME 白名单：`image/jpeg`、`image/png`、`image/webp`
- 文件头魔数校验（防脚本伪装）
- 文件大小 ≤ 2MB
- 存储路径：`subscription/banner/YYYYMMDD/[随机].webp`
- 复用项目现有 MinIO 工具类

**图片访问方式：**
- 若为私有桶，前端不可直接拼接 MinIO 地址，须通过项目统一文件代理接口或预签名 URL 访问
- 与项目现有素材访问逻辑对齐

**PATCH 后置处理：**
- 事务提交后：删除 Redis 缓存 `{project}:subscription:banner:public`
- 仅当 `backgroundImageKey` 字段变更时，触发旧 MinIO 文件异步删除
- 删除任务复用项目现有 BullMQ 资源清理队列，任务类型 `minio:object:delete`，3 次重试 + 死信队列
- 写审计日志（操作人 ID + 变更前后全量对比）

### 用户端（公开接口，无需登录）

`GET /api/subscription/banner`

**返回结构（字段裁剪）：**
```ts
{
  title: string;
  subtitle: string;
  backgroundImageKey: string | null;
  backgroundImageUrl: string | null;
  countdownEndAt: string | null;  // ISO 8601 UTC
}
```

**自动延期逻辑（懒触发）：**
1. 查库 → 判断 `isActive && autoExtend && countdownEndAt < now()`
2. 触发延期 → Redis 分布式锁：
   - 加锁：`SET {project}:subscription:banner:auto-extend:lock <requestUuid> NX PX 1000`
   - value 写入唯一请求 UUID（非固定值），用于所有权校验
3. 获锁 → `countdownEndAt += 3天`（基于原截止时间）→ 写审计日志 → 删缓存
4. 释放锁：Lua 脚本原子校验 value 匹配后删除，避免误释放其他请求的锁
5. 未获锁 → 直接返回当前数据

**缓存策略：**
- 用户端 GET 缓存 60s，key=`{project}:subscription:banner:public`
- Admin PATCH 成功后删除缓存
- 自动延期成功后同步删除缓存
- 接口返回 null 时空值也缓存 60s（防穿透）
- 缓存有效期与倒计时归零触发延迟 ≤ 60s（可接受）

---

## 三、前端实现

### Admin 端 — BannerManagementTab

- 归属：`apps/web/src/pages/admin/components/BannerManagementTab.tsx`
- 路由：Admin 页面「会员订阅」分区下新增第 4 个 Tab「Banner 管理」
- 布局：左侧表单区 + 右侧实时预览区
- 交互：
  - 上传图片后自动清空 URL 输入框；输入 URL 后清除已上传文件
  - 保存 → PATCH → 成功提示
  - 预览区 1:1 还原 VIP Modal Banner 样式
- 表单联动校验：
  - 勾选「自动延期」→ 截止时间输入框强制必填
  - 清空截止时间 → 自动延期选项灰置不可选
  - 与后端 DTO 校验规则对齐

### Admin page.tsx 改动

- `subTab` 类型加 `'banner'`
- Tab 按钮列表添加 `'banner' → 'Banner 管理'`
- 条件渲染添加 `{subTab === 'banner' && <BannerManagementTab />}`

### VIP Modal 改动

`VipSubscribeModal.tsx` 中 Banner 区域改为数据驱动：

```
GET /api/subscription/banner →
  ├─ null / !isActive → 显示默认 banner（现有硬编码渐变+文案）
  └─ 有数据 →
       ├─ 背景：backgroundImageKey → 加载失败降级 backgroundImageUrl → 再失败降级默认渐变
       ├─ 文案：title / subtitle
       └─ 倒计时：countdownEndAt (UTC) → setInterval 1s → 归零后重新 GET
```

**倒计时精度校准：**
- 监听 `visibilitychange` 事件，页面从后台切回前台时重新计算剩余时间
- 若倒计时已归零，触发接口重新拉取（触发后端自动延期）

**布局稳定性：**
- Banner 区域设置固定高度，无论是否展示、图片是否加载完成，均不挤压下方会员计划列表

**内存安全：**
- `useEffect` cleanup 清除 `setInterval` + 移除 `visibilitychange` 监听
- 组件卸载时清理所有定时器

---

## 四、模块划分

归属 `subscription` 模块，新增：

| 文件 | 说明 |
|------|------|
| `subscription-banner.service.ts` | CRUD、自动延期、缓存、分布式锁 |
| `subscription-banner.controller.ts` | Admin + Public 两个路由组 |
| DTO / 校验类 | 遵循 NestJS 模块化规范 |

---

## 五、可观测性

| 指标 | 说明 |
|------|------|
| `subscription_banner_view_total` | 用户端接口调用次数 |
| `subscription_banner_auto_extend_total` | 自动延期成功次数 |
| `subscription_banner_upload_total` | 图片上传次数及成功率 |

Sentry 告警：上传失败、MinIO 异常、分布式锁超时、异步删除多次重试失败。

---

## 六、风险与边界

- **时区一致性**：全链路 UTC 存储，前端本地时间渲染
- **缓存最终一致性**：Admin 更新后缓存删除失败最多 60s 旧数据
- **自动延期依赖访问**：无用户访问则自动延期不触发，符合业务逻辑
- **外链安全**：URL 协议白名单校验，防 XSS 注入
- **单例保障**：固定主键 + upsert，杜绝多行
