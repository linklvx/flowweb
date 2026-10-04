<!-- doc-status: historical | verified_at: n/a -->
# 实施计划：我的作品独立页面（/works）

> 对应规格：[2026-08-17-my-works-standalone-page-design.md](../specs/2026-08-17-my-works-standalone-page-design.md)
> 模式：Superpowers TDD（红 → 绿 → 重构）

## 目标与成功标准

- 访问 `/works` 渲染「我的作品」独立页（带 Navbar，无设置侧边栏）。
- 访问 `/works/:id` 渲染作品预览页，返回/删除回 `/works`。
- 顶部导航栏「我的作品」指向 `/works`。
- 设置页侧边栏不再出现「我的作品」。
- 全局无 `/settings/templates` 残留。
- `pnpm --filter @flowweb/web test` 全绿；`pnpm --filter @flowweb/web exec tsc -b` 通过。

## 关键文件与命令

- 测试：`pnpm --filter @flowweb/web test`（`vitest run`）；单文件：`pnpm --filter @flowweb/web test -- src/pages/templates/MyTemplatesPage`
- 类型检查：`pnpm --filter @flowweb/web exec tsc -b`
- 测试约定：同目录 `*.test.tsx`；别名 `@/*` → `src/*`；`globals: true`（vitest 全局，无需 import describe/it）

---

## Task 1 — Navbar 链接 → /works

**红**：修改 `apps/web/src/pages/home/components/Navbar.test.tsx:53-56`
```tsx
it('should link 我的作品 to /works', () => {
  renderWithProviders(<Navbar />);
  expect(screen.getByText('我的作品').closest('a')).toHaveAttribute('href', '/works');
});
```
运行 `vitest run -- src/pages/home/components/Navbar` → 失败（当前 `/settings/templates`）。

**绿**：修改 `apps/web/src/pages/home/components/Navbar.tsx:19`
```tsx
{ label: '我的作品', href: '/works' },
```

---

## Task 2 — SettingsLayout 移除「我的作品」

**红**：在 `apps/web/src/pages/settings/SettingsLayout.test.tsx` 新增用例（**复用文件顶部已有的 `mockUseAuth` mock，无需额外注入**）：
```tsx
it('should NOT render 我的作品 in sidebar (decoupled from settings)', () => {
  render(
    <MemoryRouter initialEntries={['/settings/profile']}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route path="profile" element={<div>Profile Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  expect(screen.queryByText('我的作品')).toBeNull();
});
```
运行 → 失败（当前侧边栏含「我的作品」）。

**绿**：删除 `apps/web/src/pages/settings/SettingsLayout.tsx` 中「我的作品」的 `NavLink`（约 51-60 行，`to="/settings/templates"` 那段）。

---

## Task 3 — TemplatePreviewPage：isEmbedded → isWorks

> `TemplatePreviewPage.tsx` 已在 `pages/templates/`，无需移动。

**红**：新增 `apps/web/src/pages/templates/TemplatePreviewPage.test.tsx`
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

