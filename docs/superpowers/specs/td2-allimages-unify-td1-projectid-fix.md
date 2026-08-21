# Spec: TD-2 allImages 双轨统一（根级）+ TD-1 projectId 硬编码修复

日期：2026-08-21（rev3，rev2 基础上补 F1/F2/S1 事实核查结果）
状态：待确认
来源：tech-debt.md 第一批（用户可见 bug），台账 TD-1、TD-2

## 问题清单

### TD-2：`allImages` 双轨数据形状（已浏览器复现实锤）

**背景**：prompt 图片数组 `allImages` 历史上嵌套在 `data.prompt.allImages`，后迁移到根级 `data.allImages`（nodeStore.updatePromptImages 只写根级，nodeStore.ts:593 注释 "root-level shared field"）。image 节点链路读取方已迁移，**video 链路及公共 hook 未迁移**。

**写入方（根级，正确）**：`nodeStore.updatePromptImages`（nodeStore.ts:581）

**全量扫描结果**（rev2，`prompt\??\.allImages` 全库扫描）：运行时读取路径**有且仅有 3 个文件**（其余命中均为测试 mock）：

| # | 位置 | 症状 |
|---|------|------|
| 坏读 1 | `useImageUpload.ts:15` `getLatestAllImages` | 永远返回 `[]` |
| 坏读 2 | `VideoConfigPanel.tsx` 51/210/213/249/252/256/260/270 | 永远是 `[]` |
| 坏读 3 | `nodeStore.ts:462` deleteNode 的 deleteRefs | 永远是 `[]` |

**已复现症状**（2026-08-21，浏览器实测）及根因映射（rev2 补齐）：

| 症状 | 根因读取方 | 被哪个 Fix 覆盖 |
|---|---|---|
| 1. 视频节点上传后缩略图栏空白（数据在根级 `rootAllImages:1`，UI 读嵌套 0） | 坏读 2 | A-2 |
| 2. 删除节点零 DELETE 请求 → MinIO 孤儿文件（image 节点同受影响） | 坏读 3 | A-3 |
| 3. 视频节点连续按钮上传互相覆盖（第一张被挤掉） | 坏读 1（onChange 前的 latest 读嵌套空）+ 坏读 2（images 闭包为嵌套空） | A-1 + A-2 |
| 4a. 视频节点粘贴上传不受 9 张上限约束 | `VideoConfigPanel.tsx:210` handlePasteImage 读嵌套 | A-2 |
| 4b. 图片删除按钮对根级数据无效（image 节点删任意图 → 根级全清空） | 坏读 1（deleteImage 调 getLatestAllImages） | A-1 |
| 4c. image 节点粘贴上传后根级被 `updatePromptImages([])` 清空 | 坏读 1（progress 回调 + realItem 替换读嵌套空） | A-1 |

**非读取路径判定（不改，rev2 确认）**：
- `VideoConfigPanel.tsx:185` currentPrompt：仅展开写回 prompt（text 更新），不读 allImages
- `VideoConfigPanel.tsx:51` prompt 变量：text/html 仍被 PromptInput value 和 177 行 latestText 使用，**保留**；仅 allImages 部分改用根级变量
- `ImageConfigPanel.tsx:133/135`、`ImageExtConfigPanel.tsx:179/181`：构造 PromptValue 时塞根级 allImages 的兼容代码，非嵌套读取

### TD-1：projectId 硬编码 —— 实际 15 处（台账记载 5 处，rev2 全量扫描修正）

**rev2 重大发现**：除台账 5 处 `projectId: 'default'` 外，5 个 ConfigPanel 各有 2 处 **位置参数形式** `syncNodes('default', ...)` / `syncEdges('default', ...)`（原扫描模式未覆盖）。

**全部 15 处清单**：

| 位置 | 形式 |
|---|---|
| `imageNodeApi.ts:22`、`imageExtNodeApi.ts:31` | `projectId: 'default'`（API 构建函数） |
| `AudioConfigPanel.tsx:159/160/162`、`TextConfigPanel.tsx:160/161/163`、`VideoConfigPanel.tsx:197/198/200`、`ImageConfigPanel.tsx:89/90`、`ImageExtConfigPanel.tsx:136/137` | syncNodes/syncEdges('default') + 部分含 enqueueWorkflow |

