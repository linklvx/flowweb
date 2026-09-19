# Flow123 首页布局重做（liblib.tv 风格）— 设计规格

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-08-31 |
| 参考 | https://www.liblib.tv/ 首页（左侧固定边栏完整布局） |
| 范围 | 全站布局替换（侧边栏+操作栏+公告条）、首页重排（Banner 轮播+创作区+Footer）、公告条/首页 Banner 后台配置 |
| 资源 | Logo：`apps/web/public/img/LOGO.png`；公众号二维码：`apps/web/public/img/wechat-qrcode.jpg` |

## 1. 已确认决策记录

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 侧边栏范围 | **全站替换 Navbar**（Navbar 被 7 处复用，是事实上的全站导航） |
| D2 | 侧边栏菜单 | **四项**：首页 `/`、模板广场 `/templates`、素材库 `/materials`、工作空间 `/works`（原文档布局图与菜单列表矛盾，取含素材库） |
| D3 | 布局架构 | 路由级嵌套布局 `AppLayout`（非页面级组合） |
| D4 | 轮播实现 | 手写（antd Carousel 无法满足胶囊指示器/hover 暂停/默认隐藏箭头） |
| D5 | 公告数据 | 扩展现有 `Announcement` 模型（不新建模型） |
| D6 | `/team` | **套新布局**（否则 TeamPage 无导航返回，且与 TeamBillingPage 不一致） |
| D7 | 移动端 | `min-w-[1200px]` + 窄屏横向滚动；侧边栏用 **sticky**（非 fixed，避免横滚时内容钻到侧栏下）；汉堡抽屉后续迭代 |
| D8 | content/cards 后端 | 后端端点/模型/迁移**一律不碰**，前端连带删除消费组件，PR 描述登记 |
| D9 | 文档中心链接 | 点击 toast "敬请期待"，不跳转（无真实 URL，不编造） |
| D10 | Banner presign 有效期 | **3600s**（优于现有 VIP banner 900s 惯例，零前端逻辑） |
| D11 | VipSubscribeModal 挂载 | **上移 AppLayout 全局挂载**（仅首页挂载会使其余 6 个布局页"会员充值"成死按钮；组件 createPortal 全局安全） |
| D12 | TopActionBar 积分数据源 | **改用既有 creditsStore**（fetchBalance 同两接口并联 + applyBalance 全局联动；Navbar 裸 fetch 是仓库异类，不复制） |

## 2. 路由与布局架构

### 2.1 路由重组（router.tsx）

AppLayout 子路由公私混合，不能塞进单一 layout route，指定为两组共享同一布局元素：

```tsx
export const router = createBrowserRouter([
  {
    element: <AppLayout />,          // 公开组
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/templates', element: <TemplateMarketPage /> },
      { path: '/templates/:id', element: <TemplatePreviewPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/join', element: <JoinPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/canvas', element: <CanvasPage /> },   // 不套布局：全屏编辑器
      { path: '/admin', element: <AdminPage /> },     // 不套布局：独立后台
      {
        element: <AppLayout />,      // 登录组
        children: [
          { path: '/team', element: <TeamPage /> },
          { path: '/team/:id/billing', element: <TeamBillingPage /> },
          { path: '/materials', element: <MaterialsPage /> },
          { path: '/works', element: <WorkspacePage /> },
          { path: '/works/:id', element: <TemplatePreviewPage /> },  // 维持现状复用
          { path: '/settings', element: <SettingsLayout />, children: [/* 三级子路由不变 */] },
        ],
      },
    ],
  },
]);
```

### 2.2 AppLayout 骨架

```
<div className="min-w-[1200px] min-h-screen bg-[#141414]">
  {公告可见 && <AnnouncementBar />}        // sticky top-0 z-40，无公告不渲染不占高
  <div className="flex">
    <Sidebar />                            // sticky left-0 self-start z-30（flex 子项须 self-start，默认 stretch 会破坏 sticky）
                                           // top 与高度同源消费公告状态：显示时 top-64px h-[calc(100vh-64px)]，隐藏时 top-0 h-screen
    <main className="flex-1 min-w-0 px-6">
      <TopActionBar />                     // h-14 sticky top-[64|0]px z-20，右对齐
      <Outlet />
    </main>
  </div>
  {vipVisible && <VipSubscribeModal />}    // 全局挂载（组件内部 createPortal，安全）；TopActionBar 在全部布局页可触发 open()，
                                           // 仅首页挂载会使其余页面"会员充值"变死按钮
</div>
```

