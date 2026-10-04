<!-- doc-status: historical | verified_at: n/a -->
# 侧边栏收起与视觉对齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧边栏新增收起/展开（240px↔48px 窄条、localStorage 持久化），视觉对齐参考值（右边框 1px `#ffffff18`、行高 `leading-[22px]` 三处统一、box-border 归一 240px）。

**Architecture:** 状态全部内聚于 `Sidebar.tsx`（`useState` 惰性初始化 + localStorage），`AppLayout.tsx` 零改动，不触碰业务逻辑（`isActive`/`startNewProject`/`qrOpen`/`message` 原样保留）。

**Tech Stack:** React 18 + react-router v7 + antd 5（`Tooltip`）+ `@ant-design/icons ^5.5.0`（`MenuFoldOutlined`/`MenuUnfoldOutlined`，零新依赖）+ Tailwind（**preflight:false**，无全局 box-sizing，故 aside 必须显式 `box-border`）+ vitest + @testing-library/react。

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-collapse-ui-design.md`（含全部拍板：B1 方案 A、header 对齐切换、文字瞬切取舍、Tooltip 始终包裹空 title 不弹）

**测试命令**（Bash CWD 会漂移，必须显式 cd）：
```bash
cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx
```

**提交纪律**：每次 commit 前先 `git -C D:/flowweb status` 确认暂存仅本次任务的 `Sidebar.tsx` + `Sidebar.test.tsx` 两个文件。

**现有测试基线**（[Sidebar.test.tsx](../../apps/web/src/components/layout/Sidebar.test.tsx) 5 用例，定位方式与新 aria-label 已核对无冲突）：
- `beforeEach` 已含 `localStorage.clear()`（默认展开路径）
- 用例 1 `getByText('首页')`/`('Flow123')`；用例 2 断言 className 含 `bg-[#262626]`；用例 3/5 用 `getByRole('button', { name: /新建项目|文档中心/ })`；用例 4 用 `getByTestId('wechat-follow-entry')`

---

### Task 1: 视觉对齐（box-border / 边框色 / 行高三处 / 文档中心 text-sm）

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`（4 处 class）
- Test: `apps/web/src/components/layout/Sidebar.test.tsx`

- [ ] **Step 1: 写失败测试**（追加到 `describe('Sidebar', ...)` 末尾、最后一个 `it` 之后）

```tsx
  it('视觉对齐：边框 1px #ffffff18、box-border、leading-[22px] 三处统一', () => {
    renderSidebar();
    const aside = screen.getByTestId('sidebar');
    expect(aside.className).toContain('box-border');
    expect(aside.className).toContain('border-r');
    expect(aside.className).toContain('border-[#ffffff18]');
    const navLink = screen.getByText('首页').closest('a');
    expect(navLink?.className).toContain('leading-[22px]');
    expect(navLink?.className).toContain('h-9');
    const createBtn = screen.getByRole('button', { name: /新建项目/ });
    expect(createBtn.className).toContain('leading-[22px]');
    const docBtn = screen.getByRole('button', { name: /文档中心/ });
    expect(docBtn.className).toContain('leading-[22px]');
    expect(docBtn.className).toContain('text-sm');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 新用例 FAIL（className 无 `box-border`/`border-[#ffffff18]`/`leading-[22px]`），5 老用例 PASS

- [ ] **Step 3: 最小实现**（`Sidebar.tsx` 4 处 class 替换，其余不动）

① aside（第 35 行）边框色 + box-border：
```tsx
// 旧
className="sticky left-0 self-start shrink-0 w-[240px] bg-[#141414] border-r border-[#262626] px-4 flex flex-col z-30"
// 新
className="sticky left-0 self-start shrink-0 box-border w-[240px] bg-[#141414] border-r border-[#ffffff18] px-4 flex flex-col z-30"
```

② 新建项目按钮（第 46 行）`leading-5` → `leading-[22px]`（class 其余不变）

③ 导航 Link（第 59 行）`leading-5` → `leading-[22px]`（class 其余不变）

④ 文档中心按钮（第 87 行）`text-[13px]` → `text-sm leading-[22px]`：
```tsx
// 旧
className="h-9 rounded-lg px-2 flex items-center gap-2 text-[13px] text-[#707070] hover:bg-[#1e1e1e] hover:text-[#a0a0a0] border-none cursor-pointer transition-colors"
// 新
className="h-9 rounded-lg px-2 flex items-center gap-2 text-sm leading-[22px] text-[#707070] hover:bg-[#1e1e1e] hover:text-[#a0a0a0] border-none cursor-pointer transition-colors"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 6 用例全 PASS

- [ ] **Step 5: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git -C D:/flowweb commit -m "feat(web): Sidebar 右边框 #ffffff18、box-border 归一 240、行高 leading-22 三处统一（含测试）"
```

---

### Task 2: 折叠状态 + header 重构 + 持久化 + data-collapsed

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Test: `apps/web/src/components/layout/Sidebar.test.tsx`

- [ ] **Step 1: 写失败测试**（追加 4 个用例到 describe 末尾）

```tsx
  it('渲染折叠按钮：默认展开态 aria-label 为 收起侧边栏', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: '收起侧边栏' })).toBeInTheDocument();
  });

  it('点击收起：data-collapsed=true 并写入 localStorage', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem('sidebar.collapsed')).toBe('true');
  });

  it('持久化恢复：localStorage 预置 true 时初始即收起态', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument();
  });

  it('收起态再点击展开：data-collapsed 移除并写回 false', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-collapsed');
    expect(localStorage.getItem('sidebar.collapsed')).toBe('false');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 4 新用例 FAIL（找不到 name 为 收起侧边栏/展开侧边栏 的按钮），6 已有用例 PASS

- [ ] **Step 3: 实现**（三段修改）

① import 区：`@ant-design/icons` 增补 `MenuFoldOutlined, MenuUnfoldOutlined`（按字母序插入 `HomeOutlined` 之后）：
```tsx
import {
  AppstoreOutlined, FolderOutlined, HomeOutlined, MenuFoldOutlined,
  MenuUnfoldOutlined, PictureOutlined, PlusOutlined, QuestionCircleOutlined,
  WechatOutlined,
} from '@ant-design/icons';
```

② `NAV_ITEMS` 之后、`interface Props` 之前插入：
```tsx
const SIDEBAR_KEY = 'sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistCollapsed(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(value));
  } catch {
    // 存储被禁（如隐私模式）时静默忽略，展开/收起本身仍可用
  }
}
```

③ 组件内 `const [qrOpen, setQrOpen] = useState(false);` 之后插入：
```tsx
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    persistCollapsed(next);
  };
