# 组几何所有权变更与 +号批量连线（Spec B）— 设计 spec

- 日期：2026-09-28（评审修订版，替代同日初版下半部分）
- 状态：待用户审阅
- 范围：需求 5（组内节点拖出 + 组框动态跟随）/ 6（+号输出按钮）/ 7（拖拽批量连线 + 点击建点）
- 前置：Spec A（`2026-09-28-canvas-group-ui-upgrade-design.md`）先行合入（工具条/选区归一化/token 基建）
- 本篇为**组几何所有权语义变更**：组 position/width/height 从"作者态"变为"由子节点派生态"，须与 manuallyResized / collapsed / savedSize / refitExpandedGroups / 快照恢复五个既有机制重新对表（初版 spec 的 §4.3 经三份外部评审 + 代码实证判定为算法性错误，本篇为其重写）

## 1. 已证实的机制约束（本篇的地基事实）

| # | 事实 | 证据 |
|---|---|---|
| F1 | RF 子节点绝对坐标恒 = 父 positionAbsolute + 子相对 position；拖动每帧由 `calculateNodePosition` 用**父 live 绝对位置**反解子相对坐标（被拖节点每 tick 自纠正） | @xyflow/system 0.0.76 dist esm/index.js:445-484 |
| F2 | 现 `refitGroupBounds` 只写组 position/width/height，**不补偿兄弟子节点相对坐标** → 组原点一动，兄弟绝对坐标整体平移 | canvasStore.ts:1285-1301 |
| F3 | `extent:'parent'` 在 RF 拖动路径被独立消费（夹子节点绝对位置进父盒）——只删 store 写入点不够 | system index.js:451-474 |
| F4 | `hydrateNodes` 在 DB 加载与 localStorage 快照两条恢复路径**无条件回填** `extent:'parent'`（判据 extent==null），有测试守卫 | nodeOrder.ts:43-45、nodeOrder.test.ts:63-67、useCanvasPersistence.ts:44、canvasCollabRuntime applyDocToStore |
| F5 | clamp 与动态 refit 并存 = 死锁（clamp 夹回旧组盒、refit 贴被夹位置，子节点永出不去） | canvasStore.ts:517-544 + groupLayout.ts clampPositionToPadding |
| F6 | refit 豁免三条件已固化：`normal && !collapsed && !manuallyResized`（refitExpandedGroups / useCanvasPersistence 恢复 / toggleCollapse savedSize 优先） | canvasCollabRuntime.ts:306-314、useCanvasPersistence.ts:63-77、canvasStore.ts:1270 |
| F7 | 几何同步通路 = bindBridge 逐帧 syncStoreToDoc（Yjs 单事务）→ 对端 50ms debounce applyDocToStore 全量重建 + refitExpandedGroups；awareness 仅承载 presence（初版 spec 此处描述错误，特此更正） | canvasCollabRuntime.ts:210-227/:270-284 |
| F8 | `findDropGroup` 对 parentId 非空直接 return null（跨组移动现不可能）；`addEdge` 只按 id 幂等、同源判重在 `onConnect`；`removeNodeFromGroup(groupId,nodeId)` 已存在（无 refit）；`deleteNode` 删空组走 `ungroup`（实证无递归） | groupDrop.ts:5、canvasStore.ts:471-478/:598-604/:909-925/:246-250 |
| F9 | 折叠组/分镜组子节点恒 hidden（deriveHidden）；边随端点 hidden；`ImageGenNode` source handle 条件渲染（!editMode） | groupDerive.ts、ImageGenNode.tsx:1140+ |
| F10 | `absoluteRectsOf` 已做绝对坐标累加 + 过滤组节点（不过滤 hidden）；`DRAG_THRESHOLD_PX=5` 已存在；isLocked 画布锁定门禁已有 | handleMenu.ts:23-49/:6、CanvasView.tsx |

## 2. 已拍板口径（用户确认）

1. 拖出修法 = **守恒补偿 + siblings 参照**（否决 union 只扩不缩）
2. 手动 resize 组：拖其子节点即重置 `manuallyResized=false`（旧布局意图失效，组重新贴合）
3. **组不变量：松手静止态组内必须 ≥2 子节点**——拖出后剩 ≤1 个即自动解组（比"空组删除"更强）
4. 跨组拖拽（A 组子节点直接拖进 B 组）：**本次做**
5. 折叠组不渲染 +号（子节点 hidden，防隐身边）
6. 分镜组不参与拖出/跟随机制（子节点坐标恒 {0,0}）

