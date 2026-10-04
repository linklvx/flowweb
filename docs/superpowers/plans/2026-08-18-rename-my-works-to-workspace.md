<!-- doc-status: historical | verified_at: n/a -->
# 实施计划：「我的作品」更名为「工作空间」

**日期**：2026-08-18
**Spec**：`docs/superpowers/specs/2026-08-18-rename-my-works-to-workspace.md`
**验证命令**：`cd apps/web && pnpm test <文件过滤>`，最终 `pnpm test` 全量

## Task 1 — Navbar 导航文案

**红**：更新两处测试断言「我的作品」→「工作空间」：
- `Navbar.test.tsx`
  - L30：用例名 `...文档中心, 我的作品` → `...文档中心, 工作空间`；L35：`getByText('我的作品')` → `getByText('工作空间')`
  - L53-55：用例名及 `getByText('我的作品')` → `'工作空间'`（href `/works` 断言不变）
- `home/page.test.tsx` L77：`getByText('我的作品')` → `getByText('工作空间')`

运行 `pnpm test src/pages/home` → 2 个文件失败（渲染中无「工作空间」）。

**绿**：`Navbar.tsx` L19：`{ label: '我的作品', href: '/works' }` → `{ label: '工作空间', href: '/works' }`。

运行 → 通过。

## Task 2 — MyTemplatesPage 页面标题

**红**：`MyTemplatesPage.test.tsx` L38-40：用例名「我的作品」→「工作空间」，`findByRole('heading', { level: 1, name: '我的作品' })` → `name: '工作空间'`。

运行 `pnpm test src/pages/templates/MyTemplatesPage` → 失败。

**绿**：`MyTemplatesPage.tsx` L43：`<h1 ...>我的作品</h1>` → `工作空间`。

运行 → 通过。

## Task 3 — TemplatePreviewPage 返回按钮

**红**：`TemplatePreviewPage.test.tsx` L44-46：用例名「返回我的作品」→「返回工作空间」，`findByText('← 返回我的作品')` → `'← 返回工作空间'`。

运行 `pnpm test src/pages/templates/TemplatePreviewPage` → 失败（L49「返回模板广场」用例不受影响）。

**绿**：`TemplatePreviewPage.tsx` L48：`isWorks ? '我的作品' : '模板广场'` → `isWorks ? '工作空间' : '模板广场'`。

运行 → 通过。

## Task 4 — TemplateMarketPage 标签页（新增测试文件）

**红**：新建 `apps/web/src/pages/templates/TemplateMarketPage.test.tsx`：

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
}));

import { TemplateMarketPage } from './TemplateMarketPage';

beforeEach(() => {
  getTemplatesMock.mockResolvedValue({ templates: [] });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <TemplateMarketPage />
    </MemoryRouter>
  );
}

describe('TemplateMarketPage', () => {
  it('渲染标签页：社区模板、官方模板、工作空间', async () => {
    renderPage();
    expect(screen.getByText('社区模板')).toBeInTheDocument();
    expect(screen.getByText('官方模板')).toBeInTheDocument();
    expect(await screen.findByText('工作空间')).toBeInTheDocument();
  });
});
```

运行 `pnpm test src/pages/templates/TemplateMarketPage` → 失败（无「工作空间」）。

**绿**：`TemplateMarketPage.tsx` L35：`{ key: 'my', label: '我的作品' }` → `{ key: 'my', label: '工作空间' }`。

运行 → 通过。

## Task 5 — SettingsLayout 防回归断言更新

性质：非红绿循环。旧断言（侧边栏不含「我的作品」）在改名后失去保护作用。更新 `SettingsLayout.test.tsx` L50-61：用例名与 `queryByText('我的作品')` → `'工作空间'`。

运行 `pnpm test src/pages/settings` → 通过（侧边栏本就不含该入口，断言保持保护作用）。

## Task 6 — 全量验证

1. `cd apps/web && pnpm test` → 全部通过。
2. `grep -rn "我的作品" apps/web/src` → 0 结果。
3. 浏览器验证（preview_start）：
   - `/` 导航栏显示「工作空间」，点击进入 `/works`
   - `/works` 页标题「工作空间」
   - `/works/:id` 返回按钮「← 返回工作空间」
   - `/templates` 第三个标签页「工作空间」
   - `/settings/profile` 侧边栏无「工作空间」

## 提交

单次提交：`feat: rename 我的作品 to 工作空间 across UI copy`
