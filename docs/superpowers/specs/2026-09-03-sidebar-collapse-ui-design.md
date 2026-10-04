<!-- doc-status: historical | verified_at: n/a -->
# Spec：侧边栏收起与视觉对齐（UI 优化）

日期：2026-09-03
状态：已确认（设计 4 节 + 外部审核 B1-B4 整合 + B1 拍板方案 A + 终审 3 必改 4 建议并入）
涉及文件：`apps/web/src/components/layout/Sidebar.tsx`、`apps/web/src/components/layout/Sidebar.test.tsx`
约束：**不涉及业务逻辑，不修改业务逻辑代码，`AppLayout.tsx` 零改动**

## 1. 背景与目标

对齐参考代码（LibTV 侧边栏）的视觉规范：新增收起/展开侧边栏能力，右边框与列表行高/字体对齐参考值。参考代码中的新功能（推广卡片、帮助弹窗等）不引入。

## 2. 交互设计

### 2.1 折叠按钮
- 位置：header 行右侧。header 改为 `h-[50px] flex items-center` 包裹层（左：Flow123 站标 Link；右：折叠按钮）
- **header 对齐随态切换**：展开态 `justify-between`；收起态 `justify-center`（站标隐藏后单按钮若保持 between 会停在最左）
- 按钮规格：热区 `size-9`（36px）、`rounded-lg`、hover 背景微亮（沿用项目 hover 色 `#1e1e1e`）
- 图标：展开态 `MenuFoldOutlined`（aria-label="收起侧边栏"）；收起态 `MenuUnfoldOutlined`（aria-label="展开侧边栏"）。均来自已有依赖 `@ant-design/icons ^5.5.0`，零新依赖
- 收起态 header 只剩居中的展开按钮（站标隐藏）

### 2.2 窄条形态（收起态）
- 宽度 `48px`（w-12），水平 padding `px-4`→`px-2`
- 展示规则：新建项目只显示 `+` 号（**保留蓝底**，只隐文字 + 居中，自然成为近方形品牌 CTA）；导航 4 项只显示图标；公众号/文档中心只显示图标；站标不渲染
- **图标行水平居中**：收起态所有图标行 `justify-center`（展开态保持默认贴左）。若贴左，图标中心 x=18 偏离窄条几何中心 x=24 约 6px，与 header 居中按钮不对齐
- **公众号收起态**：不渲染双行文案与 `w-8 h-8` 圆底容器（32px 会撑破收起态 content 区），只保留 `WechatOutlined` 放入 `w-5 h-5` 图标容器，且图标尺寸由 `text-lg`(18px) 降为继承 `text-sm`（与其他导航图标一致，避免大一圈）

### 2.3 过渡
- `transition-[width]` 200ms ease-out；main 区（`flex-1`）随 aside 宽度自然 reflow，不加过渡
- 文字处理：收起态文字**直接条件渲染**（切换瞬间消失，不做延迟卸载，省掉 onTransitionEnd/定时器）；`overflow-hidden` 仅作防御、`whitespace-nowrap` 只负责**展开态**防换行
- **已知取舍（预期表现，非 bug）**：宽度是 200ms 渐变，而 justify-content/gap/padding 同帧瞬切。收起第 1 帧行已 `justify-center` 但宽度仍 ≈240px，图标中心从 ≈34 瞬跳至 ≈120（向右漂约 85px），随后随宽度收窄滑回归位 24——视觉为"先向中间散开、再收回"的来回漂移；终态像素正确。实机验收 200ms 过程：可接受则通过；不可接受走备选（行全程 `justify-start` 不切 justify，收态改固定居中缩进 `px-1.5`，图标首帧单向小跳约 10px 后纹丝不动；更顺滑可将 aside padding 纳入 `transition-[width,padding-left,padding-right]`），实机定夺

## 3. 视觉规范（对照）

| 项 | 现状 | 改为 |
|---|---|---|
| box-sizing | content-box（preflight:false，无全局兜底） | aside 显式 `box-border`（B1 方案 A） |
| 展开态总宽 | 实际 273px（240+32+1） | **归一 240px**，主内容区随之 +33px（已拍板接受） |
| 右边框 | 1px `#262626` | 1px `#ffffff18`（宽度不变只换色） |
| header 高度 | pt-5 pb-4（合计约 58px） | 固定 `h-[50px]`（整列上移约 8px，预期内） |
| 列表行高 | h-9（36px） | 不变 |
| 字体 | text-sm（14px） | 不变 |
| 行内行高 | leading-5（20px，导航/新建项目；文档中心无 leading） | `leading-[22px]` **三处统一**：导航、新建项目、文档中心 |
| 文档中心 | text-[13px] | `text-sm` + h-9 对齐 |
| hover/active 色 | `#1e1e1e` / `#262626` | **保留不动**（未被要求，精准修改） |

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；上表"preflight:false 无全局兜底"及 box-border 补偿裁定仅存历史档。

## 4. 状态与持久化

- 状态内聚于 `Sidebar.tsx`：`useState` 惰性初始化读取 localStorage，切换时同步写入
- key 抽为常量 `SIDEBAR_KEY = 'sidebar.collapsed'`；读取包一层 `try/catch`（隐私模式/存储被禁时 getItem 可能抛），**catch 兜底为 false（展开）**
- 值：`'true'` / `'false'`；Vite CSR，无需 typeof window 判断

## 5. 无障碍（B4）

- 收起态文字不渲染后，所有图标行（新建项目、导航 4 项、公众号、文档中心）显式 `aria-label={label}`
- 折叠按钮两态 aria-label："收起侧边栏" / "展开侧边栏"

## 6. 实现约束（防返工）

1. **Tooltip 用默认 portal**（挂 body），不传 `getPopupContainer` 指向 aside，否则弹层被 aside `overflow-hidden` 裁掉；`placement="right"`；**始终包裹、`title={collapsed ? label : ''}`**（antd 空 title 不弹、切换零 remount）
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
| 6 | 视觉 class | aside 含 `border-r` + `border-[#ffffff18]`（宽度+颜色同时断言，防只改色丢宽度）、`box-border`；导航/新建项目/文档中心行均含 `leading-[22px]`、`h-9` |

Tooltip 弹层交互不做单测（jsdom 限制）。闭环要求：实现后实跑 `vitest run Sidebar`（红→绿→5 老用例不回归）。

## 8. 验收标准

1. 点击折叠按钮：侧边栏 240px→48px 平滑过渡（200ms），再点击恢复
2. 收起态所有图标水平居中、带 Tooltip 与 aria-label，无文字残留、无溢出
3. 刷新页面后收起状态保持
4. 右边框 1px `#ffffff18`；导航/新建项目/文档中心 h-9 + text-sm + leading-[22px]
5. 展开态总宽归一 240px（内容区 +33px）
6. 全部测试通过（含既有 5 用例），浏览器实机验收无回归