## 3. 详细设计

### 3.1 纯函数层（groupLayout.ts，全部绝对坐标，先写测试）

```ts
/** 组几何唯一写者：贴合子节点包围盒，且不改变任何子节点绝对坐标 */
refitGroupGeometry(groupRect, childRects): { groupRect', childDeltas }
  bbox      = union(childRects) + GROUP_PADDING(左右下) + GROUP_PADDING_TOP(上)
  dx,dy     = bbox.origin − groupRect.origin          // 原点位移
  childDeltas = 每子节点 rel 平移量 = −(dx,dy)         // ★ 守恒补偿，缺此步功能不可用（F2）

/** 拖出判定：以其它子节点为参照（不是以刚被自己撑大的组框） */
decideGroupMembership(candidate: Rect, siblings: Rect[]): 'inside' | 'outside'
  siblings 为空 → 'outside'（单节点组：拖动即趋向解组，见 3.3）
  candidate 与 bbox(siblings)+padding 相交（含相切）→ 'inside'
  否则 → 'outside'

arrangeRects / rectIntersects / rectOutside          // Spec A 已定义，本篇复用
shouldAutoRefit(group) ⇔ groupType==='normal' && !collapsed   // manuallyResized 由口径2在拖动时重置
```

**不变量测试（关掉 F1/F2 反馈回路的锚点）**：`refitGroupGeometry` 前后，除输入变化外所有子节点绝对坐标逐位相等；幂等（不变量已满足时 dx=dy=0）。

### 3.2 extent / clamp 穷举清理（不做存量兼容，从根删除）

| 动作 | 位置 |
|---|---|
| 删 store 写入 | canvasStore.ts 中全部 `extent: 'parent'` 赋值与 `extent: undefined` 清理（初判 12 处写入：groupNodes :831 / addToGroup :889 / dropIntoGroup :941 / mergeStoryboard :998/:1022/:1118/:1156 / convertGroup :1085/:1338 / addImageToStoryboardCell :1378 等 + groupDerive.ts:38；5 处清理：ungroup :872 / removeNodeFromGroup :920 等）——**以 grep `extent` 全量结果为准清零**，字段不存在即无需清 |
| 删恢复期回填 | nodeOrder.ts:43-45 `withExtent` 整段删除（hydrateNodes 退化为 parentMap 回填 + 父前子后） |
| 删 clamp | clampPositionToPadding（groupLayout.ts:61-72）+ onNodesChange 夹取分支（canvasStore.ts:529-544）整体删除（F5 死锁论据写入代码注释处） |
| 同步删测试 | nodeOrder.test.ts:63-67、useCanvasPersistence.test.ts:92（extent 断言→断言 undefined）、groupLayout.test.ts clamp 4 用例、canvasStore.groups.test.ts 组内边距夹取 7 用例（:251-333）、groupDerive.test.ts:49-55、canvasStore.groups.test.ts:40 夹具 extent 字段 |
| 回归锚点 | `hydrateNodes([{parentId}]) → extent === undefined`（刷新/远端重建后拖出不失效的守卫测试） |

### 3.3 拖动跟随与脱离（onNodesChange / onNodeDragStop 改造）

**拖动中（onNodesChange，position 或 dimensions 变更、节点属普通组）**——每帧：
1. 组带 `collapsed` 跳过（折叠态不跟随）；`manuallyResized` → 先置 false（口径 2，同 set）再继续
2. C = 被拖节点，S = 其它子节点绝对 rect 集
3. `decideGroupMembership(C, S)`：
   - inside → 成员 = S∪{C}，`refitGroupGeometry`（守恒：组新几何 + 全部兄弟 rel 补偿；C 的 rel 由 RF 下一帧自纠正（F1），本帧不写 C）
   - outside → 成员 = S，`refitGroupGeometry` 对 S（组框不再框住 C，用户看见"可以脱出"）；S 为空 → 组框不动