关键约束：
- 侧边栏 **sticky left-0**（不用 fixed：min-w 横滚时 fixed 侧栏钉死视口，主内容会滚动到侧栏下面）
- 公告条显隐由 announcementStore 驱动，关闭后 sidebar/操作栏 top 偏移即时归零，不留 64px 空槽
- 布局 chrome z-index 分层：公告 z-40 / 侧栏 z-30 / 操作栏 z-20（全部 < 1000，antd 弹层基线已抬到 11000，不打架）
- 套布局的 7 个页面逐页删除自带外壳（`min-h-screen bg-[#0f0f0f]`、`max-w-[1640px] px-[120px]` 等），否则双层背景/错位；SettingsLayout 只删 Navbar，保留内部三级 nav
- **index.css**：body 背景 `#0f0f0f` → `#141414`（边缘过滚露色），字体栈补 `'Helvetica Neue', Arial`（对齐 9.2）
- **preflight 已关闭**（tailwind.config `corePlugins.preflight: false`）：浏览器原生 button 边框/背景、img inline 不会被重置——所有新 button 显式 `border-none cursor-pointer`，Logo/二维码 img 加 `block`
  > 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。

## 3. 前端组件设计

新目录 `src/components/layout/`，首页专属组件在 `src/pages/home/components/`。

### 3.1 `layout/AppLayout.tsx`
职责：布局骨架 + 挂载时 `announcementStore.fetchActive()`（store 带 loaded 标志，公开组↔登录组两棵路由子树切换重挂载时跳过重复请求）+ 渲染公告条/侧边栏/操作栏/Outlet + 全局挂载 `{vipVisible && <VipSubscribeModal />}`（VipSubscribeModal 从 HomePage 上移至此）。

### 3.2 `layout/Sidebar.tsx`
- 容器：`w-[240px]` sticky，bg `#141414`，右边框 `1px solid #262626`，内容 `px-4`，flex column
- **Logo**：pt-5（20px）pb-4（16px），`/img/LOGO.png` 高 28px 宽自适应，Link to `/`
- **新建项目按钮**：h-9 w-full rounded-lg bg `#00bfff` 文字黑 14px/500，PlusOutlined 16px 黑（20px 容器），gap-2 px-2 左对齐，hover 亮度 +10%；onClick `startNewProject(navigate)`
- **导航菜单**（垂直 gap-0.5，菜单项 h-9 rounded-lg px-2 gap-2 左对齐，图标 20px 容器）：

| 名称 | 图标（@ant-design/icons） | 链接 |
| --- | --- | --- |
| 首页 | HomeOutlined | `/` |
| 模板广场 | AppstoreOutlined | `/templates` |
| 素材库 | PictureOutlined | `/materials` |
| 工作空间 | FolderOutlined | `/works` |

  - 激活态（useLocation，前缀匹配，`/` 精确匹配）：bg `#262626`，文字白，字重 500
  - 未激活：文字 `#a0a0a0`，图标 `#707070`，背景透明；hover：bg `#1e1e1e`，文字白
- **底部（mt-auto 推到底）**：
  - 关注公众号入口：h-16（64px）rounded-lg bg `#1e1e1e` hover `#262626`；左侧两行文字（"关注公众号" 12px/500 白；"获取最新动态和福利" 11px `#707070`）；右侧 32px 圆形容器 bg `rgba(7,193,96,0.1)` 内 WechatOutlined 18px `#07c160`；onClick 打开 WeChatFollowModal
  - 文档中心：h-9 rounded-lg，QuestionCircleOutlined 16px `#707070` + 文字 13px `#707070`，gap-2 左对齐；hover bg `#1e1e1e` 文字变亮；onClick antd message.info("敬请期待")

