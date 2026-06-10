# Spec: 图片节点 AI 编辑功能（剪切 / 扩图 / 擦除 / 重绘）

## 背景

ImageNodeToolbar 已预留裁切/扩图/擦除/重绘四个按钮，但均为 no-op。本次实现四个功能的完整交互链路。

与旋转镜像不同（创建子节点→变换→保存），这四个功能采用**原位编辑模式**：在当前节点内切换编辑态，保存时替换原图。仅在用户主动"保存为新变体"时才创建子节点。

---

## 核心设计决策

1. **原位编辑，非子节点模式** — 与旋转镜像的"创建子节点"模式不同，编辑在当前节点内完成。原因：裁剪/擦除是快速操作，创建子节点会让画布膨胀。
2. **保存替换原图，可选"保存为新变体"** — 默认保存替换当前节点的图片（保留历史），可选创建新子节点作为变体保留原图。
3. **纯前端裁剪，AI 扩图/擦除/重绘** — 裁剪无需后端 AI，前端 Canvas 直接处理。其余三个功能接通义万相 API。
4. **不引入 react-konva** — 裁剪用 DOM 选区框，画笔用原生 Canvas 2D overlay。
5. **单队列 `ai-image-edit`** — 用 `taskType` 区分扩图/擦除/重绘，一个 BullMQ 队列统一调度。
6. **先接通义万相** — 一个服务覆盖扩图、擦除、重绘三个功能，后续再扩展其他模型。

---

## Feature 1: 编辑模式基础设施

### 验收条件

1. **ImageNodeData 新增字段**：
   - `editMode: 'crop' | 'outpaint' | 'erase' | 'redraw' | null`（默认 null）

2. **nodeStore 新增**：
   - `activeEditNodeId: string | null` — 当前处于编辑模式的节点 ID，与 `activeTransformNodeId` 互斥
   - `setActiveEditNodeId(id: string | null)` — 设置编辑节点，若已有 activeTransformNodeId 则拒绝（反之亦然）
   - 复用 `cancelRequestedAt` / `triggerCancelTransform` 机制（改名为更通用的 `triggerCancelEdit`）

3. **互斥规则**：
   - 同一时间只有一个节点处于编辑模式
   - `activeEditNodeId` 和 `activeTransformNodeId` 互斥（同时只有一个非 null）
   - 进入编辑模式前检查是否有活跃的 transform 节点，有则先触发取消
   - 进入 transform 模式前检查是否有活跃的编辑节点，有则先触发取消

4. **ImageNodeToolbar 按钮接线**：
   - "裁切" → 设置 `editMode = 'crop'`，`activeEditNodeId = nodeId`
   - "扩图" → 设置 `editMode = 'outpaint'`，`activeEditNodeId = nodeId`
   - "擦除" → 设置 `editMode = 'erase'`，`activeEditNodeId = nodeId`
   - "重绘" → 设置 `editMode = 'redraw'`，`activeEditNodeId = nodeId`

5. **toolbar 切换**：当 `editMode !== null` 时，ImageGenNode 渲染 EditToolbar 替代 ImageNodeToolbar（类似 transformMode 时渲染 TransformToolbar）

6. **退出编辑模式 — 变更判断逻辑**（所有四个功能共用）：

   退出时判断是否有未保存变更，各模式标准如下：

   ```typescript
   const hasEditChanges = (editMode: string, editState: EditState): boolean => {
     switch (editMode) {
       case 'crop':
         // 裁剪框不是初始的 80% 居中区域
         return !isDefaultCropRect(editState.cropRect);
       case 'outpaint':
         // 方向不是默认值 或 比例不是 1.2x 或 输入了提示词
         return editState.direction !== 'all'
           || editState.scale !== 1.2
           || (editState.prompt ?? '').trim().length > 0;
       case 'erase':
       case 'redraw':
         // 有绘制的遮罩路径
         return (editState.maskPaths?.length ?? 0) > 0;
       default:
         return false;
     }
   };
   ```

   - 无变更 → 直接退出编辑模式（`editMode = null`, `activeEditNodeId = null`）
   - 有变更 → 弹出 ConfirmModal（标题："放弃未保存的编辑？"，内容："当前编辑尚未保存，请选择如何处理。"）
     - 取消 → 关闭弹窗，继续编辑
     - 放弃并退出 → 清空 editState，`editMode = null`，`activeEditNodeId = null`
     - 保留节点（仅裁剪） → `editMode = null`，保留当前图片不变