注：ImageConfigPanel/ImageExtConfigPanel 的 enqueue 走 imageNodeApi/imageExtNodeApi（上表前两行）；Audio/Text/Video 的 ConfigPanel 直接调 enqueueWorkflow。

**实测严重性升级（rev2）**：
- DB 无 `default` 项目（GET /api/projects/default → not found）
- Prisma schema CanvasNode.projectId 有 **FK 约束**（schema.prisma:176）
- 实测：`PUT /api/projects/default/nodes` 空节点数组 → 200（deleteMany 0 行 + 短路返回）；**带节点 → 500（createMany FK 失败）**
- 推论链：带节点的画布上，5 种节点点"生成" → `Promise.all([syncNodes('default'),...])` reject → catch → setStatus('error') → **任务根本不入队，生成功能当前全部坏**
- 考古：硬编码自 v2.x 引入（git -S 溯源），非近期回归

## 修复设计

### Fix A（TD-2）：三处读取方统一读根级

方向：**统一到根级**（写入方已是根级，image 链路已迁移，不倒退）。

1. **A-1** `useImageUpload.ts:15`：
   `data?.prompt?.allImages ?? []` → `data?.allImages ?? []`
2. **A-2** `VideoConfigPanel.tsx`：51 行后新增 `const allImages = nodeData?.allImages ?? [];`（`VideoNodeData.allImages` 已存在，nodeStore.ts:141），210/213/249/252/256/260/270 的 `prompt.allImages` 全部替换为 `allImages`；51 行 prompt 变量保留（text/html 仍用）
3. **A-3** `nodeStore.ts:462` deleteRefs —— **合并去重（rev2 修正，弃 `??` 短路链）**：
   ```ts
   const rootImgs = imgData.allImages ?? [];
   const nestedImgs = imgData.prompt?.allImages ?? [];
   const allRefs = [...new Map([...rootImgs, ...nestedImgs].map((i) => [i.id, i])).values()];
   ```
   理由：`??` 在根级存在（哪怕空数组）时短路，历史嵌套数据永不清理；DELETE 幂等，宁可重发不可漏删（孤儿文件不可逆）。两轨写入方单轨写，同 id 重复仅理论可能，Map 去重零成本防御。
   **去重 key 确认（rev3）**：`ImageItem.id: string` 必填（nodeStore.ts:79-85），temp 项为 tempId、成功项为 fileId，稳定非空，Map 去重安全。

### Fix B（TD-1）：15 处硬编码改为真实 projectId

**读取方式（rev2 定稿，rev3 核查事实）**：

- **API 构建函数（2 处）**：`buildImageGenParams(nodeId, opts?: { projectId?: string })` / `buildImageExtGenParams` 同理，内部 `opts?.projectId ?? useCanvasStore.getState().projectId ?? 'default'`。测试可直接传参注入，无需 mock store；非画布上下文调用保留兜底。
- **ConfigPanel（13 处）**：直接用 handleGenerate 内已有的 `canvasState.projectId`，零新增依赖：
  - `syncNodes(canvasState.projectId, ...)` / `syncEdges(canvasState.projectId, ...)`
  - `enqueueWorkflow({ projectId: canvasState.projectId, nodeId })`

**F1 核查结果（rev3）**：5 个 ConfigPanel 的 handleGenerate **全部已有** `const canvasState = useCanvasStore.getState();`——AudioConfigPanel.tsx:145、ImageConfigPanel.tsx:78、ImageExtConfigPanel.tsx:125、TextConfigPanel.tsx:145、VideoConfigPanel.tsx:182，无需新增，直接引用。

**F2 核查结果（rev3）**：5 个面板**全部为结构 A**（`await Promise.all([syncNodes, syncEdges])` 完成后才 enqueue：Audio 158→162、Image 88→92、ImageExt 135→139、Text 159→163、Video 196→200）。"sync 失败 → 任务不入队 → 生成中断"推论成立。