### 3.3 `layout/WeChatFollowModal.tsx`
命名约束：**不能叫 WeChatQRModal**——`src/components/WeChatQRModal.tsx` 已存在且是微信支付弹窗。
- antd Modal + 局部暗色 token（参照 Navbar 现有 Dropdown 的 ConfigProvider 局部覆盖模式），宽 320px，内容 bg `#1e1e1e` rounded-xl
- 标题 "关注公众号" 16px 白居中；`/img/wechat-qrcode.jpg` 200×200 rounded-lg 居中；下方 "扫码关注公众号，获取最新动态和专属福利" 12px `#707070` 居中
- maskClosable + 右上角关闭 ×

### 3.4 `layout/AnnouncementBar.tsx`（新实现，替换旧组件）
- sticky top-0 z-40 全宽；外层 p-2（8px）bg 同页面 `#141414`；内层 h-12 rounded-lg px-12 垂直居中，bg/textColor 取自数据（默认 `#0f2761` / `#ffffff`），cursor-pointer
- 公告文字 14px/500/22px 单行省略；链接按钮（配置了 linkText+linkUrl 才显示）：白边框 `1px solid rgba(255,255,255,0.5)` 透明底白字 13px 圆角 9999px px-3，hover bg `rgba(255,255,255,0.1)`，新窗口打开；onClick 需 `e.stopPropagation()`（它是 `<a target="_blank">`，冒泡会触发整栏 onClick 连开两个相同标签页，只走 anchor 默认行为）
- 关闭按钮：24×24 图标 14px `rgba(255,255,255,0.7)` hover 白，圆形 hover bg `rgba(255,255,255,0.1)`；onClick 需 `e.stopPropagation()`（内容区整条可点击跳转，否则关公告同时触发跳转）并调 `announcementStore.dismiss()`
- 内容区点击行为同链接按钮（未配置链接无跳转）

### 3.5 `layout/TopActionBar.tsx`
- h-14（56px）flex justify-end items-center gap-2，sticky（top 随公告显隐联动）
- 通用按钮：h-8 rounded-lg border `rgba(255,255,255,0.1)` bg `rgba(255,255,255,0.04)` 文字 13px `#d0d0d0` px-2.5，图标 16px `#a0a0a0` gap-1；hover bg `#262626` border `#444` 文字白，过渡 150ms
- **未登录**：赚积分（GiftOutlined → `/settings/credits`）、会员充值（CrownOutlined → `useVipModalStore().open()`）、登录/注册（反色实色：bg `#ffffff` 文字黑 13px/500 无边框 px-4 hover `#e8e8e8`；onClick 打开 LoginModal——局部 state，随组件迁入）。无促销标签
- **登录态**：赚积分、会员充值、积分余额（⚡图标 + `toLocaleString()` 数字白 13px/500 + 会员等级彩色小标签，点击 → `/settings/membership`）、TeamSwitcher（复用现有组件，容器样式适配按钮风格）、头像 32px 圆形 antd Dropdown（团队管理 `/team` / 用户中心 `/settings` / 个人设置 `/settings/profile` / 退出登录）
- 积分/会员数据改用既有 **`creditsStore`**（`fetchBalance()` 内部即 `Promise.all([getBalance, getMe])`，含 tier 字段与 `applyBalance` 充值到账全局联动；Navbar 的裸 fetch 是仓库异类，不复制）；**调用需登录门控**：`useEffect(() => { if (user) void fetchBalance(); }, [user])`，对齐旧 Navbar 的 `if (!user) return` 门控——fetchBalance 无 token 判断，而 TopActionBar 存在于公开组页面，未登录请求会打两个非白名单接口产生 401 噪音
- 未登录三按钮确切行为（保持现状，测试按此断言，勿误接 LoginModal）：**赚积分** `<Link to="/settings/credits">` → 未登录命中 RequireAuth 的 `Navigate to="/login"` **整页跳登录页**；**会员充值** → 未登录也直接 `vipModalStore.open()` 弹 VIP 订阅框（D11 全局挂载后本就可弹，不拦登录）；**登录/注册** → 打开 LoginModal