7. **退出触发**：
   - 点击 EditToolbar "退出"按钮
   - 按 Escape 键
   - 外部触发 `triggerCancelEdit()`

8. **编辑模式节点锁定（可选优化）**：
   - 进入编辑模式时，临时禁用节点拖拽，避免画笔绘制或裁切框拖拽时误移动节点
   - 注意：`draggable` 是 React Flow 内置节点属性（不是 ImageNodeData 字段），需通过 `useCanvasStore` 更新
   - 编辑 overlay 元素本身已有 `nodrag` 类 + `stopPropagation`，此优化主要覆盖 overlay 未覆盖的图片边角区域
   ```typescript
   useEffect(() => {
     if (editMode !== null) {
       canvasStore.setNodeDraggable(id, false);
     }
     return () => {
       canvasStore.setNodeDraggable(id, true);
     };
   }, [editMode, id]);
   ```

---

## Feature 2: 剪切功能（纯前端）

### 交互流程

1. 用户点击"裁切"→ 节点进入 crop 模式
2. 图片上叠加半透明遮罩 + 裁切框（8 个控制点）
3. 用户拖拽裁切框调整区域
4. 点击"保存"→ 前端 Canvas 裁剪 → 上传 → 替换原图
5. 点击"保存为新变体"→ 创建子节点 with 裁剪后图片

### 验收条件

1. **裁切框 UI**：
   - 半透明黑色遮罩覆盖图片非选中区域（`rgba(0,0,0,0.5)`）
   - 裁切框边框为白色虚线，8 个控制点（四角+四边中点），蓝色填充
   - 控制点尺寸 8x8px
   - 裁切框初始为图片的 80% 居中区域

2. **拖拽交互**：
   - 拖拽控制点调整裁切框大小（保持矩形）
   - 拖拽裁切框内部移动位置
   - 限制裁切框不超出图片边界
   - **最小裁切尺寸 50×50px**，低于此尺寸时控制点停止响应
   - `onMouseDown` 阻止事件冒泡（防止触发 XYFlow 拖拽）

3. **尺寸显示**：裁切框旁边显示当前尺寸（如 `800 × 600`），实时更新

4. **保存流程**：
   - 根据裁切框坐标 + 图片实际尺寸计算裁剪参数
   - Canvas 裁剪生成 WebP Blob（质量 0.92）
   - 复用 presignUpload → MinIO POST → confirmUpload 链路上传
   - `updateConfig(id, { fileId: newId, referenceImage: undefined, editMode: null })`
   - 自动调整节点尺寸为裁剪后图片尺寸（受 MAX_WIDTH/MAX_HEIGHT 约束）

5. **保存为新变体**：
   - 调用 `addNodeWithEdge(id)` 创建子节点
   - 子节点设置裁剪后的 fileId
   - 当前节点不变（保留原图）
   - `editMode = null`

6. **实现方式**：纯 DOM 元素（绝对定位的 div），不使用 Canvas/konva

7. **裁剪实时预览（可选优化）**：
   - 拖拽裁剪框时，通过 CSS `clip-path: inset()` 实时裁剪图片显示
   - 非选中区域仍然显示半透明遮罩
   - CSS 变量驱动：
     ```css
     .crop-preview {
       clip-path: inset(
         var(--crop-top) var(--crop-right)
         var(--crop-bottom) var(--crop-left)
       );
     }
     ```
   - 四个 CSS 变量根据裁剪框相对图片容器的位置实时计算

---

## Feature 3: 扩图功能（AI Outpainting）

### 交互流程

1. 用户点击"扩图"→ 节点进入 outpaint 模式
2. 显示原图 + 扩图预览区域（半透明灰色表示将被 AI 填充的区域）
3. 用户选择扩图方向和比例（单选方向）
4. 可选输入提示词
5. 点击"生成"→ 提交 `ai-image-edit` 队列 → 等待 AI 结果
6. 结果回传 → 替换图片

### 验收条件

1. **扩图 UI**：
   - 原图居中显示，周围是半透明灰色扩图预览区
   - 方向选择按钮：上/下/左/右/全部（5 个按钮，**单选**）
   - 比例滑块：1.1x ~ 2.0x，步长 0.1，默认 1.2x
   - 提示词输入框（可选，placeholder: "描述扩图区域的内容（可选）"）
   - "生成"按钮 + 进度指示

2. **通义万相 API 对齐**：
   - `Direction` 参数枚举：`top` / `bottom` / `left` / `right` / `all`
   - **仅支持单选方向**，不支持同时选择多个方向
   - **最大扩图比例 2.0x**，滑块上限已对齐
   - 实时预览扩图后的总尺寸（如 "原图 1024×768 → 扩图后 1228×922"）

