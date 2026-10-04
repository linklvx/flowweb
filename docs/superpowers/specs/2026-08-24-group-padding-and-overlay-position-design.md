<!-- doc-status: historical | verified_at: n/a -->
# 组框非对称内边距 + 打组后悬浮层定位修复 — 设计文档

日期：2026-08-24
状态：已与用户确认行为语义；已并入用户评审核验意见（含补充的 TextNodeToolbar 一处）

## 1. 背景与问题

用户在画布中 Shift 多选两个图片节点打组后发现两个问题：

**问题 A**：组框（`react-flow__node-group`）内边距目前四边均为 20px
（`groupLayout.ts` 的 `GROUP_PADDING`），需要改为**上 50px、左右下 20px**，
且内边距是**硬性保留区**（CSS padding 语义）：子节点任何时候不能进入保留区。
用户已明确确认：顶排图片打组时就贴着 50px 线，往上方向**完全拖不动**是预期行为。

**问题 B**：打组后组内图片节点的悬浮工具条错位到视口左上角，解组后恢复。

### 问题 B 根因

打组时子节点坐标被改写为**相对组原点**的坐标（`canvasStore.ts:768-769` 设置
`parentId` + 坐标平移）。而以下 **7 处**代码把 `node.position` 当作画布**绝对**
坐标做 `position * zoom + viewport` 视口换算，组不在画布原点时结果落在视口
左上角：

| # | 文件:行 | 影响的悬浮层 |
|---|---|---|
| 1 | `ImageNodeToolbar.tsx:360-361` | 图片主工具条（本次报告） |
| 2 | `TextNodeToolbar.tsx:169` | 文本节点工具条 |
| 3 | `AnnotationToolbar.tsx:115-116` | 标注工具条 |
| 4 | `EditToolbar.tsx:298-299` | 裁切/擦除/扩图/重绘工具条 |
| 5 | `TransformToolbar.tsx:91-92` | 旋转镜像工具条 |
| 6 | `ImageGenNode.tsx:1042-1043` | 扩图 frameVpBottom/CenterX |
| 7 | `ImageGenNode.tsx:1220-1221` | OutpaintSelectionOverlay 选区悬浮层 |

React Flow v12.10.2 的 `internalNode.internals.positionAbsolute` 始终维护
绝对坐标（父组位移自动累加，已核实 `@xyflow/system` 源码
`calculateChildXYZ`/`calculateNodePosition`），是正确数据源。
**代码库已有先例**：`GroupToolbar.tsx:33` 即用 `internalNode.internals.positionAbsolute`
定位组工具条，打组/解组场景均正常。

`VideoNodeToolbar` 未使用 `internalNode.position` 视口换算，不在清单内。

## 2. 需求（行为规范）

- **R1 非对称组框内边距**：`calcGroupBounds` 按 上50、左右下20 计算组边界。
  影响四个调用点，行为保持一致：
  - `groupNodes`（canvasStore.ts:754，打组）
  - `addToGroup`（:842，添加到组）
  - `dropIntoGroup`（:907，拖入组）
  - `refitGroupBounds`（:1271，重算组边界，展开恢复等）
- **R2 拖拽硬约束（保留区）**：普通组（父组 `groupType !== 'storyboard'`）的
  子节点位置满足：
  - `x >= 20` 且 `x <= 组宽 - 20 - 子宽`
  - `y >= 50` 且 `y <= 组高 - 20 - 子高`
  - 顶排/贴边子节点往保留区方向拖不动（预期行为，用户确认）
- **R3 悬浮层绝对坐标修复**：上述 7 处视口换算全部改用
  `internals.positionAbsolute`，打组/解组后所有 portal 悬浮层位置正确。
- **R5 缩放最小尺寸限制（2026-08-24 追加，用户选定方案 B）**：普通组的
  NodeResizer 动态最小尺寸 = 子节点联合包围盒 + 非对称 padding：
  - `minWidth = 子节点联合宽 + 40`（左右各 20）
  - `minHeight = 子节点联合高 + 70`（上 50 + 下 20）
  - 子节点尺寸取 `n.width ?? n.measured?.width ?? 280` / `?? 120`（与既有
    fallback 约定一致），坐标取组内相对 `n.position`
  - 无子节点时保留现有静态 200/120 兜底
  - 子节点在缩放过程中永不移动（区别于"缩放时重夹"方案，用户已选定）
  - 分镜组无 resizer，不受影响；onNodesChange 夹取逻辑不变

