<!-- doc-status: historical | verified_at: n/a -->
# Spec: 空白媒体节点保存重载后尺寸缩水修复

## 背景 / Bug 现象

新建画布，添加图片节点、视频节点、扩展图片节点、堆叠图片节点（均未加载媒体，保持空白占位），保存画布后从工作空间重新打开：四类空白节点渲染为 280×120，明显小于新建时的尺寸（image/video/imageExt 548×309，multiImage 400×300），且与再新添加的同类节点长宽不一致。

有图的节点、textInput 节点不受影响。

## 根因（代码链路实证）

| # | 环节 | 位置 | 事实 |
|---|------|------|------|
| 1 | 创建 | `apps/web/src/stores/canvasStore.ts:190-200` `addNode` | 四类媒体节点不设 `node.width/height`（仅 textInput 显式 300×300） |
| 2 | 渲染 | `ImageGenNode.tsx:327-328`（VideoGenNode 同构，MultiImageNode 用 STACKED_W/H） | `nodeWidth = internalNode?.width ?? ratioDimensions(ratio)`——width 为 undefined 时组件按 ratio 动态计算占位尺寸 |
| 3 | 写回 | `ImageGenNode.tsx:299-306`、`VideoGenNode.tsx:305` | 计算尺寸**仅在媒体 onLoad 时**写回 store；空白节点永不触发 |
| 4 | 保存 | `apps/api/src/modules/project/project.service.ts:112-113` `syncNodes` | 前端 payload `width: undefined` → JSON 序列化丢弃字段 → 后端兜底 `?? 280` / `?? 120` 写库 |
| 5 | DB | `apps/api/prisma/schema.prisma:180-181` | `width Float @default(280)`、`height Float @default(120)`，**NOT NULL**，列默认值顶替 |
| 6 | 加载 | `apps/web/src/pages/canvas/page.tsx:68-69、93-94` | DB 返回 280×120（有值，前端 `?? 300` 兜底不触发）→ 节点按 280×120 渲染 |

**一句话**：空白节点的动态计算尺寸从未持久化，被 DB 列默认值 280×120 顶替；重载后组件优先使用 `internalNode.width`（280），不再走动态计算分支。

**不受影响者的原因**：
- 有图节点：onLoad 把真实尺寸写回并持久化（且重载后 onLoad 自愈双保险）
- textInput：创建时显式 300×300
- 用户 resize 过的节点：RF `dimensions` change 带 `setAttributes` 时 canvasStore 写入 nodeStore 并持久化（`canvasStore.ts:552-560`）

## 修复方向（用户已裁定：「动态尺寸，不持久化」）

**空白媒体节点的尺寸语义 = 组件按 ratio 动态决定，不持久化**（保持现状新建时的行为，包括"切比例 → 占位尺寸跟随变化"）。

对比过的备选：
- 方案 A（创建时固化 548×309/400×300）：尺寸逻辑双份维护（addNode 与组件各一份），且固化后 `internalNode.width` 优先、切比例不再跟随——行为回归，否决。
- 方案 B（组件把空白计算尺寸 useEffect 写回）：同样固化后失去 ratio 跟随，需额外在 ratio 变化时清 width，复杂且引入写回竞态，否决。

## 改动清单

### 1. Prisma schema（`apps/api/prisma/schema.prisma:180-181`）

```prisma
width     Float?   -- 去 @default(280)、改可空
height    Float?   -- 去 @default(120)、改可空
```

迁移：`prisma migrate dev --name blank-node-size-nullable`（生成 `DROP DEFAULT` + `DROP NOT NULL`）。开发库存量 280×120 数据无需处理（无用户数据，不做兼容防护）。

### 2. 后端 `syncNodes`（`project.service.ts:112-113`）

```ts
width: n.width ?? null,
height: n.height ?? null,
```

`updateDimensions`（用户 resize 持久化端点）不动。

### 3. 前端加载（`page.tsx` 两处：68-69 nodes map、93-94 nodeStore content map）

```ts
width: n.width ?? undefined,
height: n.height ?? undefined,
```

null → undefined，保持 RF `node.width` 为 undefined，组件走动态计算分支。

### 不动的部分（精准修改）

- localStorage 快照路径（`useCanvasPersistence.ts:52-53`）：已透传 undefined，天然正确
- `canvasStore.ts:543` 组夹取的 `?? 280` 兜底：与本 bug 无关
- 各 ConfigPanel / scheduleSync / deleteNode 的保存 payload：`width: nd.width` 语义在本方案（动态尺寸不持久化）下自动正确（undefined → 落库 null）
- 组节点：加载后展开组本就 refitGroupBounds 重算（P0-4），width 可空不影响

## 评审风险点核实（R1-R5，均已代码实证）

### R1：updateDimensions 端点兜底 —— 不存在，无需改
- service `updateDimensions`（project.service.ts:124-131）直接写 `{ width, height }`，无 `?? 280/120`
- 唯一 HTTP 调用方 `syncNodeDimensions`（CanvasView.tsx:164-193），值取自 RF `c.dimensions!`（必有值）
- DTO `@IsNumber() + @Min(280)`（update-node-dimensions.dto.ts:7-15）必填校验——undefined 会被 400 拒绝，不存在"undefined 写入 280"路径
- `refitGroupBounds` 是纯 store 操作，不调 HTTP 端点