3. **后端流程**：
   - 前端发送 `POST /api/image-edit/outpaint`，body: `{ fileId, direction, scale, prompt? }`
   - 后端创建 `ai-image-edit` 队列任务：`{ taskType: 'outpaint', fileId, direction, scale, prompt, nodeId }`
   - 调用通义万相图像扩展 API
   - 下载结果 → 上传 MinIO → 更新 Media → Socket.io 推送 `node:edit-result` 事件
   - 前端收到事件后更新节点图片

4. **状态显示**：
   - 提交后节点显示 loading 状态（复用现有 loading UI）
   - Socket.io 接收 `node:edit-result` → 更新 fileId → 退出编辑模式
   - 失败时接收 `node:edit-failed` → 显示错误信息，保留编辑状态，允许重试

5. **保存策略**：
   - AI 结果自动替换原图（不需要二次确认，因为是用户主动触发的生成）
   - 支持"保存为新变体"（生成前可选勾选）

---

## Feature 4: 擦除功能（AI Inpainting）

### 交互流程

1. 用户点击"擦除"→ 节点进入 erase 模式
2. 图片上叠加 Canvas 2D 层用于画笔绘制
3. 用户用画笔涂抹需要擦除的区域（红色半透明显示）
4. 可调整画笔大小
5. 点击"生成"→ 提交 AI 擦除

### 验收条件

1. **画笔 UI**：
   - Canvas 2D overlay 覆盖在图片上，尺寸与图片显示区域一致
   - 画笔默认大小 20px，圆形笔刷，红色半透明（`rgba(255,0,0,0.4)`）
   - 画笔大小调节滑块：5px ~ 100px，显示当前大小数值

2. **绘制交互**：
   - 鼠标按下开始绘制，移动绘制线条，松开停止
   - `onMouseDown` 阻止事件冒泡
   - 支持撤销上一笔（Ctrl+Z），最多撤销 20 笔
   - 清除全部按钮

3. **遮罩生成**：
   - 点击"生成"时，将 Canvas 上的红色绘制区域转为黑白遮罩图片
   - 白色 = 擦除区域，黑色 = 保留区域
   - 遮罩尺寸与原图一致（遮罩在生成时等比缩放到原图尺寸）
   - **遮罩边缘羽化**：应用 3px 高斯模糊（`ctx.filter = 'blur(3px)'`），避免 AI 结果出现明显拼接痕迹
   - 遮罩作为独立文件上传 MinIO

4. **后端流程**：
   - 前端发送 `POST /api/image-edit/erase`，body: `{ fileId, maskFileId }`
   - 后端创建 `ai-image-edit` 队列任务：`{ taskType: 'erase', fileId, maskFileId, nodeId }`
   - 调用通义万相图像修复 API（传入原图 + 遮罩）
   - 下载结果 → 上传 MinIO → Socket.io 推送

5. **空遮罩保护**：未绘制任何遮罩时，"生成"按钮 disabled

---

## Feature 5: 重绘功能（AI 局部重绘）

### 交互流程

1. 用户点击"重绘"→ 节点进入 redraw 模式
2. 用户用矩形选区或画笔选择重绘区域
3. 输入提示词描述期望的重绘内容（必填）
4. 调整重绘强度
5. 点击"生成"→ 提交 AI 重绘

### 验收条件

1. **重绘 UI**：
   - 支持两种选择模式切换：矩形选择 / 画笔选择
   - 矩形选择：拖拽绘制半透明蓝色矩形框（`rgba(59,130,246,0.3)`）
   - 画笔选择：复用 Feature 4 的画笔组件（红色半透明）
   - 提示词输入框（**必填**，placeholder: "描述你希望生成的内容"）
   - 强度滑块：0~100，默认 50，对应 AI 的 denoising_strength

2. **选区交互**：
   - 矩形模式：拖拽绘制，可调整大小和位置，最小 50×50px
   - 画笔模式：同 Feature 4 画笔交互
   - 两种模式都阻止 XYFlow 事件冒泡

3. **遮罩生成**：同 Feature 4
   - 将选区/画笔区域转为黑白遮罩
   - **应用 3px 高斯模糊边缘羽化**
   - 上传 MinIO