**S1 采纳（rev3）**：ImageConfigPanel/ImageExtConfigPanel 调用 API 函数时显式传参 `buildImageGenParams(nodeId, { projectId: canvasState.projectId ?? 'default' })`——调用方已有 canvasState，与同函数内 syncNodes/syncEdges 的显式风格对齐，同一 handleGenerate 内不出现一半显式一半隐式。

**佐证**：正确模式在代码库已存在——AudioGenNode.tsx:53、ImageGenNode.tsx:337/931、VideoGenNode.tsx:352 均为 `const projectId = useCanvasStore.getState().projectId`，5 个 ConfigPanel 属漏改。

**null 兜底与竞态（rev3 确认）**：`setProjectId` 在 page.tsx:132 的 `loadProjectIntoStore().then(finish)` 异步回调执行——fetch 完成前 projectId 为 null 的窗口理论存在。但该窗口内画布节点尚未加载，无生成按钮可点，实际不可达；兜底 `?? 'default'` 使该窗口行为与现状一致（不变差）。不加 disabled/guard（不为不可达场景加代码）。

### 类型与测试同步

- `PromptValue.allImages` 类型字段**保留不动**（rev2：记入 tech-debt 台账为僵尸字段，见 O3；待测试 mock 批量迁移后移除）
- 测试 mock 数据形状同步：`useImageUpload.test.ts` makeVideoNode（allImages 移根级）、`VideoConfigPanel.test.tsx:161`（prompt.allImages → 根级）、`imageExtNodeApi.test.ts` projectId 断言

## 验证标准（rev2 扩充）

1. `pnpm test`（apps/web）全绿，含新增测试：
   - video 节点上传后 getLatestAllImages 返回根级数组（useImageUpload.test.ts）
   - **连续上传不覆盖：上传第 2 张后第 1 张仍在**（useImageUpload.test.ts 或 ImageThumbnailBar 集成）
   - VideoConfigPanel 渲染根级 allImages 的缩略图（VideoConfigPanel.test.tsx）
   - **deleteNode 对根级 allImages 发出 DELETE**（nodeStore.test.ts）
   - **deleteNode 嵌套数据兼容：仅 prompt.allImages 有值时仍发 DELETE**（B2 修正后必备）
   - buildImageGenParams 默认从 canvasStore 读 projectId、opts.projectId 注入优先（imageNodeApi.test.ts / imageExtNodeApi.test.ts）
2. 浏览器手验（复现脚本重放）：
   - 视频节点上传 1 张 → 缩略图栏显示 1 张；连续 2 张 → 2 张都在
   - 删除节点 → 网络面板出现对应 file DELETE
   - 视频节点生成 → 网络面板 `PUT /api/projects/{真实pid}/nodes` 200 + `POST /execution/enqueue` body projectId 为真实 pid；**生成流程不再中断**（TD-1 修复前带节点画布生成 500 的回归验证）
3. **原子性与残留复扫（rev3）**：TD-1 的 15 处必须同一 commit 完成（部分修复时未改面板仍 500 且错误表现一致，无法定位遗漏）；完成后 Grep 复扫 `'default'` 确认运行时代码零残留（排除测试 mock 与兜底字符串 `?? 'default'`）

## 不做什么

- 不迁移/清理 localStorage 存量脏数据（TD-8 单独评估，无生产用户）
- 不重构 PromptValue 类型、不动 image 链路已正常的读取方、不动 185 行 currentPrompt
- 不合并双 store 持久化（TD-5）、不加 schema 版本化（TD-6）、不删 isSaving 死字段（TD-3）
- 不清理 DB 中可能已存在的 default 相关孤儿数据（syncNodes createMany 全失败，理论上无写入；如存在属 TD-8 范畴）

## 台账同步项（实现完成后执行）

1. tech-debt.md：TD-1/TD-2 移入已清账（含 rev2 修正记录：15 处而非 5 处）
2. tech-debt.md 新增：`PromptValue.allImages` 僵尸类型字段（O3）——运行时已无读取方，待测试 mock 批量迁移后从类型移除
