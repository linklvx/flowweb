# 画布打组与分镜组功能 — 设计规格说明书

| 项 | 值 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-08-23 |
| 状态 | 待用户审阅 |
| 来源 | 功能文档 v1.0 评审（裁剪修订）+ brainstorming 四节设计定案 |
| 关联 | 无限画布引擎（@xyflow/react 12）、节点系统、拼接流水线 |

## 1. 背景与目标

画布节点数量增长后缺乏组织手段。本功能提供两种组：

- **普通组（Normal Group）**：任意 ≥2 个节点打包，整体拖动、整组执行、折叠、拖入/移出、解组。
- **分镜组（Storyboard Group）**：多张完成态图片合并为规整宫格，比例切换、宫格调整、序号标注、拼接导出大图。两种组类型可互相转换，数据不丢失。

### 非目标（本期不做）

- 组嵌套（禁止，见 6.1）
- 8 手柄等比缩放、双击进入组编辑模式、网格视图切换
- 批量下载 ZIP、组级保存为工作流模板（工具箱）
- 拼接大图自定义分辨率（仅 2K/4K）
- 分镜组内拖拽交换宫格位置
- 实时协作（组操作广播/分布式锁/冲突解决）
- 全局画布撤销/重做系统（仅组操作局部撤销栈）
- Playwright E2E（用 Vitest 集成测试 + 浏览器手动走查替代）
- 分镜表节点相关规则（项目中不存在该节点类型，原文档规则全部删除）

## 2. 决策记录

评审与设计过程中确认的关键决策：

| # | 决策 | 理由 |
|---|---|---|
| D1 | 撤销/重做：组操作局部撤销栈 | 全局 undo/redo 基础设施不存在，局部栈覆盖文档核心要求且成本可控 |
| D2 | 过度设计全部裁剪 | 实时协作/虚拟化/Redis 缓存/Lua 锁/Playwright 对单用户产品无收益 |
| D3 | 分镜组输入边界 = 所有含已完成图片的节点 | imageGen（done+fileId）、imageExtGen（完成态）、multiImageGen（images 有 success 项） |
| D4 | multiImageGen 合并时每张图独立成格 | 分镜场景核心用例（如 25 宫格分镜产物） |
| D5 | 架构 = 方案 A（组为特殊节点） | 零新组表、复用全量同步、符合 xyflow 官方分组惯例、避开双数据源同步风险 |
| D6 | parentId 持久化 = CanvasNode 加独立列 | 建模干净；走 `migrate dev --name add-canvas-node-parent-id`（一次性 CREATEDB 授权） |
| D7 | 拼接输出仅生成节点 + Toast，不自动下载 | 浏览器拦截非手势下载，体验不稳 |
| D8 | 增强功能纳入：拖入/移出组、折叠/展开 | 高频自然交互；其余增强全部延后 |

## 3. 数据模型

### 3.1 组节点（前端）

组是 nodes 数组中 `type: 'group'` 的节点，配置全部在 `data`：

```ts
interface GroupNodeData {
  groupType: 'normal' | 'storyboard';
  name?: string;          // 默认「分组 N 个节点」/「分镜组」
  collapsed?: boolean;    // 普通组折叠态
  cells?: string[];       // 分镜组宫格顺序（隐藏子节点 id，索引即宫格位）
  storyboard?: {          // 分镜组配置
    aspectRatio: '21:9' | '16:9' | '9:16' | '3:4' | '4:3' | '1:1';  // 默认 16:9
    gridRows: number;
    gridCols: number;
    showIndex: boolean;   // 默认 false
    stitchResolution: '2K' | '4K';  // 默认 2K
  };
}
```

### 3.2 持久化（后端）

- `CanvasNode` 表新增 `parentId String?` 列；`syncNodes` 与项目查询透传该字段。
- 组配置（`GroupNodeData`）随现有 `data Json` 字段落库，**后端不理解组结构**。
- `syncEdges` 不变（边只存 id/sourceId/targetId）。

### 3.3 hidden 推导（纯前端，不持久化）

hydrate/状态更新时按规则推导，规则单一来源：

- 节点 hidden ⇐ `parentId` 指向分镜组节点，或指向 `collapsed=true` 的普通组
- 边 hidden ⇐ source 或 target 节点 hidden

转组/解组/展开时 hidden 随推导自动消失，**连线数据永不丢失**。

### 3.4 尺寸公式

- 分镜组：`宽 = cols×320 + (cols−1)×2`；`高 = rows×(320÷ratio) + (rows−1)×2`
- 拼接输出：2K 宽 2048px / 4K 宽 3840px，高按布局比例换算
- 常量：单格宽 320px、宫格缝 2px、转普通组节点间距 40px