## 3. 方案选择

实现 R2 的候选：

| 方案 | 结论 |
|---|---|
| **A. `onNodesChange` 集中夹取（选定）** | `canvasStore.ts:483` `applyNodeChanges` 之后，在 `set()` 内、`return` 前对**本批变更涉及的**父组为普通组的子节点按组**当前**宽高与边距常量夹取。单一位置生效；自动跟随组 resize/refit；拖拽与键盘微移都经过该路径；无状态同步负担。 |
| B. 子节点自定义 extent 矩阵 | RF 惯用机制（父相对坐标语义已核实），但组每次 resize/refit/加组都要同步重算所有子节点 extent；且 RF 量测更新路径（`updateNodeInternals`）对父相对 extent 的 `positionAbsolute` 处理有缺陷，存在边线错位风险。弃。 |
| C. `onNodeDrag` 拦截 | 覆盖不了键盘微移等路径。弃。 |

## 4. 实现要点

### 4.1 非对称内边距（R1）

`apps/web/src/utils/groupLayout.ts`：

- 新增导出常量 `GROUP_PADDING_TOP = 50`
- `GROUP_PADDING = 20` 保留（复用为左右下）
- `calcGroupBounds`：`minY` 减 `GROUP_PADDING_TOP`，`minX/maxX/maxY` 逻辑不变

### 4.2 拖拽硬约束（R2）

`apps/web/src/stores/canvasStore.ts` 的 `onNodesChange`（:481 的 `set()` 内、
`applyNodeChanges` 之后、`return` 之前）：

- **只处理本批变更涉及的节点**（评审核验采纳）：遍历 `changes` 中
  `type === 'position'`（且带 `position` 字段）或 `type === 'dimensions'` 的
  变更 id，在 `nextNodes` 中查节点后夹取。理由：
  - NodeResizer 缩小组时只有组的 dimensions 变更、子节点不在批次中 →
    子节点不跳位，下次拖动/自身尺寸变化时才被夹取（预期 UX）
  - select-only 批次天然跳过，避免无谓 O(n)
  - 子节点自身 dimensions 变更（如图片加载撑大）即时夹取
- 夹取条件：节点有 `parentId`，父组存在且 `type === 'group'` 且
  `groupType !== 'storyboard'`（分镜格子节点也带 `extent: 'parent'` 且从
  `{0,0}` 起排，不能用 extent 判别，必须按父组类型门控）
- 组宽高：`parent.width ?? parent.measured?.width ?? 0`（组节点创建时显式
  设置宽高）
- 子宽高：`node.width ?? node.measured?.width ?? 280` /
  `node.height ?? node.measured?.height ?? 120`（补全 measured 一级，
  避免首帧未测量时夹取边界算错）
- 夹取函数：`clamp(v, lo, hi) = Math.min(Math.max(v, lo), hi)`；
  组被手动缩到比内容+边距还小导致区间反转时，结果贴住 `hi`（下/右边距），
  属可接受的退化行为（NodeResizer 有 minWidth/minHeight 限制，场景罕见）
- 子节点保留 `extent: 'parent'` 作为越界硬停兜底；多选拖拽逐节点独立
  夹取，与 RF 自带行为一致，无需特殊处理

### 4.3 悬浮层绝对坐标修复（R3）

统一改法：`internalNode[?.].position` → `internalNode[?.].internals?.positionAbsolute`
（`?? 0` 或 `?? node.position` 兜底保持现状）：

- `ImageNodeToolbar.tsx:360-361`：`nodeX/nodeY` 改取
  `internalNode?.internals?.positionAbsolute`，公式不变
- `TextNodeToolbar.tsx:169`：解构改为取 `internals.positionAbsolute`
- `AnnotationToolbar.tsx:115-116`、`EditToolbar.tsx:298-299`、
  `TransformToolbar.tsx:91-92`：同模式两行替换