### 3.6 `pages/home/components/BannerCarousel.tsx`
- 数据：组件内 local state + `apiFetch` 调 `GET /api/home-banners/active`（apiFetch 自动解包后直接得到数组，不建 store）
- loading：骨架 bg `#1e1e1e` 呼吸动画，按 8:1 比例，rounded-xl
- 空（无启用）：不渲染不占高
- 容器：w-full `aspect-[8/1]` rounded-xl overflow-hidden mb-3，group（hover 显示箭头）
- 单张：背景 `cover center`；文字层（配置了才有）：距左 32px 垂直居中，标题 28px/700 白 + `text-shadow: 0 2px 8px rgba(0,0,0,0.5)`，副标题 14px `rgba(255,255,255,0.8)`
- 切换：opacity 300ms 淡入淡出
- 箭头：36×36 圆形 bg `rgba(0,0,0,0.4)` backdrop-blur 白箭头 16px，垂直居中距左右 16px，默认 hidden、group-hover 显示，带 aria-label
- 指示器：底部居中距底 12px，间距 6px；单点 6×6 圆形 `rgba(255,255,255,0.4)`，激活 16×6 胶囊白，可点击跳转
- 自动轮播 5s；hover **和 focus** 暂停；unmount 清 timer；单张时不显示箭头/指示器、不自动轮播
- 点击跳转 linkUrl（新窗口）；未配置链接不可点击
- 单张图片 onError：该张显示占位背景，轮播跳过该张，不影响其他；全部失败等价空态不渲染

### 3.7 `pages/home/components/CreateCanvasCard.tsx`
- h-[200px] w-full rounded-xl border `0.5px solid rgba(8,182,221,0.5)` bg `#1a1a1a` hover `#1e1e1e`，mb-8
- 背景装饰（CSS）：点阵 `rgba(255,255,255,0.03)`；青色渐变光晕 顶部 `rgba(4,202,246,0.04)` → 底部 `rgba(4,202,246,0.1)` 模糊
- 垂直水平居中 gap-4，cursor-pointer；hover 边框亮度提高 + 上移 2px，过渡 200ms
- 中央按钮：120×56 rounded-2xl（16px）bg `#ffffff` 阴影 `0 4px 24px rgba(0,0,0,0.3)`，PlusOutlined 24px 黑居中；hover bg `#f0f0f0` scale 1.05；active scale 0.95
- 文字："新建画布创作" 15px/500/24px `#d0d0d0`，按钮下方，hover scale 1.05（200ms）
- onClick `startNewProject(navigate)`

### 3.8 `pages/home/components/Footer.tsx`
- border-t `1px solid #262626`，py-6，水平居中一行 gap-3，12px；窄屏 flex-wrap 隐藏分隔符
- 内容：`AI 多模态内容创作平台`（`#888`）｜`文生文·文生图·图生图·图生视频·文生视频`（`#666`）｜备案号常量 `ICP_NUMBER = '鲁ICP备2026030119号'`（`#666` hover `#888` + 下划线）
- 备案号 `<a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">`

### 3.9 `pages/home/index.tsx`（HomePage 重写）
```
<>
  <BannerCarousel />
  <CreateCanvasCard />
  <Footer />
  <AIAssistantFAB />                          // 保持 fixed bottom-8 right-8 z-50，仅首页挂载
</>
```

（VipSubscribeModal 已上移 AppLayout 全局挂载，见 3.1。）

### 3.10 `src/utils/startNewProject.ts`
```ts
export function startNewProject(navigate: NavigateFunction): void {
  localStorage.removeItem('flowweb_projectId');  // 否则 canvas 从 localStorage 恢复旧项目，行为回归
  navigate('/canvas');
}
```
Sidebar 新建项目按钮与 CreateCanvasCard 两处复用，禁止各自手写。

### 3.11 `stores/announcementStore.ts`（改造）
```ts
interface AnnouncementInfo { id; message; linkUrl?; linkText?; bgColor; textColor }
// state: announcement | null, loaded
// fetchActive()：loaded 为 true 则跳过（防两组 AppLayout 路由子树切换重挂载重复请求；dismiss 不清 loaded）
//              → GET /api/announcements/active，失败静默置 null
// dismiss() → sessionStorage.setItem(`announcement_dismissed_${id}`, '1') 并清 announcement
// visible 派生：announcement 存在 && !sessionStorage.getItem(`announcement_dismissed_${id}`)
```
关闭键**按公告 id**（全局标志会导致管理员换公告后，关过旧条的用户永远看不到新公告）。sessionStorage = 本次浏览器会话内不再显示，跨会话重现（即原规格语义）。

