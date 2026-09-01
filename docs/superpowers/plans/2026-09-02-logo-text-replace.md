# 图片站标替换为 Flow123 斜体文字 — TDD 实施计划

日期：2026-09-02
Spec：`docs/superpowers/specs/2026-09-02-logo-text-replace-design.md`（已确认，含审核修订）
验证命令：`pnpm -C apps/web test -- <路径过滤>`；全量 `pnpm -C apps/web test`

## 前置事实（已核实）

- 图片站标全项目仅 `Sidebar.tsx:39` 一处引用；登录页 banner 为文字 `FlowWeb`（`login/page.tsx:24`）
- 站标 Link 有 `aria-label="首页"`，与导航「首页」链接重名 → 测试用 `getByText('Flow123')` + `closest('a')`，不用 `getByRole('link', { name })`
- MemoryRouter 下 react-router `<Link to="/">` 渲染 `href="/"`
- 改动均为纯 JSX/className 替换，无类型层面变化，不跑 tsc build

## 任务分解（TDD：每任务先测试红 → 实现绿 → 提交）

### T1 Sidebar 站标

- **RED** 改 `apps/web/src/components/layout/Sidebar.test.tsx:22-24`（用例名「渲染 Logo 与四项菜单」保留）：
  1. 删除 `getByAltText('Flow123')` 的 src 断言
  2. 新增 `expect(screen.getByText('Flow123')).toBeInTheDocument()`
  3. 新增 `expect(screen.getByText('Flow123').closest('a')).toHaveAttribute('href', '/')`（防重构误删首页 Link）
  4. 跑 `pnpm -C apps/web test -- Sidebar` → 新断言失败（红）
- **GREEN** 改 `Sidebar.tsx:39`：
  ```tsx
  <span className="text-[22px] font-semibold italic tracking-[-0.04em] leading-none text-white select-none whitespace-nowrap">
    Flow123
  </span>
  ```
  （Link 的 `to`、`aria-label`、`pt-5 pb-4` 不动；不加 `h-7` 占位补偿）
  - 跑同命令 → 全绿
- **提交** `feat(web): Sidebar 站标图片替换为 Flow123 斜体文字（含测试）`

### T2 登录页 banner

- **RED** 改 `apps/web/src/pages/login/page.test.tsx:35-38`：
  1. 用例名 `banner fallback with FlowWeb` → `banner fallback with Flow123`
  2. 断言 `getByText('FlowWeb')` → `getByText('Flow123')`
  3. 跑 `pnpm -C apps/web test -- login/page` → 红
- **GREEN** 改 `login/page.tsx:24-26`：
  ```tsx
  <span className="text-[24px] font-semibold italic tracking-[-0.04em] leading-none text-[#141414]">
    Flow123
  </span>
  ```
  （banner 容器 `flex items-center justify-center` 不动）
  - 跑同命令 → 绿
- **提交** `feat(web): 登录页 banner 文字 FlowWeb 统一为 Flow123 斜体（含测试）`

### T3 全量验证 + 浏览器验收

1. `pnpm -C apps/web test` 全量通过
2. `grep -r "LOGO.png" apps/web/src` 无结果
3. 浏览器（preview dev server）：
   - 首页：Sidebar 顶部白色斜体 Flow123，与「新建项目」按钮间距正常（16px），点击站标回首页
   - `/login`：banner 深色斜体 Flow123 垂直居中

## 明确不做

- 不删 `public/img/LOGO.png` 文件（孤立资源，用户另行决定）
- 不动 body 字体栈 / Tailwind 配置 / `WeChatFollowModal`