4. **后端流程**：
   - 前端发送 `POST /api/image-edit/redraw`，body: `{ fileId, maskFileId, prompt, strength }`
   - 后端创建 `ai-image-edit` 队列任务：`{ taskType: 'redraw', fileId, maskFileId, prompt, strength, nodeId }`
   - 调用通义万相局部重绘 API
   - 下载结果 → 上传 MinIO → Socket.io 推送

5. **未选择区域/未输入提示词保护**："生成"按钮 disabled

---

## Feature 6: EditToolbar（编辑模式统一工具栏）

### 验收条件

1. **布局**：复用 TransformToolbar 的位置计算逻辑（portal 渲染在节点上方，zIndex: 10000）

2. **按钮**：

   | 按钮 | 行为 | 适用功能 |
   |------|------|----------|
   | 退出 | 触发取消流程（有变更弹窗确认） | 全部 |
   | 撤销 | 撤销上一笔绘制 | erase, redraw(画笔模式) |
   | 清除 | 清除全部遮罩/选区 | erase, redraw |
   | 保存 | 执行保存并退出编辑模式 | crop |
   | 生成 | 提交 AI 任务 → loading 状态 → 等待结果 | outpaint, erase, redraw |
   | 保存为新变体 | 创建子节点保存结果（保留原图） | 全部 |

3. **按钮可见性**：根据当前 editMode 显示对应按钮
4. **loading / 错误状态**：
   - AI 功能（outpaint/erase/redraw）：提交后"生成"按钮 disabled + 显示"生成中..."
   - 裁剪（crop）：保存时显示"保存中..."
   - 错误信息在工具栏下方显示（复用 TransformToolbar 的 errorMessage 样式）
5. **键盘快捷键**（仅当前节点是 activeEditNode 时生效，不在 input/textarea 内触发）：
   - Escape → 触发取消
   - Ctrl+Z → 撤销（erase/redraw 画笔模式）
   - Ctrl+S → 保存（crop 模式）/ 无操作（AI 模式用"生成"按钮触发）

---

## Feature 7: 后端 AI 队列与服务

### 验收条件

1. **BullMQ 队列**：新增 `ai-image-edit` 队列（常量 `AI_IMAGE_EDIT_QUEUE_NAME`）

2. **Job 类型**：
   ```typescript
   type AiImageEditJobData = {
     taskType: 'outpaint' | 'erase' | 'redraw';
     userId: string;
     projectId: string;
     nodeId: string;
     fileId: string;
     maskFileId?: string;
     direction?: string;     // outpaint: 'top' | 'bottom' | 'left' | 'right' | 'all'
     scale?: number;         // outpaint: 1.1 ~ 2.0
     prompt?: string;        // outpaint/redraw
     strength?: number;      // redraw: 0 ~ 100
   };
   ```

3. **ApiCallerService 新增方法** — 通义万相三个 API 调用：
   - `callOutpainting(imageUrl, direction, scale, prompt?)` → `{ url }`
   - `callErase(imageUrl, maskUrl)` → `{ url }`
   - `callRedraw(imageUrl, maskUrl, prompt, strength)` → `{ url }`

4. **Processor 流程与 Credit 管理**：
   ```typescript
   async process(job: Job<AiImageEditJobData>) {
     const { taskType, userId, nodeId, fileId } = job.data;

     try {
       // 1. 获取原图 URL（和遮罩 URL 如有）
       const imageUrl = await getPresignedUrl(fileId);
       const maskUrl = job.data.maskFileId
         ? await getPresignedUrl(job.data.maskFileId)
         : undefined;

       // 2. 调用对应 AI API
       const result = await this.callAIAPI(taskType, { imageUrl, maskUrl, ...job.data });

       // 3. 下载结果 → 上传 MinIO → 创建 Media 记录
       const newFileId = await this.downloadAndUpload(result.url, userId);

       // 4. 成功后扣减 Credit
       await creditService.deduct(userId, CREDIT_COST_PER_EDIT);

       // 5. Socket.io 推送成功事件
       this.socketService.emitToUser(userId, 'node:edit-result', {
         nodeId,
         fileId: newFileId,
         taskType,
       });

     } catch (err) {
       // 失败不扣减 Credit
       logger.error(`AI 编辑任务失败: ${err.message}`, {
         jobId: job.id,
         taskType,
         nodeId,
       });

       // Socket.io 推送失败事件
       this.socketService.emitToUser(userId, 'node:edit-failed', {
         nodeId,
         taskType,
         error: err.message,
       });

       throw err; // 触发 BullMQ 重试（最多 3 次，指数退避）
     }
   }
   ```