## 4. 数据模型与迁移

单迁移 `20260831xxxxxx_home_layout_content`（时间戳用本地时间，migrate dev 生成后 fresh replay 必验）。

### 4.1 Announcement（扩展现有模型）
```prisma
model Announcement {
  id        String   @id @default(cuid())
  message   String   @db.VarChar(200)
  linkText  String?  @db.VarChar(32)
  linkUrl   String?  @db.VarChar(500)
  bgColor   String   @default("#0f2761") @db.VarChar(16)
  textColor String   @default("#ffffff") @db.VarChar(16)
  active    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

（不建普通 `@@index([active])`——4.3 的部分唯一索引已覆盖 active=true 查询路径，布尔索引冗余。）

### 4.2 HomeBanner（新模型）
```prisma
model HomeBanner {
  id        String   @id @default(cuid())
  title     String?  @db.VarChar(128)
  subtitle  String?  @db.VarChar(256)
  linkUrl   String?  @db.VarChar(500)
  imageKey  String   @db.VarChar(255)
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active, sortOrder])
}
```

### 4.3 互斥硬约束（迁移内）
```sql
CREATE UNIQUE INDEX "announcement_single_active" ON "Announcement"("active") WHERE "active";
```

## 5. API 设计

共享类型放 `packages/shared/src/types/home.types.ts`，并在 `packages/shared/src/index.ts` 根 barrel 补 `export * from './types/home.types'`（照 subscription.types 导出链，漏补则 web 侧 import 不到）。

### 5.1 公开接口
| 接口 | 说明 |
| --- | --- |
| `GET /api/announcements/active` | 已存在。service 补 `orderBy: { updatedAt: 'desc' }`，返回扩展字段 |
| `GET /api/home-banners/active` | 新。返回**裸数组** `[{ id, title?, subtitle?, linkUrl?, imageUrl, sortOrder }]`（与 `/api/content/cards` 风格一致），按 sortOrder 升序；imageUrl 为后端生成的 presigned GET URL（**3600s**），多条 `Promise.all` 并行签 |

**AuthGuard 白名单**（auth.guard.ts）必须新增 `'/api/home-banners'`（`/api/announcements` 已在列）。

### 5.2 Admin 接口（新 controller，均显式 `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))`——全局无 ValidationPipe）

公告（`modules/content/` 内）：
- `GET /api/admin/announcements` 列表
- `POST /api/admin/announcements` DTO：message（1–200 必填）、bgColor/textColor（`^#[0-9a-fA-F]{3,8}$`，可选，有默认）、linkText（≤32 可选）、linkUrl（http(s) ≤500 可选）、active（bool）
- `PATCH /api/admin/announcements/:id` 同 DTO 部分字段
- `DELETE /api/admin/announcements/:id`

互斥实现：`$transaction([updateMany({ where: { active: true }, data: { active: false } }), update(目标 active: true)])`；**create 时 active=true 同样触发**（不只 PATCH）；partial unique index 兜底并发，捕获 P2002 转友好错误。

Banner（新模块 `modules/home-banner/`：controller + service + admin controller，app.module.ts 注册）：
- `GET /api/admin/home-banners` 列表（含 presigned 缩略图 URL，与公开端统一 3600s）
- `POST /api/admin/home-banners` DTO：title?（≤128）、subtitle?（≤256）、linkUrl?（http(s) ≤500）、imageKey（必填 ≤255，来自 upload）、sortOrder（int ≥0）、active（bool）
- `PATCH /api/admin/home-banners/:id` 同 DTO；**更换 imageKey 时删除旧 key 的 MinIO 对象**（否则孤儿对象持续累积）
- `DELETE /api/admin/home-banners/:id` **先 `minio.delete(key)` 再删 DB 行**；对象不存在（NoSuchKey/404）视为成功（保证失败可重试不留脏行）
- `POST /api/admin/home-banners/upload` multipart 直传（复用 admin-banner 样板：内存 FileInterceptor + mimetype + magic number JPEG/PNG/WEBP 字节签名），限制 **5MB**，`buildKey('uploaded','system')` 风格，返回 `{ imageKey }`