```
（副作用不放 setState updater——StrictMode/并发下 updater 可能重复调用）

④ aside 标签（Task 1 已改过色）替换为宽度切换 + 过渡 + data-collapsed：
```tsx
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed ? 'true' : undefined}
      className={`sticky left-0 self-start shrink-0 box-border overflow-hidden transition-[width] duration-200 ease-out z-30 ${
        collapsed ? 'w-12 px-2' : 'w-[240px] px-4'
      } bg-[#141414] border-r border-[#ffffff18] flex flex-col`}
      style={{ top: topOffset, height: `calc(100vh - ${topOffset}px)` }}
    >
```

⑤ 站标 Link（第 38-42 行整段）替换为 header 结构：
```tsx
      <header className={`h-[50px] flex items-center shrink-0 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <Link to="/" aria-label="首页" className="block">
            <span className="text-[22px] font-semibold italic tracking-[-0.04em] leading-none text-white select-none whitespace-nowrap">
              Flow123
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="size-9 rounded-lg flex items-center justify-center text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white border-none cursor-pointer transition-colors"
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </button>
      </header>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 10 用例全 PASS（收起态此阶段文字仍渲染，属预期中间态，Task 3 处理）

- [ ] **Step 5: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git -C D:/flowweb commit -m "feat(web): Sidebar 折叠状态机+header 重构+localStorage 持久化+宽度过渡（含测试）"
```

---

### Task 3: 窄条形态（文字条件渲染 + 图标居中 + Tooltip + aria-label）

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Test: `apps/web/src/components/layout/Sidebar.test.tsx`

- [ ] **Step 1: 写失败测试**（追加到 describe 末尾）

```tsx
  it('收起态：文字不渲染、aria-label 保留、图标行居中', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    expect(screen.queryByText('首页')).toBeNull();
    expect(screen.queryByText('Flow123')).toBeNull();
    expect(screen.getByRole('link', { name: '首页' }).className).toContain('justify-center');
    expect(screen.getByRole('button', { name: '新建项目' }).className).toContain('justify-center');
    expect(screen.getByTestId('wechat-follow-entry').className).toContain('justify-center');
    expect(screen.getByRole('button', { name: '文档中心' }).className).toContain('justify-center');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 新用例 FAIL（`queryByText('首页')` 命中文字、className 无 `justify-center`），10 已有用例 PASS

- [ ] **Step 3: 实现**（ant `import { App } from 'antd'` 改为 `import { App, Tooltip } from 'antd'`，再替换 4 段）

① 新建项目按钮整段替换：
```tsx
      <Tooltip title={collapsed ? '新建项目' : ''} placement="right">
        <button
          onClick={() => startNewProject(navigate)}
          aria-label="新建项目"
          className={`h-9 w-full rounded-lg bg-[#00bfff] hover:brightness-110 text-black text-sm font-medium leading-[22px] whitespace-nowrap flex items-center border-none cursor-pointer transition-[filter] duration-150 ${
            collapsed ? 'justify-center' : 'gap-2 px-2'
          }`}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <PlusOutlined className="text-base" />
          </span>
          {!collapsed && '新建项目'}
        </button>
      </Tooltip>
```
（收起态去掉 `px-2`，图标在 48-16=32px content 内居中；**保留蓝底**，近方形品牌 CTA）

② nav 整段替换：
```tsx
      <nav className="flex flex-col gap-0.5 mt-2">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.href} title={collapsed ? item.label : ''} placement="right">
            <Link
              to={item.href}
              aria-label={item.label}
              className={`h-9 rounded-lg px-2 flex items-center ${collapsed ? 'justify-center' : 'gap-2'} no-underline text-sm leading-[22px] whitespace-nowrap transition-colors ${
                isActive(item.href)
                  ? 'bg-[#262626] text-white font-medium'
                  : 'text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white'
              }`}
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0">{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          </Tooltip>
        ))}
      </nav>