## 4. 普通组功能

### 4.1 创建与解组

- 入口：多选 ≥2 节点 → 顶部多选工具栏「打组」下拉 / 右键菜单 / `Ctrl+G`
- 创建：组节点 = 选中节点包围盒外扩 20px；子节点设 `parentId` + `extent:'parent'`，坐标转相对
- 解组：工具栏按钮 / `Ctrl+Shift+G`；取消 `parentId`、坐标转绝对、组节点删除、位置不变
- 选中节点含 `type:'group'` 时「打组」置灰（禁止嵌套）

### 4.2 工具栏（选中组后顶部，4 按钮）

折叠/展开 · 整组执行 · 转分镜组 · 解组

- 折叠：`collapsed=true`，组收缩为 200×64px 卡片（组名 + 节点数），子节点按 3.3 推导隐藏；展开恢复原尺寸。折叠/展开不进撤销栈
- 整组执行：语义与现有「批量执行选中节点」**完全一致**（done 态节点是否重跑由现有执行引擎决定，本 spec 不重复定义引擎逻辑）；依赖顺序由现有拓扑执行引擎处理；**外部节点不执行，上游输出可读**（复用现有输入读取机制）；执行状态沿用现有节点进程机制；执行期间分镜组宫格显示 loading 占位
- 转分镜组：仅当组内全部节点满足「含完成图片」判定（5.1）时可用，否则置灰 + Tooltip
- 空组自动解组：最后一个子节点被删除时普通组自动解组

### 4.3 拖入与移出

- 拖入：`onNodeDragStop` 检测节点中心落入组包围盒 → 设置 `parentId`、坐标转相对、组框扩展；**折叠态拖入自动展开后再入组**；拖出组框≠移出（须显式操作）
- 移出：组内单选节点 → `Shift+G` 或右键「移出组」→ 清除 `parentId`、坐标转绝对（`group.position + node.position`）

### 4.4 视觉规格

组边框 1px #4a4a4a（选中 #4ade80）、圆角 8px、背景 rgba(26,26,26,0.6)；左上角标签「分组 N 个节点」12px #999；工具栏深色胶囊 40px 高、背景 rgba(0,0,0,0.85)。

## 5. 分镜组功能

### 5.1 图片节点判定（D3 落地）

| 节点类型 | 判定条件 |
|---|---|
| imageGen / imageExtGen | `status === 'done' && fileId` |
| multiImageGen | `images` 含 `status === 'success'` 项 |

imageGen/imageExtGen/multiImageGen 合并或转入分镜组时：每个图片项（imageGen 的单图、multiImageGen 的每个 success 项）对应一个隐藏 imageGen 子节点（`data: { fileId, status: 'done' }`）；imageGen 节点本体保留仅转隐藏，multiImageGen 展开生成新节点后原节点移除（撤销栈可恢复）。

### 5.2 创建

- 入口：多选 ≥2 个符合 5.1 的节点 → 「合并分镜组」/ `Ctrl+Alt+G`（沿用快捷键面板已占用键）；选中含不符合节点时置灰 + Tooltip「分镜组仅支持含完成图片的节点」
- 智能宫格：2→1×2；3~4→2×2；5~9→3×3；10~16→4×4；17~25→5×5；>25→自定义（rows=⌈√N⌉, cols=⌈N/rows⌉）
- 排序：按 `(x, y)` 字典序（严格弱序，修正原文档 10px 容差 bug）
- 合并后：组中心对齐选中区域中心（由宫格尺寸反推组左上角 position），子节点 `parentId` 指向组 + hidden 推导生效，关联边按 3.3 推导隐藏

### 5.3 工具栏（7 按钮）

比例(6种下拉) · 宫格数量下拉 · 拼接(2K/4K) · 序号开关 · 清空 · 转普通组 · 解组

- 比例切换：所有宫格 cover 裁剪填充新比例，图片不变形，组尺寸重算
- 宫格数量：预设 2×2~5×5 + 自定义（行列各 1~10）；增加→新格为空占位（虚线框+加号）；减少→**溢出图片解组排组右侧**（水平 20px、纵向对齐组顶部）+ Toast「N 张图片已移出分镜组」；**拖入超量 multiImageGen 时同样溢出排右侧**（复用同一机制）
- 序号：左下角（画布与拼接图统一），16px/600/白色，两位补零（01、02…），按宫格索引编号
- 清空：Ant Design `Modal.confirm` 二次确认（红色危险样式），删除全部子节点及连线；清空后保留空宫格占位
- 转普通组：取消子节点 hidden，按 cells 顺序网格重排；**节点尺寸 = 宫格单格尺寸（320×比例高）**，间距 40px
- 解组：同上但组节点删除
- 删单格：点选宫格（#4ade80 高亮）→ `Delete` → 该格变空、序号重排、对应隐藏节点删除；**宫格不自动收缩**