注意：multipart 上传**不能走 apiFetch**（硬编码 `Content-Type: application/json` 冲掉 boundary），前端用裸 fetch + FormData + `body.data ?? body` 解包（样板：subscriptionApi.uploadBannerImage）。

## 6. Admin UI

`admin/page.tsx` 顶级 tab 由 `models | subscription | settings` 扩为四项，新增 **"首页配置"**，内含两个子 tab：

- `AnnouncementManagementTab.tsx`：卡片式列表（内容/启用/创建时间/操作，与现有 admin 组件风格一致）+ 新建/编辑 Modal（message、bgColor、textColor、linkText、linkUrl、启用）+ 删除 + 启用开关（启用时 confirm 提示"将自动禁用其他公告"）
- `HomeBannerManagementTab.tsx`：卡片式列表（缩略图/标题/链接/排序/启用/操作）+ 新建/编辑 Modal（图片上传、title、subtitle、linkUrl、sortOrder、active）+ 删除（confirm 提示同步删除图片文件）
- API 封装入 `adminApi.ts`；测试范式参照 `BannerManagementTab.test.tsx`

## 7. 资源文件

`git mv apps/web/img apps/web/public/img`（当前 `apps/web/img/` 不被 Vite 服务——无 publicDir 配置且 public/ 不存在，两图现在是死资源；移动必须与首个消费者同提交）。引用路径 `/img/LOGO.png`、`/img/wechat-qrcode.jpg`。

## 8. 删除清单

前端死代码（因本次修改而孤立，必须删）：
- `pages/home/components/Navbar.tsx` + `Navbar.test.tsx`
- `pages/home/components/HeroSection.tsx` + `.test.tsx`
- `pages/home/components/ContentSection.tsx` + `.test.tsx`
- `pages/home/components/ContentCard.tsx` + `.test.tsx`（ContentSection 子组件）
- `pages/home/components/AnnouncementBanner.tsx` + `.test.tsx`（被 layout/AnnouncementBar 取代）
- `stores/contentStore.ts` + `.test.ts`（唯一消费者是 ContentSection）
- 7 个页面中的 Navbar import 与 `<Navbar />` 渲染

重写（非删除）：
- `pages/home/page.test.tsx`（按新首页组装重写）
- `stores/announcementStore.test.ts`（按改造后 store 重写）

旧测试清理（以下文件 `vi.mock('@/pages/home/components/Navbar')`，模块删除即炸，同步删 mock/断言）：MaterialsPage.test、WorkspacePage 两个测试、TeamBillingPage.test、TemplateMarketPage.test、TemplatePreviewPage.test、SettingsLayout.test（以 grep 清零为准）。

## 9. UI 设计规范速查

### 9.1 颜色
| 用途 | 色值 |
| --- | --- |
| 页面/边栏背景 | `#141414` |
| 卡片背景 | `#1a1a1a`；hover `#1e1e1e` |
| 菜单激活/操作栏 hover | `#262626`（边栏右边框、Footer 分隔线同色） |
| 操作按钮边框/背景 | `rgba(255,255,255,0.1)` / `rgba(255,255,255,0.04)` |
| 主文字 `#ffffff`；次级 `#d0d0d0`/`#a0a0a0`；三级 `#707070`/`#666` | |
| 品牌主色（新建项目） | `#00bfff` |
| 创作卡片边框/渐变 | `rgba(8,182,221,0.5)`；`rgba(4,202,246,0.04)`→`rgba(4,202,246,0.1)` |
| 微信绿 `#07c160`；公告条默认 `#0f2761`；Footer 分隔符 `#333` | |