5. **Socket.io 事件**：
   - `node:edit-result`：`{ nodeId, fileId, taskType }` — 编辑成功
   - `node:edit-failed`：`{ nodeId, taskType, error }` — 编辑失败

6. **API 端点**（前端调用）：
   - `POST /api/image-edit/outpaint`
   - `POST /api/image-edit/erase`
   - `POST /api/image-edit/redraw`
   - 统一返回：`{ jobId: string }`

7. **ImageGenNode 前端监听**：
   - 在 Socket.io 的 `node:edit-result` 事件中检查 `data.nodeId === id` → 更新 fileId → 退出编辑模式
   - 在 `node:edit-failed` 事件中检查 `data.nodeId === id` → 显示错误 → 保留编辑状态

---

## 统一编辑生命周期

```
用户点击功能按钮
  → 检查互斥状态（activeTransformNodeId / activeEditNodeId）
  → 有活跃状态：触发取消流程 → 处理旧节点
  → 设置 editMode 和 activeEditNodeId
  → 显示对应编辑层和 EditToolbar
  → 用户操作生成 editState

  → 保存/生成：
     → 裁剪：前端 Canvas 处理 → 上传 → updateConfig → 退出编辑
     → AI 功能：提交队列 → loading → Socket 推送 edit-result/edit-failed → 更新/错误

  → 退出：hasEditChanges() 判断 → 无变更直接退出 / 有变更弹窗确认
```

---

## 影响的文件

| 文件 | 变更 |
|------|------|
| `nodeStore.ts` | 新增 `editMode` 字段到 ImageNodeData、`activeEditNodeId`、`setActiveEditNodeId`、`triggerCancelEdit`、`hasEditChanges` |
| `ImageGenNode.tsx` | 新增 editMode 分支渲染、CropOverlay/EraseCanvas/OutpaintPanel/RedrawPanel、Socket.io 监听 edit-result/edit-failed |
| `ImageNodeToolbar.tsx` | 裁切/扩图/擦除/重绘按钮接线 |
| `EditToolbar.tsx`（新增） | 编辑模式统一工具栏，根据 editMode 显示不同按钮组合 |
| `CropOverlay.tsx`（新增） | DOM 裁切框组件（半透明遮罩 + 8 控制点 + 最小 50×50 限制） |
| `EraseCanvas.tsx`（新增） | Canvas 2D 画笔组件（擦除和重绘共用，支持撤销/清除，遮罩生成含 3px 羽化） |
| `OutpaintPanel.tsx`（新增） | 扩图方向选择（单选）+ 比例滑块 + 提示词 |
| `RedrawPanel.tsx`（新增） | 矩形/画笔模式切换 + 提示词 + 强度滑块 |
| `apps/api/.../ai-image-edit/`（新增） | 队列定义、processor、controller、service |
| `apps/api/.../api-caller.service.ts` | 新增通义万相三个 API 方法 |
| 各测试文件 | TDD 新增测试 |

---

## 不在本次范围

- 撤销/重做系统（全局 undo/redo 栈）
- 多模型切换（通义万相以外的 AI 服务商）
- 批量编辑
- 遮罩保存/复用
- 编辑历史面板
- 扩图高级参数（如保持原图内容一致性强度）
- 负提示词输入

---

## 关键设计决策摘要

1. **原位编辑** — 不创建子节点，编辑在当前节点完成。保存替换原图。可选"保存为新变体"创建子节点。
2. **纯 DOM 裁剪** — 不用 Canvas/konva，CSS 定位 div 实现裁切框。最小裁切尺寸 50×50px。
3. **原生 Canvas 2D 画笔** — 不用 react-konva，一个 canvas 元素 overlay 在图片上。遮罩生成含 3px 羽化。
4. **单 AI 队列** — `ai-image-edit` 一个队列，taskType 区分功能。
5. **先接通义万相** — 一个服务商覆盖扩图/擦除/重绘。方向单选，最大 2.0x。
6. **Credit 后扣** — AI 调用成功后才扣减，失败不扣 + 触发 BullMQ 重试。
7. **复用上传链路** — presignUpload → MinIO POST → confirmUpload，与旋转镜像完全一致。
8. **复用互斥/取消/快捷键机制** — activeEditNodeId 与 activeTransformNodeId 互斥，EditToolbar 位置计算复用 TransformToolbar 逻辑。
9. **变更判断显式化** — 每个模式有明确的 `hasEditChanges` 标准。
10. **Socket.io 双事件** — `node:edit-result`（成功）+ `node:edit-failed`（失败），前端分别处理。
