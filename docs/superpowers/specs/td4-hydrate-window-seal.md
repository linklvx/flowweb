# Spec: TD-4 持久化防抖慢请求覆盖窗口收口（子批 3d）

日期：2026-08-21
状态：已落地（D1=方案 A，D2=浏览器慢 fetch 验证纳入并实证通过）
来源：tech-debt.md TD-4（canvas-create-unify-fix plan 备注1，用户确认接受为 P2）；第三批子批 3d
前置：3c（8be333a）已落地 isHydrating 抑制接口——本批是该接口的收口应用

## 侦查结论（2026-08-21 实测核实）

1. **台账原定修复方向已由 3c 落地**：「加载期间订阅 isLoading 标志，防抖写入在 isLoading=true 时抑制」——3c 的 isHydrating 窗口（page.tsx:111 置位 → finish/错误复位）已覆盖项目切换清 store → DB 加载全程，单写者跳过并清除挂起定时器（useCanvasPersistence S1 语义）。**写侧污染已消**
2. **残余：读侧 clobber——慢 fetch 返回覆盖窗口内用户编辑**。窗口解剖（A→B 切换，page.tsx 现码）：
   - run 2 起：isHydrating=true + 清空双 store，`loadProjectIntoStore(B)` fetch 进行中
   - **projectId state 仍为 A**（finish 才切换）→ CanvasPageInner 保持挂载 → 画布可见但已被清空
   - 窗口内画布**完全可交互**：用户可点击/加节点/编辑（AddNodeMenu.tsx:197 的 `addNode` 是 store action，任何时刻可调）
   - fetch 返回 → `loadProjectIntoStore` 无条件整体 setState（DB 非空时，page.tsx:83-100）→ **窗口内编辑被覆盖丢失**（DB 空守卫只护 DB-empty 场景）
3. **无清空分支（同项目重跑）无交互窗口**：StrictMode 二次执行/重试路径中 projectId 均为 null → 界面停在「加载画布」全屏态，不可编辑——该分支无残余风险
4. **键盘路径是遮罩之外的入口**：Tab 开 AddNodeMenu（document 级监听，page.tsx CanvasKeyboardHandler）、Delete 作用于选中节点（清空后无选中，实际 no-op）——指针遮罩无法封住 Tab 路径
5. CanvasView 无现成 loading/overlay UI；编辑丢失发生概率低（原台账已注明），且用户当时面对的是异常空画布（本就易误操作）
6. 3c 遗留的既知无害冗余：finish 复位后 hook 恢复 effect 与 canvasStore.setProjectId 触发的订阅调度 → 幂等回写（同数据写回），不在本批范围

## 策略决策（D1 请选择）

### 方案 A：isHydrating 交互阻塞（遮罩 + 键盘守卫）→ 推荐

- CanvasPageInner 根层渲染全屏半透明遮罩（`isHydrating` 订阅），提示「画布加载中」——指针交互全封
- CanvasKeyboardHandler 增加 isHydrating 守卫（Tab 菜单/fitView 快捷键忽略）
- 效果：窗口内无法产生编辑 → clobber 类整体消除；同时修正「切换期间空画布可编辑」的 UX 异常（用户不再能往空画布里误操作）
- 成本：遮罩组件 + 一行守卫 + 测试；风险低

### 方案 C：接受编辑丢失，仅收案

- 3c 已保证「不落脏数据」（窗口内编辑不写 localStorage/不产生脏快照），丢失本身概率低且用户当时在异常状态
- TD-4 直接清账（引用 8be333a 的写侧抑制），零代码
- 残留：UX 异常（空画布可交互）保留

## 修复设计（按方案 A）

1. **遮罩**：CanvasPageInner 根 div 内新增条件渲染层（`absolute inset-0 z-40`，半透明底 + 「画布加载中」文案 + Spin），`useCanvasStore((s) => s.isHydrating)` 订阅驱动
   - 定位已核实（C1）：根 div className 含 `relative`（h-screen relative overflow-hidden），absolute inset-0 覆盖范围正确；antd Modal portal 挂 body 级 z-1000 不受影响
   - 可访问性（S1）：`role="status"` + `aria-live="polite"`
2. **键盘守卫**：CanvasKeyboardHandler 的 handleKeyDown 首行加 `if (useCanvasStore.getState().isHydrating) return;`
   - 范围已核实（C2）：该 handler 仅处理画布快捷键（Tab 菜单 / Ctrl+0 / Alt+Shift+F fitView），无全局操作快捷键——全守卫合理，无误拦
3. **DB 空守卫联动无改动**：遮罩期间无编辑 → 空守卫语义不变
4. 遮罩不做最小显示时长（C3：短 fetch 一闪可接受，浏览器验证如体验不佳再评估）
5. 台账 TD-4 → 已清账（遮罩消除窗口 + 3c 写侧抑制，双引用 8be333a 与本批 commit）

## 验证标准（按方案 A）

1. 新测试红→绿：
   - 遮罩渲染：isHydrating=true 时存在、**阻断交互**（elementFromPoint 命中遮罩层或等价 z/pointer-events 断言，S2）且带 a11y 属性；false 时不存在
   - 键盘守卫：isHydrating=true 时 Tab 不开菜单
2. `pnpm --filter @flowweb/web test` 全绿；`tsc -b` 无新错误
3. 浏览器验证（fetch monkey-patch 注入 2s 延迟模拟慢请求）：
   - A→B 切换窗口内遮罩可见、点击/Tab 均无效果
   - fetch 返回后遮罩消失、B 数据完整渲染
   - 窗口内 localStorage 无新写入（3c 抑制回归确认）
4. 台账 TD-4 清账

## 不做什么

- 不做编辑保留（窗口内编辑与慢到的 DB 数据语义上不可调和——编辑发生在错误的项目上下文里，保留无意义）
- 不动 loadProjectIntoStore 的 setState 逻辑（遮罩已使 clobber 不可达，改判条件属过度设计）
- 不处理 3c 既知的幂等回写（结论 6，无害）
- 不动无清空分支（结论 3，无风险）

## 风险

- 遮罩闪烁（短 fetch 时一闪而过）→ fetch 通常 <300ms，半透明轻量遮罩可接受；如实际体验不佳再评估最小显示时长
- 遮罩 z-index 与 Modal 层级冲突 → MaterialLibraryModal 等 antd Modal 默认 z-index 1000，遮罩 z-40 不会盖住后开的弹窗；且弹窗打开时不可能处于 hydrate 窗口

## 决策点（请确认）

- **D1 方案选择**：A 交互阻塞（推荐）vs C 零代码收案
- **D2 验证形式**：浏览器慢 fetch 注入验证纳入（推荐）与否
