<!-- doc-status: historical | verified_at: n/a -->
# Spec: 扩图功能交互重做（Win11 截图式）

## 背景

当前扩图功能使用 `OutpaintPanel`（方向按钮 + 比例滑块 + prompt 输入框），用户体验差。重做为 Win11 `Win+Shift+S` 截图式交互：L 型角点选择框拖拽调整扩图范围，直观精确。

## 核心设计决策

1. **复用现有 editMode 基础设施** — 不创建新的 `activeOutpaintNodeId`，直接用 `editMode: 'outpaint'` + `activeEditNodeId`，继承所有互斥/取消/快捷键/节点锁定逻辑。
2. **受控组件模式** — `OutpaintSelectionOverlay` 使用 `value`/`onChange` props，状态提升到 `ImageGenNode`，与 `OutpaintPanel`/`RedrawPanel` 保持一致。
3. **原位编辑** — 保持 in-place editing 模式，生成结果先更新当前节点，"保存为新变体"可选创建子节点。
4. **移除 prompt** — 扩图交互彻底去掉 prompt 输入，简化 UI。
5. **像素坐标系统** — 使用 `OutpaintRect`（相对原图左上角的像素偏移 + 扩图后总宽高），后端转换为通义万相 API 格式。

---

## Feature 1: OutpaintSelectionOverlay（替换 OutpaintPanel）

### 验收条件

1. **受控组件接口**：
   ```typescript
   interface OutpaintRect {
     x: number;      // 相对原图左上角偏移（像素，负=向外扩展）
     y: number;
     width: number;  // 扩图后总宽度
     height: number; // 扩图后总高度
   }

   interface Props {
     imageUrl: string;
     imageWidth: number;    // 原图在容器中的显示宽度
     imageHeight: number;   // 原图在容器中的显示高度
     containerWidth: number;
     containerHeight: number;
     value: OutpaintRect;
     onChange: (rect: OutpaintRect) => void;
   }
   ```

2. **默认初始值**：1.2x 居中扩图
   ```
   x = -(imageWidth * 0.1)
   y = -(imageHeight * 0.1)
   width = imageWidth * 1.2
   height = imageHeight * 1.2
   ```

3. **半透明黑色蒙层** — `rgba(0,0,0,0.8)` + `backdropFilter: blur(12px)`，原图在选择框区域内清晰可见。

4. **8 方向拖拽调整**：
   - 4 个 L 型角点（nw/ne/sw/se）：24x24px 点击区，3px 白色 L 型线条
   - 4 个边中点（n/s/e/w）：12px 高/宽的点击区，白色短线手柄
   - 选择框主体：`1px solid rgba(255,255,255,0.5)` 边框，move 光标，可拖拽移动整体位置

5. **最小尺寸限制** — 100px（`MIN_SIZE`），防止选择框坍缩。

6. **九宫格辅助线** — hover 时显示 3x3 白色半透明辅助线，`transition-opacity duration-200`。

7. **使用 `useViewport().zoom`** — 拖拽 delta 除以 zoom，保证缩放状态下拖拽跟手。

8. **`nodrag nopan` class** — 阻止 React Flow 拦截鼠标事件。

---

## Feature 2: EditToolbar 扩展（扩图模式专用）

### 验收条件

1. **新增可选 props**：
   ```typescript
   outpaintRect?: OutpaintRect;
   onOutpaintRatioChange?: (rect: OutpaintRect) => void;
   ```

2. **扩图模式位置切换** — 从节点上方移到节点下方（`viewBottomY + 16`），因选择框覆盖节点区域。

3. **比例快捷按钮**（仅扩图模式显示）：
   - 三个预设：1.2x / 1.5x / 2.0x
   - 选中态高亮（蓝底白字），非选中态灰底
   - 点击后按比例重新计算 `OutpaintRect`（以图片显示尺寸为基准居中扩图）：
     ```typescript
     newWidth = imageWidth * ratio
     newHeight = imageHeight * ratio
     newX = -(newWidth - imageWidth) / 2
     newY = -(newHeight - imageHeight) / 2
     ```

4. **积分显示**（仅扩图模式显示）：
   - `↓ N` 格式，N = `ceil(max(rect.width/imageWidth, rect.height/imageHeight))`
   - 放在比例按钮和生成按钮之间

5. **其他按钮不变** — 退出/生成/保存为新变体 按钮行为与 crop/erase/redraw 模式完全一致。

---

## Feature 3: ImageGenNode 集成变更

### 验收条件

1. **替换 OutpaintPanel → OutpaintSelectionOverlay**：
   - 移除 `outpaintState`（`OutpaintState`）state
   - 新增 `outpaintRect`（`OutpaintRect`）state，默认值为当前图片尺寸的 1.2x 居中
   - 渲染分支：`editMode === 'outpaint' && displayUrl` 时渲染 `OutpaintSelectionOverlay`

2. **handleGenerate outpaint 分支更新**：
   ```
   POST /api/image-edit/outpaint
   body: { fileId, nodeId, rect: OutpaintRect, imageWidth, imageHeight }
   ```

