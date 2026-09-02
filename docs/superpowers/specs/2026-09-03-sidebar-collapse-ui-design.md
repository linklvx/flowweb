# Spec：侧边栏收起与视觉对齐（UI 优化）

日期：2026-09-03
状态：已确认（设计 4 节 + 外部审核 B1-B4 整合 + B1 拍板方案 A）
涉及文件：`apps/web/src/components/layout/Sidebar.tsx`、`apps/web/src/components/layout/Sidebar.test.tsx`
约束：**不涉及业务逻辑，不修改业务逻辑代码，`AppLayout.tsx` 零改动**

## 1. 背景与目标

对齐参考代码（LibTV 侧边栏）的视觉规范：新增收起/展开侧边栏能力，右边框与列表行高/字体对齐参考值。参考代码中的新功能（推广卡片、帮助弹窗等）不引入。

## 2. 交互设计

### 2.1 折叠按钮
- 位置：header 行右侧。header 改为 `h-[50px] flex items-center justify-between` 包裹层（左：Flow123 站标 Link；右：折叠按钮）
- 按钮规格：热区 `size-9`（36px）、`rounded-lg`、hover 背景微亮（沿用项目 hover 色 `#1e1e1e`）
- 图标：展开态 `MenuFoldOutlined`（aria-label="收起侧边栏"）；收起态 `MenuUnfoldOutlined`（aria-label="展开侧边栏"）。均来自已有依赖 `@ant-design/icons ^5.5.0`，零新依赖
- 收起态 header 只剩居中的展开按钮（站标隐藏）

### 2.2 窄条形态（收起态）
- 宽度 `48px`（w-12），水平 padding `px-4`→`px-2`
- 展示规则：新建项目只显示 `+` 号；导航 4 项只显示图标；公众号/文档中心只显示图标；站标不渲染
- **图标行水平居中**：收起态所有图标行 `justify-center`（展开态保持默认贴左）。若贴左，图标中心 x=18 偏离窄条几何中心 x=24 约 6px，与 header 居中按钮不对齐
- **公众号收起态**：不渲染双行文案与 `w-8 h-8` 圆底容器（32px 会撑破收起态 content 区），只保留 `WechatOutlined`（置于现有 `w-5 h-5` 图标容器规格）

### 2.3 过渡
- `transition-[width]` 200ms ease-out；main 区（`flex-1`）随 aside 宽度自然 reflow，不加过渡
- 文字处理：收起态文字**直接条件渲染**（切换瞬间消失，不做延迟卸载）；aside `overflow-hidden` + 行内 `whitespace-nowrap` 仅作为过渡期兜底，防中间态换行溢出

## 3. 视觉规范（对照）

| 项 | 现状 | 改为 |
|---|---|---|
| box-sizing | content-box（preflight:false，无全局兜底） | aside 显式 `box-border`（B1 方案 A） |
| 展开态总宽 | 实际 273px（240+32+1） | **归一 240px**，主内容区随之 +33px（已拍板接受） |
| 右边框 | 1px `#262626` | 1px `#ffffff18`（宽度不变只换色） |
| header 高度 | pt-5 pb-4（合计约 58px） | 固定 `h-[50px]`（整列上移约 8px，预期内） |
| 列表行高 | h-9（36px） | 不变 |
| 字体 | text-sm（14px） | 不变 |
| 行内行高 | leading-5（20px） | `leading-[22px]` |
| 文档中心 | text-[13px] | `text-sm` + h-9 对齐 |
| hover/active 色 | `#1e1e1e` / `#262626` | **保留不动**（未被要求，精准修改） |

## 4. 状态与持久化

- 状态内聚于 `Sidebar.tsx`：`useState` 惰性初始化读取 localStorage，切换时同步写入
- key 抽为常量 `SIDEBAR_KEY = 'sidebar.collapsed'`；读取包一层 `try/catch`（隐私模式/存储被禁时 getItem 可能抛）
- 值：`'true'` / `'false'`；Vite CSR，无需 typeof window 判断

## 5. 无障碍（B4）

- 收起态文字不渲染后，所有图标行（新建项目、导航 4 项、公众号、文档中心）显式 `aria-label={label}`
- 折叠按钮两态 aria-label："收起侧边栏" / "展开侧边栏"

## 6. 实现约束（防返工）

1. **Tooltip 用默认 portal**（挂 body），不传 `getPopupContainer` 指向 aside，否则弹层被 aside `overflow-hidden` 裁掉；`placement="right"`，仅收起态挂 Tooltip
2. Tooltip 子节点必须是单个可 forwardRef 元素（react-router v7 `Link` 与原生 `button` 均满足），不可包 Fragment/多节点；map 时 key 放外层 Tooltip 上
3. aside 挂 `data-collapsed={collapsed ? 'true' : undefined}` 供测试断言：收起态为 `"true"`，展开态属性不渲染（React 对 `undefined` 不输出属性）

## 7. 测试策略（TDD）

现有 5 用例保留不回归（beforeEach 清空 localStorage，保证默认展开路径）。新增用例：

| # | 用例 | 断言 |
|---|---|---|
| 1 | 折叠按钮渲染 | `aria-label="收起侧边栏"` 存在 |
| 2 | 点击收起 | aside `data-collapsed="true"`；`localStorage['sidebar.collapsed']==='true'` |
| 3 | 持久化恢复 | 预置 localStorage `'true'` 后 mount，初始即 `data-collapsed="true"` |
| 4 | 收起态再点击展开 | aria-label 变"展开侧边栏"，点击后 `data-collapsed` 移除、localStorage 写 `'false'` |
| 5 | 收起态文字隐藏 | `queryByText('首页')` 为空；对应 Link 有 `aria-label="首页"` |
| 6 | 视觉 class | aside 含 `border-[#ffffff18]`、`box-border`；导航行含 `leading-[22px]`、`h-9` |

Tooltip 弹层交互不做单测（jsdom 限制）。闭环要求：实现后实跑 `vitest run Sidebar`（红→绿→5 老用例不回归）。

## 8. 验收标准

1. 点击折叠按钮：侧边栏 240px→48px 平滑过渡（200ms），再点击恢复
2. 收起态所有图标水平居中、带 Tooltip 与 aria-label，无文字残留、无溢出
3. 刷新页面后收起状态保持
4. 右边框 1px `#ffffff18`；导航/新建项目/文档中心 h-9 + text-sm + leading-[22px]
5. 展开态总宽归一 240px（内容区 +33px）
6. 全部测试通过（含既有 5 用例），浏览器实机验收无回归