4. dimensions 变更同样触发（子节点加载元数据变大也框住，评审实证遗漏项）
5. 分镜组子节点跳过

**松手（onNodeDragStop）时序（顺序写死，防 findDropGroup 吃掉拖出/跨组语义）**：
1. 对被拖普通组子节点：`decideGroupMembership`（vs siblings）为 outside → **先脱离**：扩展 `removeNodeFromGroup`（补：脱离后组对剩余成员 refit 守恒 + `syncGroupDataToNodeStore`）
2. 脱离后（或本就是顶层节点）→ `findDropGroup`（**改造：入口不再对 parentId 短路，改为忽略其原父组**；仍排除组节点自身与折叠组/分镜组不可入）→ 命中则 `dropIntoGroup`（其内部 bounds 重算改走守恒式）
3. **组不变量收口**：任何拖动/脱离结束后，遍历受影响组，子节点数 ≤1 → `ungroup`（复用：实证无递归；守卫 hasActiveProcessInGroup 对 ≤1 子节点场景按现语义放行——若被挡则 message 提示并跳过，登记为已知边界）
4. `stopCapturing()` 维持现调用点——**一次拖拽 = 一个 undo 项**（验收项）

**addToGroup / dropIntoGroup 既有隐患修复**：其 bounds 重算改走 `refitGroupGeometry` 守恒式（新成员在组左上外侧时原实现会平移兄弟——评审实证的既有 bug，本次从根修掉）。

**refitGroupBounds 改造**：内部改走 `refitGroupGeometry`（守恒）。调用点 refitExpandedGroups（F7 对端重建路径）自动获益且幂等（不变量满足时 Δ=0）。

### 3.4 协作 / 撤销 / 快照验收（F7 的对价，不按"开发期可接受"勾掉）

- 拖动中每帧 set（组 + 兄弟 rel + 可能的 manuallyResized 重置）→ bindBridge 单事务逐键写 doc；对端 50ms debounce 全量重建 + refitExpandedGroups（守恒幂等）
- **必测项（Playwright e2e + 双浏览器手测）**：
  - 双端：A 端拖组内子节点，B 端组框跟随无抖动、B 端其它子节点不漂移
  - undo：拖出+解组一次操作，Ctrl+Z 单步整体恢复（组、parentId、坐标）
  - 刷新：拖动/拖出后刷新页面，组几何与刷新前一致（hydrateNodes 无 extent 回归 + nodeStore 快照）
  - jsdom 假绿防线：至少一条 Playwright e2e「按住组内节点拖出 → 拖动中组框几何变化 → 松手 parentId 清除/组收缩/剩1节点自动解组」

### 3.5 +号输出按钮（需求 6）

**渲染层（与 GroupToolbar 同构，否决节点内流坐标方案）**：新组件 `AddOutputHandle`，portal 至 #node-toolbar-portal（屏坐标层），`useViewport + internals.positionAbsolute` 换算（多选框用 SelectionBoxOverlay 屏坐标 bounds，组框用组绝对 rect×zoom）：
- 定位：宿主框右缘垂直中点；**命中区只向框外展开**（40×56，`left:'100%'`）——框内右缘归 NodeResizer 右中手柄与子节点，零遮挡（评审实证 80×80 会盖子节点 20px/10px）
- 24px 圆形指示器（14px 加号 SVG）贴框缘；`pointerEvents:auto` + `nodrag nopan` + `setPointerCapture`；Esc 取消拖拽态
- 显示条件：多选框 ≥2 选中（marquee 进行中隐藏，沿 SelectionBoxOverlay 现机制）；**普通组选中且未折叠**；分镜组/折叠组不渲染（口径 5）
- `isLocked` 态不响应（F10）

### 3.6 批量连线与点击建点（需求 7）

**交互状态机**（组件局部 state，阈值复用 `DRAG_THRESHOLD_PX`，不自写 5px 字面量）：
- pointerdown 记起点 → 位移 ≥ DRAG_THRESHOLD_PX 进连线态；pointerup 早于阈值 = 点击
- 连线态：`BatchConnectLines`（同 portal 层）自绘 SVG 多段线：每源节点右侧中点（绝对 rect×zoom 换算，统一锚点函数与 +号 共用）→ 指针当前位置；激活色；指示器跟随指针
- 实时命中：`absoluteRectsOf` 复用 + **补 !hidden 过滤** + 排除源自身 + 排除组节点（F9：hidden 目标会建出永远看不见的边）→ 命中节点高亮
- pointerup：命中 → `batchConnect`；落空 → 取消。**与 handle 拖线落空弹菜单的行为差异为有意设计**（多选批量场景弹菜单无意义），spec 显式声明防误报 bug