- `ImageGenNode.tsx:1042-1043、1220-1221`：三元内
  `internalNode?.position.x/y` → `internalNode?.internals?.positionAbsolute?.x/y`，
  `?? node.position.x/y` 兜底保持

## 5. 测试计划（TDD，红-绿-重构）

### 5.1 既有断言更新（先改断言见红）

`apps/web/src/utils/groupLayout.test.ts`：

- case1（:55-62）：items (100,200,300,150)+(500,100,300,150)
  → `{ x: 80, y: 50, width: 740, height: 320 }`（minY=100−50，maxY=350+20）
- case2（:64-70）：(100,100,200,100)
  → `{ x: 80, y: 50, width: 240, height: 170 }`
- 用例名/注释同步（"上外扩 50、其余 20"）

`apps/web/src/stores/canvasStore.groups.test.ts`：

- groupNodes 用例（:30-44）：n1(100,100,300,200)、n2(500,50,300,300) 重算：
  - `group.position = { x: 80, y: 0 }`（minY=50−50）
  - `group.width = 740`、`group.height = 370`（maxY=350+20）
  - `child1.position = { x: 20, y: 100 }`、child2 相对 `{ x: 420, y: 50 }`
  - :36 注释同步
- addToGroup 用例（:99）`free.position.x === 2000 - 80` 不变（minX 未变）

### 5.2 新增用例

`apps/web/src/stores/canvasStore.test.ts`（或 groups.test.ts）：

- 普通组子节点 `y < 50` 的 position 变更被夹回 50
- `x < 20` 夹回 20；`x + 子宽 > 组宽 - 20` 夹回右上界；下边界同理
- 无父节点的 position 变更不受影响
- 分镜组（`groupType: 'storyboard'`）子节点不受影响
- 子节点 dimensions 变更（图片撑大）触发即时夹取
- select-only 批次不改任何节点位置

`apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`：

- 现有 mock（:4-10 默认、:21-24 afterEach 重置、各用例 override）补
  `internals: { positionAbsolute: { x, y } }`，否则换用 positionAbsolute 后
  `internals` 为 undefined 用例会集体变红
- 新增"父组坐标系"用例：mock 相对 `position ≠ positionAbsolute`，
  断言工具条按 `positionAbsolute` 定位

`TextNodeToolbar.test.tsx`、`EditToolbar.test.tsx`、`TransformToolbar.test.tsx`：

- 同样检查/补齐 mock 的 `internals.positionAbsolute`，并各加一个
  父组坐标系定位用例

`AnnotationToolbar`：无既有测试文件，新增最小定位用例
（参考 ImageNodeToolbar.test.tsx 的 hoisted mock 模式）

`ImageGenNode.test.tsx`：扩图选区悬浮层同类用例（positionAbsolute 生效）

## 6. 非目标 / 范围外

- 分镜组（storyboard）内边距与拖拽行为不变
- **既有怪癖记录在案（本次不碰）**：`addToGroup`/`dropIntoGroup`/
  `refitGroupBounds` 移动组原点时不回写其余子节点的相对坐标
  （canvasStore.ts:848-852 只改新子节点与组节点），组原点变化时既有子节点
  会随原点位移。此行为在当前对称 padding 下已存在，非本次引入；新 padding
  下方向自洽（组只向保留区方向扩展时不触发）。如需修复另行开任务
- 组折叠/展开、历史快照（TD-15）行为不变
- 不改变解组逻辑（现有恢复绝对坐标行为正确）
- `SelectionBoxOverlay`（多选拉框，节点未父化，不受影响）不在 R3 清单

## 7. 验收标准

- 两个图片节点打组：组框上边距 50px、左右下 20px
- 顶排图片往上拖不动；往下、左右可拖但不越过保留区
- 打组后点击组内图片：悬浮工具条出现在图片正上方
- 打组后组内文本/标注/裁切/旋转模式工具条位置均正确
- 组内图片进入扩图模式：选区悬浮层位置正确
- 解组后：所有悬浮层位置正常，节点恢复绝对坐标
- `pnpm --filter web test`（相关用例）全绿；TypeScript strict 编译通过
