# Spec: 打组与分镜组 Bug 修复（5 项报告 + 1 项连带）

日期：2026-08-23（v3，两轮架构审查意见已逐条实测验证吸收）
状态：待确认

## 背景

用户报告打组与转分镜组 5 个 Bug；调查中实测确认修复 Bug B/C 后"刷新后组关系丢失"会被立即感知，且其根源与报告 Bug 同源（parentId 链路），作为 Fix 4 一并修复（需用户确认范围）。

| Bug | 现象 | 根源 |
|-----|------|------|
| A | 框选多个图片节点，每个节点上方都出现悬浮工具条 | 工具条无多选判断 |
| B | 拖动打组框，组内节点不跟随 | nodes 数组父/子顺序错误 |
| C | 点击组内图片节点，节点位置偏移跑出组外 | 同 B |
| D | 已上传图片节点框选后"合并分镜组"按钮灰色 | 双 store 数据断层 + 字段不匹配 |
| E | 打组后"转分镜组"按钮灰色 | 同 D |
| F（连带） | 刷新后组关系丢失/被抹 | 保存 payload 缺 parentId + 快照不存 parentId |

## 根源分析（实测证据）

### 根源 1：nodes 数组父前子后被破坏（Bug B + C）

- `groupNodes`（canvasStore.ts:741-748）与 `mergeStoryboard`（1094-1106）把 groupNode 追加到数组末尾。
- RF v12.10.2 `updateChildNode` 要求父节点在数组中位于子节点之前，否则忽略 parentId（浏览器 console 实测捕获大量警告）。
- parentId 失效 → 子节点按相对坐标直接渲染（实测组 position=(180,180) 而子节点 DOM 在 translate(20,20)）→ Bug C；拖组不跟随 → Bug B。
- 全部父子关系建立路径核实：

| 路径 | 顺序 | 处理 |
|------|------|------|
| groupNodes / mergeStoryboard | ✗ 组在末尾 | 修复 |
| convertGroup（→storyboard） | 继承原乱序 | 修复 |
| dropIntoGroup / addToGroup | 不重排，子节点可能在组前 | 修复 |
| groupHistory applySnapshot（undo/redo） | 快照恢复顺序不定 | 修复 |
| duplicateGroup / pasteGroupClipboard | ✓ 组在前（1430-1435） | 无需改 |
| addImageToStoryboardCell / addChildNode | ✓ append 末尾，组在前 | 无需改 |

### 根源 2：双 store 数据断层 + 图片身份字段分裂（Bug D + E + 格子/拼接）

1. **写入侧**：节点内上传（nodeStore.updateConfig）、生成完成（nodeStore.setFileResult）只写 nodeStore；canvasStore.nodes[].data 会话内恒为初始 `{}`（实测）。
2. **响应式侧**：MultiSelectToolbar 等只订阅 canvasStore → 只修判定函数不修数据流，按钮不会实时变绿（审查 P0-1，成立）。
3. **字段侧**：上传图片身份存于 `referenceImage`（纯 media fileId 字符串，实测确认），读取端只认 `data.fileId`：
   - `isImageCompletedNode`（imageNodeGuards.ts:8）→ Bug D/E
   - `GroupNode.tsx:20` cellNodes → 上传图入格后**格子无图**（StoryboardCell 靠 useMediaUrl(fileId) 取图，实测确认）
   - `StitchButton.tsx:76` fileIds 收集 → **拼接跳过上传图**
   - `mergeStoryboard` kept 节点保留 canvasStore 陈旧 data（1098-1101）→ 断层在合并后持续

### 根源 3：工具条无多选感知（Bug A）

- 5 种节点组件均有 `{selected && ...}` 渲染（grep 实测）：ImageGenNode(1051/1074/1276)、MultiImageNode(201/414)、TextInputNode(89/200)、AudioGenNode(154/287)、VideoGenNode(650/676)。
- **现有模式**：ImageGenNode.tsx:77 / TextInputNode:30 / VideoGenNode:61 已有 `isSingleSelected`（`selected && 选中数===1`，getNodes() 渲染期计算），但只用于 resize 手柄，未用于工具条。
- 选中边框经节点容器 inline style 实现（非 `{selected && }` 条件渲染），不受影响。

