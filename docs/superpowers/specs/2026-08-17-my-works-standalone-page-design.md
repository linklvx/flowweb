<!-- doc-status: historical | verified_at: n/a -->
# 规格说明：我的作品独立页面（/works）

## 背景与目标

「我的作品」页面当前挂在 `/settings/templates` 下，与设置（个人资料 / 积分 / 会员）共用 `SettingsLayout` 侧边栏布局。但它与"设置"没有任何关系，是用户管理自己作品（模板）的独立功能。

**目标**：将「我的作品」从设置路径中剥离，独立为 `/works`（预览页 `/works/:id`），独立页面 + 独立路径，与设置彻底解耦。

## 现状

| 项 | 当前值 |
|---|---|
| 列表页路由 | `/settings/templates` → `MyTemplatesPage`（嵌套于 `SettingsLayout`） |
| 预览页路由 | `/settings/templates/:id` → `TemplatePreviewPage`（内嵌模式） |
| 顶部导航栏「我的作品」 | `/settings/templates` |
| 设置侧边栏「我的作品」 | `/settings/templates`（`SettingsLayout.tsx:52`） |
| 列表页文件 | `apps/web/src/pages/settings/MyTemplatesPage.tsx` |
| 编辑弹窗文件 | `apps/web/src/pages/settings/EditTemplateDialog.tsx` |
| 预览页内嵌判断 | `TemplatePreviewPage` 用 `pathname.startsWith('/settings/')` 判定内嵌 |

## 目标状态

### 1. 路由（`apps/web/src/router.tsx`）

```tsx
{ path: '/works', element: <MyTemplatesPage /> },          // 独立，RequireAuth 内
{ path: '/works/:id', element: <TemplatePreviewPage /> },  // 独立
```

- 新增 `/works` 与 `/works/:id`，两者放在 `RequireAuth` 下、`/settings` 之外（与 `/canvas`、`/admin` 同级）。
- 删除 `/settings` 子路由中的 `templates` 与 `templates/:id`。
- `MyTemplatesPage` 的 import 从 `@/pages/settings/MyTemplatesPage` 改为 `@/pages/templates/MyTemplatesPage`。

### 2. 文件迁移

| 文件 | 迁移后 |
|---|---|
| `pages/settings/MyTemplatesPage.tsx` | `pages/templates/MyTemplatesPage.tsx` |
| `pages/settings/EditTemplateDialog.tsx` | `pages/templates/EditTemplateDialog.tsx` |

理由：该页本质是"我的模板"，与 `TemplateMarketPage` / `TemplateCard` / `TemplatePreviewPage` 同域，归入 `pages/templates/` 保持一致（备选：新建 `pages/works/`，但会增加无谓的新目录）。

迁移后 import 调整：
- `MyTemplatesPage` 内：`../templates/TemplateCard` → `./TemplateCard`；`./EditTemplateDialog` 不变。
- `router.tsx`：改为 `@/pages/templates/MyTemplatesPage`。

### 3. 列表页 `MyTemplatesPage` 改为独立布局

当前是内嵌（无 Navbar、无外层容器）。改为与 `TemplateMarketPage` 相同的独立结构：

```tsx
return (
  <div className="min-h-screen bg-[#0f0f0f]">
    <Navbar />
    <div className="mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] py-8">
      <h1 className="text-2xl font-bold text-[#e2e8f0] mb-6">我的作品</h1>
      {/* 空态 / 网格（不变，仅 linkPrefix 改为 /works） */}
    </div>
  </div>
);
```

- 引入 `Navbar`（`@/pages/home/components/Navbar`）。
- 标题由 `<h2>` 升级为 `<h1>`（与 `TemplateMarketPage` 独立页一致）。
- `TemplateCard` 的 `linkPrefix` 由 `/settings/templates` 改为 `/works`。

### 4. 预览页 `TemplatePreviewPage` 简化

当前靠 `pathname.startsWith('/settings/')` 区分内嵌（无 Navbar、无容器）与独立。迁移后两个入口（`/templates/:id` 与 `/works/:id`）都是独立页，不再有"内嵌"概念。