```
（key 放外层 Tooltip；antd 空 title 不弹、切换零 remount；**不传 getPopupContainer**，默认 portal 到 body，避免被 aside overflow-hidden 裁掉）

③ 公众号按钮整段替换：
```tsx
        <Tooltip title={collapsed ? '关注公众号' : ''} placement="right">
          <button
            data-testid="wechat-follow-entry"
            onClick={() => setQrOpen(true)}
            aria-label="关注公众号"
            className={`rounded-lg flex items-center border-none cursor-pointer transition-colors ${
              collapsed
                ? 'h-9 w-full justify-center text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white'
                : 'h-16 bg-[#1e1e1e] hover:bg-[#262626] justify-between px-3'
            }`}
          >
            {collapsed ? (
              <span className="w-5 h-5 flex items-center justify-center">
                <WechatOutlined style={{ color: '#07c160' }} />
              </span>
            ) : (
              <>
                <span className="flex flex-col items-start">
                  <span className="text-xs font-medium text-white">关注公众号</span>
                  <span className="text-[11px] text-[#707070] mt-0.5">获取最新动态和福利</span>
                </span>
                <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(7,193,96,0.1)' }}>
                  <WechatOutlined className="text-lg" style={{ color: '#07c160' }} />
                </span>
              </>
            )}
          </button>
        </Tooltip>
```
（收起态不渲染 `w-8 h-8` 圆底——32px 撑破 content 区；图标继承 text-sm 放 `w-5 h-5` 容器，保留微信绿）

④ 文档中心按钮整段替换：
```tsx
        <Tooltip title={collapsed ? '文档中心' : ''} placement="right">
          <button
            onClick={() => message.info('敬请期待')}
            aria-label="文档中心"
            className={`h-9 rounded-lg px-2 flex items-center ${collapsed ? 'justify-center' : 'gap-2'} text-sm leading-[22px] whitespace-nowrap text-[#707070] hover:bg-[#1e1e1e] hover:text-[#a0a0a0] border-none cursor-pointer transition-colors`}
          >
            <QuestionCircleOutlined className="text-base" />
            {!collapsed && '文档中心'}
          </button>
        </Tooltip>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 11 用例全 PASS