**batchConnect(sourceIds, targetId): string[]**（评审契约采纳）：
1. 归一化源集：normalizeSelection 展开（组→子节点）→ 去组节点/hidden 节点/target 自身 → 去重；**过滤无可用 source handle 的源**（ImageGenNode editMode 中无 source handle，F9）
2. pair 判重：`existing = Set(edges.map(e => e.source+'→'+e.target))`
3. 边 id = `handleEdgeId(source, target)`（确定性 id → 同参数幂等、双端同时建边不翻倍、与 handle: 前缀通道惯例一致，F8）
4. **一次 set 提交全部新边**（N 次 addEdge = N 次 store 写/事务/重渲染，禁止）
5. 校验抽公共 `canConnect(source,target)`（现唯一规则禁自环）供 onConnect/batchConnect 共用，避免双校验路径

**点击建点**：+号右侧弹类型菜单——`SOURCE_ITEMS` 从 HandleAddNodeMenu 导出复用（文本/图片/视频/音频）；菜单 store 载荷从 `{nodeId, side}` 泛化为 `{nodeIds: string[], side}`（单源调用点同步适配）；背板+Escape 关闭机制照抄。选中类型 → `addNode(type, +号锚点右侧 80px 流坐标)`（addNode 现语义会清其它选中并选中新节点——**声明为预期行为**，与 handle 菜单建点一致）→ `batchConnect(源集, 新节点)`。

**源集合定义**：多选框 = normalizeSelection 展开；组框 = 组内全部子节点（未折叠）。

## 4. 测试矩阵（TDD，每条先红后绿）

| 类 | 用例 |
|---|---|
| 纯函数 | refitGroupGeometry：不变量（子绝对坐标不变）/幂等/空集；decideGroupMembership：分离/相交/相切/空 siblings 五例 |
| store 回归 | hydrateNodes 后 extent undefined；groupNodes/addToGroup/dropIntoGroup 后 extent undefined |
| store 拖动 | 拖 inside：组贴合含 C、兄弟绝对不变；拖 outside：组=S、C 不被框；manuallyResized 拖动即重置；collapsed 跳过；storyboard 跳过；dimensions 触发 |
| store 松手 | 脱离（parentId 清/坐标转全局/组守恒收缩）；剩 1 节点自动 ungroup；剩 0 自动 ungroup；跨组：A→B 先脱离再 attach；时序（脱离先于 findDropGroup） |
| store 连线 | batchConnect 幂等/同对跳过/自环排除/hidden 与组目标排除/单次 set/确定性 id |
| 组件 | AddOutputHandle：阈值两分支/isLocked/折叠隐藏；BatchConnectLines：zoom≠1 换算用例 |
| e2e | 3.4 四条（jsdom 假绿防线） |

## 5. 风险与已知边界登记

- 拖动帧 RF "指针静止门控"：对端拖组框时本端指针静止，子节点随父框移动——RF 容器语义固有行为，非本次引入，登记不修
- 拖动每帧多写 N 节点键 → 对端重建压力：开发期实测无感则不节流；若双端验收发现抖动，再评估 rAF 合批（范围外预留）
- `hasActiveProcessInGroup` 若在 ≤1 子节点解组时误挡（竞态非空）：message 提示 + 跳过，用户重试——登记为已知边界
- 旧 `--storyboard-group-shell-bg` 命名不存在（初版笔误），实际 token 见 Spec A `--canvas-storyboard-shell-bg`

## 6. 范围外

- 拖动帧 rAF 合批/广播节流（性能实测后另议）
- 组几何快照源重构（快照几何读 nodeStore 改读 canvasStore 的深层统一——现状 refitExpandedGroups + 折叠渲染硬编码已闭环，不动）
- +号落空弹菜单（有意差异，见 3.6）