3. **handleEditCancel 更新**：
   - 移除 direction/scale/prompt 检测
   - 改为检测 `outpaintRect` 是否偏离默认值（1.2x 居中）

4. **EditToolbar 传参更新**：
   - 传入 `outpaintRect` 和 `onOutpaintRatioChange`

5. **移除 `OutpaintPanel` 导入和 `OutpaintState` 类型使用**

---

## Feature 4: hasEditChanges 与 EditState 更新

### 验收条件

1. **`EditState` 接口** — 替换 `direction/scale/prompt` 为 `outpaintRect`：
   ```typescript
   export interface EditState {
     cropRect?: { x: number; y: number; width: number; height: number };
     outpaintRect?: OutpaintRect;
     maskPaths?: { points: number[] }[];
   }
   ```

2. **`hasEditChanges` outpaint 分支** — 保守策略：`outpaintRect` 存在即视为有变更（因 nodeStore 不持有图片尺寸，无法判断是否偏离默认值）：
   ```typescript
   case 'outpaint':
     return editState.outpaintRect != null;
   ```

3. **`ImageGenNode.handleEditCancel` 精确判断** — 在组件内用图片实际尺寸做精确比较，避免无变更时弹出确认框：
   ```typescript
   // outpaint 模式变化检测（组件内有 baseWidth/baseHeight）
   const hasOutpaintChanges = editMode === 'outpaint' && (
     Math.abs(outpaintRect.x + baseWidth * 0.1) >= 1
     || Math.abs(outpaintRect.y + baseHeight * 0.1) >= 1
     || Math.abs(outpaintRect.width - baseWidth * 1.2) >= 1
     || Math.abs(outpaintRect.height - baseHeight * 1.2) >= 1
   );
   // 其他模式走 hasEditChanges()
   const hasChanges = editMode === 'outpaint'
     ? hasOutpaintChanges
     : hasEditChanges(editMode!, editState);
   ```

   注意：外部的 `handleEditCancel` 调用（如 `cancelRequestedAt` 监听）终会走到这个函数，所以精确判断始终生效。

---

## Feature 5: 后端 API 适配

### 验收条件

1. **Controller** — `POST /api/image-edit/outpaint` 请求体变更：
   ```
   旧: { projectId, nodeId, fileId, direction, scale, prompt? }
   新: { projectId, nodeId, fileId, rect: { x, y, width, height }, imageWidth, imageHeight }
   ```

2. **Service** — `enqueueOutpaint` 签名变更：
   ```
   旧: (projectId, nodeId, fileId, direction, scale, prompt?)
   新: (projectId, nodeId, fileId, rect, imageWidth, imageHeight)
   ```

3. **Processor** — `AiImageEditJobData` 接口变更：
   ```
   移除: direction?, scale?, prompt?
   新增: rect?: { x, y, width, height }; imageWidth?: number; imageHeight?: number
   ```

4. **ApiCallerService.callOutpainting** — 签名和实现变更：
   ```typescript
   async callOutpainting(
     imageUrl: string,
     rect: { x: number; y: number; width: number; height: number },
     imageWidth: number,
     imageHeight: number,
     onProgress?: (progress: number) => void,
   ): Promise<{ url: string }>
   ```
   内部转换：
   ```
   left  = max(0, -rect.x)
   top   = max(0, -rect.y)
   right = max(0, rect.width - imageWidth - rect.x)
   bottom = max(0, rect.height - imageHeight - rect.y)
   ```
   API body 从 `{ direction, scale }` 改为 `{ top, bottom, left, right }`，移除 `prompt`。

---

## Feature 6: 清理

### 验收条件

1. **删除 `OutpaintPanel.tsx`** — 组件不再需要
2. **删除 `OutpaintState` 类型导出** — 从 `ImageGenNode.tsx` 移除相关 import
3. **删除 `EditState` 中的 direction/scale/prompt 字段**（仅 outpaint 相关）

---

## 不变的部分

以下现有机制完全不动：
- `activeEditNodeId` / `setActiveEditNodeId` / `triggerCancelEdit` 逻辑
- `cancelRequestedAt` 监听
- Escape 键取消、Ctrl+Z 撤销快捷键
- 节点锁定（`setNodeDraggable(false)`）
- Socket.io `edit-result` / `edit-failed` 事件处理
- 积分扣减与失败重试
- `ImageNodeToolbar` 的扩图按钮（仍调用 `enterEditMode('outpaint')`）
- `CanvasView` 的 onPaneClick/onNodeClick 取消逻辑

---

## 测试计划

| 组件 | 测试点 |
|------|--------|
| OutpaintSelectionOverlay | 默认初始值、8 方向拖拽、最小尺寸限制、zoom 适配、辅助线 hover 显示 |
| EditToolbar | 扩图模式位置（下方）、比例快捷按钮、积分计算、其他模式不变 |
| nodeStore.hasEditChanges | outpaint 分支新逻辑 |
| ImageGenNode | handleGenerate 传参格式、handleEditCancel 默认值检测 |
| ApiCallerService | rect→top/bottom/left/right 转换正确性、prompt 参数移除 |
| AiImageEditController | 请求体新格式校验 |