- [ ] **Step 5: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git -C D:/flowweb commit -m "feat(web): Sidebar 窄条形态——文字条件渲染+图标居中+Tooltip+aria-label（含测试）"
```

---

### Task 4: 回归 + 浏览器实机验收

**Files:** 无新改动（除非验收发现像素问题，微调后须回跑测试）

- [ ] **Step 1: 回归**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: 11 用例全 PASS

（AppLayout.test.tsx 已 mock Sidebar（其 4 用例不受影响），跑 Sidebar 11 例即达标；如需双保险可加跑 `pnpm vitest run src/components/layout`，非必需）

- [ ] **Step 2: 浏览器实机验收**（dev server 已在 5173 运行；若未运行用 preview_start "web"）

逐项核对（对应 spec 验收标准）：
1. `http://localhost:5173/` 展开态：右边框 1px 白色半透明；站标行右侧有折叠按钮；主内容区较之前宽 33px（240px 归一）
2. 点击折叠：240→48px 过渡；**重点实看这 200ms 过程**——因 justify/gap/padding 瞬切而宽度渐变，图标会"先向中间散开（向右漂约 85px）、再随收窄滑回归位"的来回漂移，终态像素正确；ease-out 较快，实机判断是否可接受
3. 收起态：所有图标水平居中（与 header 展开按钮中线共线）；hover 出 Tooltip（右侧）；无文字残留、无溢出
4. 刷新页面：收起状态保持
5. 再点击展开：恢复 240px、站标/文字回归
6. 公众号收起态图标绿色、尺寸与导航图标一致；点击仍弹二维码弹窗
7. 有公告条时（如可触发）sticky top 正常——topOffset 逻辑未动，抽查即可

- [ ] **Step 3: 验收发现问题的处理**

a) 像素级问题（间距/居中偏差）→ 修 `Sidebar.tsx` class → 回跑 Step 1 全绿 → commit：
```bash
git -C D:/flowweb add apps/web/src/components/layout/Sidebar.tsx
git -C D:/flowweb commit -m "fix(web): Sidebar 验收像素微调"
```

b) 若 Step 2 第 2 条的过渡漂移观感不可接受，改用**固定轨道备选**（只改 class，不动状态/测试结构）：
- 图标行全程 `justify-start`（删掉所有 `collapsed ? 'justify-center' : ...` 三目，导航/新建/公众号/文档中心四段）
- 收起态行 padding 改固定居中缩进 `px-1.5`（6px）：图标左缘 = aside px-2(8) + 6 = 14，中心 = 8+6+10 = 24 正落窄条中线；首帧单向小跳约 10px 后纹丝不动，宽度动画只裁右侧文字，无来回漂移
- 更顺滑可把 aside 过渡扩为 `transition-[width,padding-left,padding-right]`
- 同步更新 Task 3 的 justify-center 断言为 px-1.5 断言 → 回跑全绿 → commit：
```bash
git -C D:/flowweb add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git -C D:/flowweb commit -m "fix(web): Sidebar 收起过渡改固定轨道，消除图标来回漂移"
```

---

## Self-Review 记录

1. **Spec 覆盖**：2.1 折叠按钮/header→Task 2；2.2 窄条+居中+公众号→Task 2(宽度)/Task 3(内容)；2.3 过渡→Task 2(aside class)；3 视觉表→Task 1(class)+Task 2(box-border 生效于宽度切换)；4 持久化→Task 2；5 无障碍→Task 2(折叠钮两态)+Task 3(图标行)；6 约束→Task 2(data-collapsed)+Task 3(Tooltip portal/key/单子元素)；7 测试→Tasks 1-3 六用例；8 验收→Task 4。无缺口。
2. **占位符**：无 TBD/TODO/"适当处理"；所有代码步骤含完整代码。
3. **类型/命名一致性**：`SIDEBAR_KEY`/`readCollapsed`/`persistCollapsed`/`toggleCollapsed`/`collapsed` 跨任务一致；测试 `data-testid="sidebar"` 与现有 aside 属性一致。