变更：
- 删除 `isEmbedded`，新增 `isWorks = location.pathname.startsWith('/works')`。
- 删除 `if (isEmbedded) return content;` 的提前返回结构，始终渲染 `<div className="min-h-screen bg-[#0f0f0f]"><Navbar />{content}</div>`。
- `content` 始终使用外层容器 `mx-auto max-w-[1640px] ... py-8`。
- 删除/返回目标：`navigate(isWorks ? '/works' : '/templates')`。
- 返回按钮文案：`← 返回{isWorks ? '我的作品' : '模板广场'}`。

### 5. 导航栏与侧边栏

- `Navbar.tsx:19`：`我的作品` href 由 `/settings/templates` 改为 `/works`。
- `SettingsLayout.tsx`：删除「我的作品」侧边栏 `NavLink`（`/settings/templates`，约 51-60 行），其余设置项不变。

## 边界情况

- 访问旧路径 `/settings/templates` → 路由不再存在，直接移除、**不加重定向**（已确认）。项目处于开发测试阶段，无存量用户/书签，且已梳理全部内部引用，无残留跳转。
- 预览页删除模板后返回目标：`/works/:id` 删除 → `/works`；`/templates/:id` 删除 → `/templates`（行为不变，仅路径更新）。
- 未登录访问 `/works`：由 `RequireAuth` 保护，与 `/settings`、`/canvas` 一致。

## 测试用例（TDD）

### 修改现有测试
1. `Navbar.test.tsx:53-56`：`我的作品` 链接断言 `/settings/templates` → `/works`。

### 新增测试
2. `SettingsLayout.test.tsx`：断言侧边栏**不包含**「我的作品」（`queryByText('我的作品')` 为 null），确保解耦。
3. `MyTemplatesPage.test.tsx`（新文件，位于 `pages/templates/`）：
   - 渲染标题「我的作品」。
   - 渲染 `Navbar`（品牌文字 Flow123 出现）。
   - mock `templateApi.getTemplates`，卡片链接 `href` 前缀为 `/works/`。
4. `TemplatePreviewPage.test.tsx`（新文件）：在 `/works/:id` 上下文下渲染，断言返回按钮文案「返回我的作品」、`href` 为 `/works`。

## 验证命令

- `pnpm --filter web test`（或项目约定的 vitest 单测命令，待 Plan 阶段确认精确命令）。
- 手动：浏览器访问 `/works`、`/works/:id`、`/templates/:id`，确认导航栏「我的作品」高亮、设置页不再出现「我的作品」。

## 不在范围内

- `TemplateMarketPage` 的「我的作品」标签页（`type: 'my'`）保持不变——那是模板广场内的筛选视图，与本独立页是两回事。
- 不新增任何后端/数据变更，纯前端路由与页面结构调整。

## 待确认

1. ~~旧路径重定向~~ → **已确认：直接移除，不加重定向。**

## 备注（已核实）

- `TemplateCard` 已暴露 `linkPrefix` prop（默认 `/templates`），**无需改造**，仅调用处改值为 `/works`。
- `MyTemplatesPage` 内相对 import 仅 `../templates/TemplateCard` 与 `./EditTemplateDialog` 两处，迁移后前者改 `./TemplateCard`，后者不变；其余为 `@/` 别名 import，不受影响。
- `TemplatePreviewPage` 的删除/返回导航均为 `isEmbedded ? '/settings/templates' : '/templates'` 三元式，非硬编码绝对路径，随 `isEmbedded→isWorks` 一并改。
- 项目测试约定为**同目录 `*.test.tsx`**（参照 `Navbar.test.tsx`、`SettingsLayout.test.tsx`），新增测试与组件同目录。
- `router.tsx` 当前**无 `*` catch-all 404 路由**（全局皆无）。这是既有现状，非本次改动引入；访问旧路径 `/settings/templates` 会与访问任何未知 URL 一样渲染空白页 + 控制台警告。属既有缺口，不在本次范围内，如需要可另开任务补 404 兜底。
