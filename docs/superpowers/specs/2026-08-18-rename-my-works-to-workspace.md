# 规格说明：「我的作品」更名为「工作空间」

**日期**：2026-08-18
**状态**：待确认

## 背景

「我的作品」已独立为 `/works` 路由（见 `2026-08-17-my-works-standalone-page-design.md`）。用户要求将所有用户可见文案由「我的作品」统一改为「工作空间」，路由保持不变。

## 目标

所有用户界面中的「我的作品」文案改为「工作空间」。路由、组件名、文件名、API 参数均不改动。

## 改动范围（5 处）

| # | 位置 | 现状 | 改为 |
|---|---|---|---|
| 1 | `Navbar.tsx:19` 导航链接 | `{ label: '我的作品', href: '/works' }` | `{ label: '工作空间', href: '/works' }`（href 不变） |
| 2 | `MyTemplatesPage.tsx:43` 页面标题 | `<h1>我的作品</h1>` | `<h1>工作空间</h1>` |
| 3 | `TemplatePreviewPage.tsx:48` 返回按钮 | `← 返回{isWorks ? '我的作品' : '模板广场'}` | `isWorks` 分支改为 `'工作空间'`（'模板广场' 分支不变） |
| 4 | `TemplateMarketPage.tsx:35` 广场标签页 | `{ key: 'my', label: '我的作品' }` | `{ key: 'my', label: '工作空间' }`（key `'my'` 不变，与 API `type` 参数对应） |
| 5 | `SettingsLayout.test.tsx:50-61` 防回归断言 | 断言侧边栏不含「我的作品」 | 断言侧边栏不含「工作空间」（文案改名后旧断言失去保护作用，需同步更新以持续防止入口回流设置页） |

## 测试改动

- `Navbar.test.tsx:30,35,53-55`：断言文案「我的作品」→「工作空间」（链接 href `/works` 断言不变）。
- `home/page.test.tsx:77`：同上更新文案断言。
- `MyTemplatesPage.test.tsx:38-40`：H1 断言改为「工作空间」。
- `TemplatePreviewPage.test.tsx:44-46`：断言改为「← 返回工作空间」。
- `SettingsLayout.test.tsx`：防回归断言改为「工作空间」。
- **新增** `TemplateMarketPage.test.tsx`：现无测试文件，新增渲染测试（mock `@/api/templateApi`），断言标签页含「工作空间」。

## 明确不改动

- 路由 `/works`、`/works/:id`；`TemplateCard` 的 `linkPrefix="/works"`。
- 组件名/文件名（`MyTemplatesPage` 等）。
- API 参数 `type: 'my'`（后端契约）。
- 历史 spec/plan 文档中的「我的作品」字样（历史记录，不回写）。

## 验证标准

1. `pnpm test`（web 相关测试文件）全部通过。
2. 代码库中不再有用户可见的「我的作品」（`grep 我的作品 apps/web/src` 仅剩历史文档）。
3. 浏览器验证：导航栏显示「工作空间」且点击进入 `/works`；`/works` 页标题、「← 返回工作空间」按钮、模板广场第三个标签页均显示「工作空间」。