### 9.2 字号/尺寸
| 元素 | 规格 |
| --- | --- |
| 公告条区域/内容区 | 总高 64px（p-2 + h-12）/ 内容区 px-12 rounded-lg |
| 侧边栏 | 240px，内容 px-4 |
| 新建项目/菜单项 | h-9 rounded-lg px-2，文字 14px |
| 操作栏/按钮 | 56px / 按钮 h-8 rounded-lg px-2.5 文字 13px |
| Banner | 8:1 rounded-xl；箭头 36px 圆；指示点 6px→16×6 胶囊 |
| 创作卡片/中央按钮 | 200px rounded-xl / 120×56 rounded-2xl |
| 公众号入口/二维码 | 64px rounded-lg / 200×200 rounded-lg |
| Footer | py-6 12px；主内容区 px-6（24px） |

全局字体族：系统无衬线（-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif）。图标全部 `@ant-design/icons`。

## 10. 响应式

| 断点 | 行为 |
| --- | --- |
| ≥1200px | 完整布局，页面最小宽 1200px |
| <1200px | `min-w-[1200px]` 触发横向滚动（布局不崩坏的最低成本方案） |
| 汉堡抽屉/侧栏收起 | 后续迭代，本次不做 |

## 11. 测试策略（TDD，红-绿-重构）

### 11.1 推进顺序
1. **后端先行**：迁移 → ContentService 扩展（公告 CRUD + 互斥、HomeBanner CRUD + 排序 + 并行 presign + 删对象顺序 + 上传 magic/5MB 校验）→ @nestjs/testing 全绿 → 两个 admin controller（含 ValidationPipe）+ AuthGuard 白名单
2. **前端**：announcementStore 重写测试 → layout 五组件测试（AppLayout/Sidebar/TopActionBar/AnnouncementBar/WeChatFollowModal）→ 路由重组 → 首页三组件（BannerCarousel/CreateCanvasCard/Footer）→ Admin 两子 tab → 旧测试清理

### 11.2 测试点
- **后端**：公告 CRUD；互斥（启用一条其余自动 false，create/PATCH 两路径；P2002 捕获）；HomeBanner CRUD；列表按 sortOrder；删除时 MinIO 对象删除（含 NoSuchKey 容忍）；换图删旧 key；上传类型/大小/magic number 校验
- **前端**：AppLayout 挂载即 fetchActive、公告显隐驱动侧栏/操作栏 top class 联动、VipSubscribeModal 全局挂载；Sidebar 四菜单渲染/高亮/跳转；新建项目走 startNewProject（清 localStorage）；TopActionBar 登录/未登录两态 + 积分走 creditsStore（仅登录态发请求）+ 未登录三按钮确切行为断言（赚积分→整页跳 /login、会员充值→直接弹 VIP 框、登录/注册→LoginModal）；AnnouncementBar 渲染/关闭按钮与链接按钮各自 stopPropagation（点链接按钮只打开一次，不冒泡触发整栏跳转）+ sessionStorage 按公告 id/无公告不渲染；BannerCarousel（fake timers 自动轮播/hover 暂停/unmount 清 timer/单张无箭头指示器/骨架/单张失败占位/全部失败等价空态/空态不渲染）；CreateCanvasCard 跳转；Footer 文案与备案链接 href+rel；WeChatFollowModal 渲染二维码；Admin 两 tab 渲染 + 启用互斥提示；HomePage 组装

### 11.3 完成定义（硬门）
1. `tsc --noEmit` 严格模式零错（web + api + spec tsconfig）
2. 全量 `vitest run` 绿（web + api）
3. `grep` 全库确认 `Navbar`/`contentStore`/`HeroSection`/`ContentSection`/`ContentCard`/`AnnouncementBanner` 零残留引用
4. `apps/web/public/img` 两图可经 `/img/...` 直接访问

## 12. 指出但不处理

- 后端 `GET /api/content/cards`、ContentCard 模型及 seed 失去前端消费者：**保留不动**（涉及模型迁移，超出本次范围），PR 描述登记技术债
- admin 无角色守卫（任何登录用户可访问 /admin 与 /api/admin/*）：已知上线前必修项，本次新增端点沿用现状
- Banner 上传弃单孤儿对象（上传成功但取消新建，对象落在 uploads/system/）：temp-cleanup 只清 Media 表 type=temp 记录不会回收；与现有 VIP Banner 同性质、admin 低频，接受，PR 描述登记，本次不做清理