**顺带发现两个既有怪点（登记，不动——精准修改）**：

a) `syncNodeDimensions` 不过滤 `setAttributes`，挂载测量尺寸也会 debounce PATCH 落库（与 store 侧 canvasStore.ts:552 只认 setAttributes 的语义不一致）。今天正是它先写真值、"保存项目"全量 PUT 再用 undefined 覆盖成 280/120（最后写者胜出）。修复后：该 PATCH 只写 DB 不写 store，下次全量保存仍归 null，语义自愈；残留风险仅为"切 ratio 后 500ms debounce 窗口内关页"的丢帧，可接受。

b) DTO `@Min(280)/@Min(120)` 与前端 MIN_WIDTH=200 不一致——resize 到 <280 时该 PATCH 400，但 setAttributes 已写 store、全量保存仍持久化，自愈。

### R2：迁移不清存量 —— 属实，按"无用户数据"策略接受
- `DROP NOT NULL/DROP DEFAULT` 不改存量行，旧画布空白节点重开仍 280×120
- **旧画布不会自愈**：重开时 width=280 有值 → 渲染 280 → 全量保存回写 280。验收时须用**新建画布**验证
- 不加 `UPDATE ... SET width=NULL` 清洗（开发测试阶段无用户数据，不做存量防护）

### R3：第三条加载路径 —— 不存在
- grep 无 fromTemplate/applyTemplate/打开模板路径（SaveAsTemplateDialog 只写不读）
- socket 仅 node:status 事件，无画布节点恢复
- 加载路径 = DB（page.tsx）+ localStorage 快照（已透传 undefined）两条
- 保存侧全部写入者（deleteNode、onNodesChange remove/move、各 ConfigPanel、scheduleSync、SaveAsTemplateDialog）统一 `width: n.width` 模式——后端收口后全部自动正确，无需逐个改

### R4：组节点 —— 不受影响
- 普通组（canvasStore.ts:845-847）、分镜组（canvasStore.ts:1173-1175）创建时显式设 `width/height`（包围盒计算），不依赖 DB 默认值
- 加载后展开组走 refitGroupBounds 按子节点重算，不依赖自身 width 初值

### R5：DTO 校验 —— syncNodes 路径无阻
- `PUT :id/nodes` 控制器签名 `@Body() body: { nodes: any[] }`（project.controller.ts:31-34），无 ValidationPipe、无 DTO，undefined 字段透传无阻
- 有校验的是 `PATCH :id/nodes/dimensions`（不在改动范围）
- 结论：无需补 `@IsOptional()`

### N1：Prisma 可空后的 null 安全扫描 —— 已扫描，无消费点
- 后端对 CanvasNode 的查询仅两处：`findById` 的 `include: { nodes: true }`（纯 JSON 序列化透传）与 `syncNodes` 返回值（透传）
- 全后端（排除 spec 测试）对 `n.width / node.width / n.height / node.height` 的引用只有 project.service.ts:112-113（本次要改的写入点）
- 无任何算术/比较消费 → 不存在 NaN 风险，无需 `?? 0` 守卫；且 strict 模式下 `number | null` 参与算术会编译报错，后续新增消费点有编译期保护

### N2：编号措辞 —— 已修正
- 「不动部分」中的"方案 C 下自动正确"已统一为"本方案（动态尺寸不持久化）"

## 验收标准

1. 新建空白 image/video/imageExt 节点（548×309）、multiImage 节点（400×300）→ 保存 → 工作空间重开 → 渲染尺寸与新建时完全一致（**须用新建画布验证**——迁移前创建的旧画布空白节点保持 280×120，见 R2）
2. 空白节点切换比例（如 16:9 → 1:1）→ 占位尺寸跟随变化（现有行为不回归）
3. 有图节点保存重载后尺寸不变；有图节点用户 resize 后重载保持用户尺寸（空白节点无 resize 手柄——image/video/imageExt 手柄条件含 `hasMedia`，空白态不出现；multiImage 无 resize 功能，已知限制）
4. textInput 节点 300×300 行为不变
5. 后端测试：syncNodes 对无 width 节点落库 null（不再兜底 280/120）
6. 前端测试：加载含 null width 节点的项目 → store 节点无 width
7. 全部现有测试保持通过

## 测试策略（TDD）

- 后端（`project.service.spec.ts`）：改造/新增 syncNodes 用例——payload 无 width/height 时断言 `canvasNode.createMany` 收到 `width: null, height: null`；有值时透传
- 前端（`page.test.tsx`）：mock `/api/projects/:id` 返回 `width: null` 的节点 → 断言 `useCanvasStore` 节点 `width === undefined`
- 浏览器手动验收：标准 1-4 的端到端场景（新画布 → 加四类空白节点 → 保存 → 重开 → 对比尺寸）