### 根源 4：parentId 持久化链路断裂（Bug F，实测比审查预判更复杂）

- DB 层 ✓：CanvasNode.parentId 列存在（schema.prisma:182）；syncNodes 写入且父先子后排序（project.service.ts:89-99）；findById include 全字段返回；前端 DB 加载 spread 恢复 parentId（page.tsx:62）。
- **保存 payload 断层**：5 个 ConfigPanel 生成前同步（ImageConfigPanel.tsx:80-87 等）与 canvasStore 删除同步（493-497）的 mergedNodes **不含 parentId**，而 syncNodes 是 deleteMany+createMany 全量替换 → **每次生成/配置保存都会抹掉 DB 组关系**（只有"保存项目"按钮的全量 payload 带 parentId，顺序依赖）。
- **localStorage 快照断层**：快照存 nodeStore 的 AppNode（无 parentId 字段，nodeStore.addNode 从不传）；恢复路径（useCanvasPersistence:41-53）构造节点亦不带。
- extent:'parent' 无持久化（payload 与 DB 均无）。

## 修复方案

### Fix 1：nodes 数组父前子后（Bug B + C）

- 新增 `ensureParentOrder(nodes)`（utils/nodeOrder.ts）：按原顺序拓扑输出（父 Map 索引 O(n)，防御嵌套递归）；**顺序无变化时逐 id 比较后返回原数组引用**（不用 JSON.stringify）。
- canvasStore 内新增内部辅助 `setWithParentOrder(updater)`（包装 set，对返回的 nodes 应用 ensureParentOrder），组相关 action 统一改用它：`groupNodes`、`mergeStoryboard`、`convertGroup`、`dropIntoGroup`、`addToGroup`；`groupHistory.applySnapshot`（canvasStore 外）单独调用 ensureParentOrder。不采用 zustand middleware（隐式全局行为、测试面大）。
- 防回归：单测"不变式"断言各 action 后父前子后。

### Fix 2：数据桥接 + 图片身份归一化（Bug D + E + 格子/拼接）

**2a. 写入侧桥接**：nodeStore 的 `updateConfig` 与 `setFileResult` 写完后同步写 canvasStore 对应节点 data。响应式天然正确。
- 循环依赖（canvasStore ↔ nodeStore 互 import）：桥接仅在函数体内 getState/setState（运行时访问，ESM 安全）；**Fix 2a 第一个 commit 后立即在浏览器验证 HMR**（编辑 nodeStore 相关文件热更新、观察循环依赖警告），异常则切换后备：canvasStore 侧对 nodeStore 建普通 subscribe（nodeStore 未用 subscribeWithSelector middleware，审查示例的 selector+equalityFn 写法不可用，需普通 subscribe 内自存 prev 快照 diff）。
- undo/redo：groupHistory 已双写两 store（实测确认），桥接单向不冲突。

**2b. 读取端归一化（用 `||` 不用 `??`，防御空字符串）**：
- `isImageCompletedNode`：imageGen/imageExtGen 改为 `!!(d.fileId || d.referenceImage)`。
- `GroupNode.tsx:20` cellNodes、`StitchButton.tsx:76` 收集：`data.fileId || data.referenceImage`。
- 不改节点 data 语义（referenceImage 不提升写为 fileId），保留出组后参考图语义。

### Fix 3：工具条多选时隐藏（Bug A）

- 复用现有 `isSingleSelected` 模式（不新建 hook，遵循现有风格）：ImageGenNode、MultiImageNode、TextInputNode、AudioGenNode、VideoGenNode 的工具条/按钮条件从 `{selected && ...}` 改为 `{isSingleSelected && ...}`（MultiImageNode、AudioGenNode 按现有直接计算写法补齐：`selected && getNodes().filter((n) => n.selected).length === 1`）。

## 实施顺序（依赖关系）