vi.mock('@/pages/home/components/Navbar', () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

const getTemplateMock = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplate: (...args: unknown[]) => getTemplateMock(...args),
  importTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

import { TemplatePreviewPage } from './TemplatePreviewPage';

const template = { id: 'abc', name: 'Foo', description: '', coverUrl: '', importCount: 0, isOwner: true, category: undefined };

beforeEach(() => {
  getTemplateMock.mockResolvedValue(template);
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/works/:id" element={<TemplatePreviewPage />} />
        <Route path="/templates/:id" element={<TemplatePreviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TemplatePreviewPage', () => {
  it('在 /works/:id 下返回按钮文案为「返回我的作品」', async () => {
    renderAt('/works/abc');
    expect(await screen.findByText('← 返回我的作品')).toBeInTheDocument();
  });

  it('在 /templates/:id 下返回按钮文案为「返回模板广场」', async () => {
    renderAt('/templates/abc');
    expect(await screen.findByText('← 返回模板广场')).toBeInTheDocument();
  });
});
```
运行 → 失败（当前 `/works/abc` 命中 `isEmbedded=false`，文案为「返回模板广场」）。

**绿**：修改 `apps/web/src/pages/templates/TemplatePreviewPage.tsx`
- `const isEmbedded = location.pathname.startsWith('/settings/');` → `const isWorks = location.pathname.startsWith('/works');`
- 删除 `handleDelete` 内 `isEmbedded ? '/settings/templates' : '/templates'` → `isWorks ? '/works' : '/templates'`
- 返回按钮 `navigate(isEmbedded ? ...)` → `navigate(isWorks ? '/works' : '/templates')`，文案 `isEmbedded ? '我的作品' : '模板广场'` → `isWorks ? '我的作品' : '模板广场'`
- 删除 `if (isEmbedded) return content;` 提前返回；`content` 外层容器固定为 `mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] py-8`；统一渲染 `<div className="min-h-screen bg-[#0f0f0f]"><Navbar />{content}</div>`。

---

## Task 4 — MyTemplatesPage 迁移 + 独立化

**步骤 4a（机械移动，无行为变更）**：
1. `git mv`（或移动）：`pages/settings/MyTemplatesPage.tsx` → `pages/templates/MyTemplatesPage.tsx`；`pages/settings/EditTemplateDialog.tsx` → `pages/templates/EditTemplateDialog.tsx`
2. `MyTemplatesPage.tsx` 内部 import：`import { TemplateCard } from '../templates/TemplateCard'` → `'./TemplateCard'`（`'./EditTemplateDialog'` 不变）
3. `router.tsx:12` import：`@/pages/settings/MyTemplatesPage` → `@/pages/templates/MyTemplatesPage`
4. 验证：`tsc -b` 通过（此步无行为变更，路由仍 `/settings/templates`）

**红**：新增 `apps/web/src/pages/templates/MyTemplatesPage.test.tsx`
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/pages/home/components/Navbar', () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

const getTemplatesMock = vi.fn();
vi.mock('@/api/templateApi', () => ({
  getTemplates: (...args: unknown[]) => getTemplatesMock(...args),
  deleteTemplate: vi.fn(),
  updateTemplate: vi.fn(),
}));

import { MyTemplatesPage } from './MyTemplatesPage';

beforeEach(() => {
  getTemplatesMock.mockResolvedValue({
    templates: [{ id: 't1', name: 'Foo', description: '', importCount: 0, isOwner: true }],
  });
});

describe('MyTemplatesPage', () => {
  it('渲染独立导航栏', async () => {
    render(<MemoryRouter><MyTemplatesPage /></MemoryRouter>);
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('渲染标题「我的作品」', async () => {
    render(<MemoryRouter><MyTemplatesPage /></MemoryRouter>);
    expect(await screen.findByText('我的作品')).toBeInTheDocument();
  });

  it('模板卡片链接前缀为 /works', async () => {
    render(<MemoryRouter><MyTemplatesPage /></MemoryRouter>);
    const link = await screen.findByText('Foo');
    expect(link.closest('a')).toHaveAttribute('href', '/works/t1');
  });
});
```
运行 → 失败（当前无 Navbar、`linkPrefix` 为 `/settings/templates`、标题为 `<h2>` 但 getByText 仍能命中…实际失败点：`getByTestId('navbar')` 与 href 断言）。

**绿**：修改 `apps/web/src/pages/templates/MyTemplatesPage.tsx`
- 引入 `import { Navbar } from '@/pages/home/components/Navbar';`
- 外层改为独立结构（参照 `TemplateMarketPage`）：
```tsx
if (loading) return <div className="min-h-screen bg-[#0f0f0f]"><Navbar /><div className="text-[#555] py-16 text-center">加载中...</div></div>;
return (
  <div className="min-h-screen bg-[#0f0f0f]">
    <Navbar />
    <div className="mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] py-8">
      <h1 className="text-2xl font-bold text-[#e2e8f0] mb-6">我的作品</h1>
      {/* 空态 / 网格逻辑不变 */}
    </div>
  </div>
);
```
- `TemplateCard` 的 `linkPrefix`：`/settings/templates` → `/works`（**`TemplateCard` 已支持 `linkPrefix` prop，默认 `/templates`，无需改造**）

---

## Task 5 — 路由调整

修改 `apps/web/src/router.tsx`：
- 在 `RequireAuth` 子路由中（与 `/canvas`、`/admin` 同级）新增：
```tsx
{ path: '/works', element: <MyTemplatesPage /> },
{ path: '/works/:id', element: <TemplatePreviewPage /> },
```
- 删除 `/settings` 子路由中的：
```tsx
{ path: 'templates', element: <MyTemplatesPage /> },
{ path: 'templates/:id', element: <TemplatePreviewPage /> },
```
（`TemplatePreviewPage` 的 import 已在 router.tsx 顶部存在，无需改。）

> 无独立 router 测试（项目无 router 级测试），此步由 Task 1/3/4 组件测试 + 手动浏览器验证覆盖。

---

## Task 6 — 验证

1. `pnpm --filter @flowweb/web test` → 全绿
2. `pnpm --filter @flowweb/web exec tsc -b` → 通过
3. 全局 grep `/settings/templates` → 无残留（scope 限定 `apps/web/src`，`--include` 仅 `*.ts`/`*.tsx`，避开 `node_modules`/`dist`/`.git`）
4. 手动浏览器验证：
   - `/works` 独立渲染「我的作品」，导航栏「我的作品」高亮
   - `/works/:id` 预览页返回按钮「返回我的作品」→ 回 `/works`
   - `/templates/:id` 预览页仍「返回模板广场」→ 回 `/templates`
   - `/settings/profile` 侧边栏无「我的作品」

## 风险与注意

- `pages/settings/index.ts` 未导出 `MyTemplatesPage`（router 直接按文件路径 import），移动后仅需改 `router.tsx:12`。
- `EditTemplateDialog.tsx` 仅依赖 `@/api/templateApi`，移动无副作用。
- 无 404 catch-all 为既有现状，不在本次范围（见 spec 备注）。