### 5.4 右键菜单

创建副本（右侧偏移 40px）/ 删除（二次确认）/ 复制 `Ctrl+C` / 粘贴 `Ctrl+V`（鼠标位置）。

副本拷贝深度：组节点与全部子节点深拷贝并生成新 ID；图片引用复用原 fileId（**不复制 MinIO 文件**）；子节点 `parentId` 指向新组；**组内边一并复制，跨组边不复制**（与现有节点复制行为一致）；组配置（比例/宫格/序号状态）完整保留。

### 5.5 空宫格填充

点 `+` → 复用现有 `MaterialLibraryModal` 选图；或拖画布图片节点到组上落入最近空格。

### 5.6 视觉规格

容器圆角 8px、边框 1px #333（选中 #4ade80）；宫格缝 2px #1a1a1a；空占位虚线 #444 + 加号 #666；标签「分镜组 N 个节点」12px #999；序号左下 16px/600 #fff；工具栏同普通组，序号启用时按钮高亮（背景 rgba(74,222,128,0.15)、文字 #4ade80）；无缩放手柄。

## 6. 通用交互

### 6.1 嵌套禁止

组节点不可加入任何组（打组入口置灰校验；执行引擎不认识 parentId，禁止嵌套后无递归问题）。

### 6.2 快捷键汇总

| 操作 | 快捷键 | 前置条件 |
|---|---|---|
| 打组 | `Ctrl/Cmd+G` | 多选 ≥2 节点且不含组节点 |
| 合并分镜组 | `Ctrl/Cmd+Alt+G` | 多选 ≥2 个含完成图片节点 |
| 解组 | `Ctrl/Cmd+Shift+G` | 选中一个组 |
| 移出组 | `Shift+G` | 组内单选节点 |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z` | 非编辑态 |

### 6.3 局部撤销栈（groupHistory）

- **进栈操作**：打组、解组、合并分镜组、转普通组、转分镜组、清空、拖入/移出组、减格溢出、删单格、拼接完成（undo=删产物节点、redo=复用 fileId 重建节点引用，**不重新拼接**）。折叠/展开不进栈
- **数据结构（快照，非闭包）**：

```ts
interface HistoryEntry {
  label: string;
  nodeIds: string[];  // 受影响节点
  edgeIds: string[];  // 受影响边
  before: { nodes: (NodeSnapshot | null)[]; edges: (EdgeSnapshot | null)[] };
  after:  { nodes: (NodeSnapshot | null)[]; edges: (EdgeSnapshot | null)[] };
}
```

- **tombstone 定义**：快照数组中的 `null` 占位表示「该对象在此时间点不存在」。undo 恢复 before、redo 恢复 after；替换规则：非 null → 按 id 覆盖/写入 store，null → 从 store 删除该 id
- 栈上限 50 条；新操作清空 future（标准撤销行为）；会话级（不持久化）
- **编辑态定义**（Ctrl+Z 让位规则）：`activeEditNodeId !== null` ∥ `activeTransformNodeId !== null` ∥ 事件焦点在 INPUT/TEXTAREA/contentEditable。节点仅选中不算编辑态

## 7. 拼接流水线

### 7.1 API（后端不理解组，纯图片拼接服务）

```
POST /api/projects/:projectId/storyboard/stitch
body: { fileIds: string[](有序), gridRows, gridCols,
        aspectRatio, showIndex, resolution: '2K'|'4K' }
→ 202 { taskId }