1. **Fix 1**（ensureParentOrder + setWithParentOrder）— Fix 4 恢复路径依赖
2. **Fix 3**（isSingleSelected 工具条隐藏）— 独立，可快速验证
3. **Fix 2a**（桥接）— **第一个 commit 后立即浏览器验证 HMR**（循环依赖关键节点），异常切后备方案
4. **Fix 2b**（读取端 `||` 归一化）— 依赖 2a 桥接后 canvasStore.data 有值
5. **Fix 4**（parentId 持久化）— 依赖 Fix 1，最后做刷新端到端验证
- **选中边框/高亮保留**（inline style 实现，不碰）；只隐藏悬浮工具条与操作按钮。

### Fix 4：parentId 持久化补全（Bug F，连带修复，已确认纳入）

1. 5 个 ConfigPanel 与 canvasStore 删除同步的 mergedNodes 补 `parentId: n.parentId ?? null`（消除生成时抹组）。已实测确认 6 处均为 `canvasState.nodes.map(...)` 同构（结构源自 canvasStore，仅 data 从 nodeStore 合并），直接补字段即可。
2. localStorage 快照增加可选 `parentMap: Record<string, string>`（nodeId→parentId，旧快照无此字段仍有效，不升版本）；useCanvasPersistence 保存时从 canvasStore 提取、恢复时回填。
3. 恢复路径统一补全（DB 加载 page.tsx:62-66 与 localStorage 恢复）：`extent: node.extent ?? 'parent'`（仅无值时补，不覆盖已有自定义值），最后应用 ensureParentOrder。

## 已知行为取舍（注明，不改）

- **undo 打组回退节点内容**：打组后在组内节点上传图片，undo 打组会连上传内容一并回退（快照式 undo 固有行为）。测试覆盖确认行为即可。

## 对两轮审查的采纳情况（v3 增量）

| 审查项 | 结论 | 依据 |
|--------|------|------|
| R2-P1-1 `??`→`\|\|` | **采纳** | 实测默认 data 无 fileId:''（mergeNodeData defaults 无该字段），但 `\|\|` 语义正确零成本，防御未来数据 |
| R2-P1-2 刷新丢失=情况 A | **采纳并扩大为 Fix 4** | 实测：DB 列✓/保存项目✓/加载✓，但 5 个 ConfigPanel + 删除同步 payload 缺 parentId（每次生成抹组）；localStorage 快照与 extent 亦缺 |
| R2-P2-1 引用判断逐 id 比较 | 采纳 | — |
| R2-P2-2 HMR 验证前置 | 采纳 | 后备方案代码修正：nodeStore 无 subscribeWithSelector，需普通 subscribe+自 diff |
| R2-P2-3 选中边框保留 | 采纳 | 实测边框走 inline style；且发现现有 isSingleSelected 模式，Fix 3 改为复用 |
| R2-P2-4 setWithParentOrder | 采纳 | — |
| R2-P2-5 undo 取舍注明 | 采纳 | 见"已知行为取舍" |
| R1 各项 | 见 v2 采纳表 | 无变化 |

## 验证标准（浏览器端到端）

1. 框选 4 个已上传图片的节点：无单节点工具条（A）；"合并分镜组"可点击（D）；合并后每个格子显示图片；拼接收集到全部 fileId。
2. 打组后拖组框：子节点跟随，相对坐标不变；console 无 "Parent node not found"（B）。
3. 点击组内节点：无位置跳变（C）。
4. 选中普通组（含上传图节点）："转分镜组"可点击（E）。
5. 单选任一节点：工具条正常；选中边框在多选时保留。
6. undo/redo 打组/解组：组结构与两 store 一致。
7. （Fix 4）打组 → 点生成 → 刷新页面：组关系完整、拖组子节点跟随；纯 localStorage 兜底路径同样恢复。

## 测试要求（TDD）

- Fix 1：`nodeOrder.test.ts`（重排/引用稳定/不变式）+ `canvasStore.groups.test.ts` 增补
- Fix 2：`nodeStore.test.ts`（桥接写 canvasStore）；`imageNodeGuards.test.ts`（`\|\|` 空字符串用例：`{fileId:'', referenceImage:'ref'}` → true 且收集 ref）；`StitchButton`/`GroupNode` 测试增补
- Fix 3：各节点组件测试增补（多选隐藏/单选显示/边框保留）
- Fix 4：`canvasSnapshot.test.ts`（parentMap 往返）；ConfigPanel payload 含 parentId 断言；page 加载恢复 parentId+extent 断言