GET /api/projects/:projectId/storyboard/stitch/:taskId
→ 200 { taskId, status: 'PENDING'|'COMPLETED'|'FAILED', fileId?, url?, width?, height?, failedCount?, error? }
```

认证：BetterAuth guard（与现有路由一致）。

### 7.2 Worker（BullMQ 队列 `stitch`）

1. 按 fileIds 从 Media/MinIO 取图，并发 3
2. sharp 合成：每格 cover 裁剪到单格尺寸、2px 缝（#1a1a1a）、序号（SVG composite 左下角、字号随输出分辨率等比）
3. 单图宽度不足目标 → 强制 lanczos3 放大；过大 → 等比缩小
4. 输出 JPEG（质量 92）上传 MinIO（bucket `flowai`，路径 `stitch/{taskId}.jpg`）
5. 写 Media 记录（产物在素材库可见）
6. Socket.io 推项目房间 `storyboard:stitch:completed`（复用 execution gateway 房间机制或新增，plan 阶段定）

### 7.3 前端行为

- 触发：按钮拼接中禁用（防重）；首次使用 Toast「分辨率不足将强制放大，可能影响清晰度」（localStorage 记忆仅提示一次）
- 完成：画布生成 image 节点（组右侧）+ Toast「拼接完成」+ 注册撤销项
- Socket 断线：5s 轮询 taskId 兜底
- 失败：单图失败→该格灰占位（#333）继续拼 + failedCount；全部失败或 >60s 超时→FAILED + Toast（含「重试」）
- 空宫格：#333 灰占位（与失败格视觉一致），序号照常标注——输出布局与画布宫格一一对应，不因跳空错位
- 拼接期间调整宫格：允许——参数在触发时刻已快照，结果与当前配置无关

## 8. 边界与异常

| 场景 | 行为 |
|---|---|
| 组内节点被直接 Delete | cells 移除该 id / 普通组边框收缩；普通组删空→自动解组；分镜组删空→保留空宫格（与清空终态一致） |
| 组内 imageGen 重新生成 | 普通组无感；分镜组宫格实时跟随（节点在 store） |
| loading 节点合并进分镜组 | 不允许（入口只接受完成态）；组内节点重新生成时宫格显示 loading 占位 |
| 组内节点执行中 | 禁止一切结构变更（解组/清空/转换/拖入/移出/删格），仅允许折叠/展开/查看；判断依据 = canvasStore 活跃节点进程映射含组内节点 |
| 项目 hydrate | parentId 从新列读取；hidden 推导重建；组尺寸按公式重算；旧项目零影响 |

## 9. 文件结构

### 前端新增（apps/web/src）

```
pages/canvas/components/groups/
├─ GroupNode.tsx              # 组容器·按 groupType 分发
├─ NormalGroupRenderer.tsx    # 普通组（边框/标签/折叠卡片）
├─ StoryboardGroupRenderer.tsx
├─ StoryboardCell.tsx
├─ GroupToolbar.tsx
├─ MultiSelectToolbar.tsx
└─ GroupContextMenu.tsx
stores/groupHistory.ts        # 局部撤销栈（数据快照）
utils/groupLayout.ts          # 宫格/尺寸/排序纯函数
api/stitchApi.ts
hooks/useGroupKeyboard.ts
types/group.ts
```

组操作核心逻辑为 canvasStore 新增 actions（`groupNodes`/`ungroup`/`convertGroup`/`mergeStoryboard` 等），组件只做渲染与调用（与现有 `addNode`/`splitImageNode` 模式一致）。

### 后端

```
modules/storyboard/
├─ storyboard.controller.ts
├─ storyboard.service.ts
└─ stitch.consumer.ts
改动：prisma/schema.prisma（parentId 列）、project.service.ts（透传）、gateway（完成事件）
```

## 10. 测试策略（Vitest，红-绿-重构）

| 层 | 对象 | 要点 |
|---|---|---|
| 纯函数 | groupLayout.ts | calcDefaultGrid 边界（1/2/4/5/9/10/16/17/25/26）；六比例尺寸公式；2K/4K 拼接尺寸；(x,y) 字典序排序 |
| 状态层 | canvasStore 组 actions | **真实 Zustand store**：打组后 parentId/相对坐标正确、解组后坐标转绝对、转换后 hidden 推导正确、multiImageGen 展开节点生成 |
| 状态层 | groupHistory.ts | 快照 undo/redo 各操作往返一致、tombstone 替换、future 清空、50 条上限 |
| 组件层 | Testing Library | MultiSelectToolbar 置灰规则、GroupToolbar 按钮态与执行中禁令、StoryboardGroupRenderer 宫格/序号/空占位/loading 占位 |
| 后端单测 | storyboard.service | mock Prisma/BullMQ：参数校验、任务创建、taskId 状态查询 |
| 后端单元 | stitch.consumer 合成参数 | **mock sharp**：断言调用参数（单格尺寸、序号位置、图片顺序） |
| 后端集成 | stitch.consumer 真实合成 | **真实 sharp + 2×2 低分辨率 fixture**：输出文件生成、尺寸正确 |
| 契约 | stitch API | 202/400/404、状态机流转 |

浏览器集成验证（dev server 手动走查，遵循 TD-2「mock 与真实 store diff」教训）：框选打组 → 转分镜组 → 调宫格/比例 → 拼接 → Socket 收结果 → Ctrl+Z 撤销 → 解组。

## 11. 后端改动清单

1. Prisma 迁移：`CanvasNode.parentId String?`（`migrate dev --name add-canvas-node-parent-id`）
2. project.service.ts：`syncNodes`/项目查询透传 parentId
3. 新模块 storyboard/（controller + service + consumer）
4. Socket 完成事件推送（复用或新增 gateway）
5. 拼接产物写 Media 表（复用资产模块）
