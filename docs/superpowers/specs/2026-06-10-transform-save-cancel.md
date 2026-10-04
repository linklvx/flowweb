<!-- doc-status: historical | verified_at: n/a -->
# Spec: 旋转与镜像 — 保存/取消/互斥/快捷键

## 背景

旋转与镜像功能的基础部分已完成（`TransformToolbar` + `addNodeWithEdge` + CSS 预览），但保存、取消、互斥控制、快捷键均未实现。本次补全剩余功能。

---

## Feature 1: 保存流程

### 验收条件

1. **保存按钮点击** → `isSaving = true`，按钮显示"保存中..."并 disabled，所有变换按钮和取消按钮同时 disabled
2. **获取图片 URL** → 从当前节点的 `displayUrl` 获取
3. **Canvas 变换** → 调用 `transformImage(url, rotation, flipH, flipV, maxSize=2048)` 生成 WebP Blob（质量 0.92）
4. **上传** → Blob 转 File（文件名 `transformed.webp`）→ `presignUpload` → 上传到 MinIO → `confirmUpload`
5. **更新状态** → `updateConfig(id, { fileId: newFileId, referenceImage: undefined, imageRotation: 0, flipH: false, flipV: false, transformMode: false })`
6. **清空互斥** → `activeTransformNodeId = null`
7. **错误处理** → 保存失败时恢复 `isSaving = false`，保留所有变换状态，按钮恢复可用，console.error 输出错误
8. **超时重试** → 上传超时 30 秒自动重试 1 次

### 技术细节

- `transformImage` 输出格式改为 `image/webp`（质量 0.92），减少存储和带宽成本
- `maxSize=2048`，超过等比缩放（已存在于现有代码）
- Canvas/Image 内存释放：已存在于现有 `transformImage.ts`
- EXIF 方向：无需处理 — 浏览器 `<img>` 渲染时已自动应用 EXIF，canvas drawImage 获取的是已修正像素

---

## Feature 2: 取消流程

### 触发场景

- 点击 TransformToolbar "退出"按钮
- 按 Escape 键
- 点击画布空白处（pane click）
- 选中其他节点
- 新节点进入 transform 模式（互斥清理旧节点）

### hasChanges 判断

```
hasChanges = imageRotation !== 0 || flipH || flipV
```

### 验收条件

**A. 无变更（hasChanges = false）**
1. 直接删除转换节点（canvasStore 删除 node + edges）
2. nodeStore.deleteNode
3. `activeTransformNodeId = null`

**B. 有变更（hasChanges = true）** → 弹出确认弹窗

弹窗内容：
- 标题："放弃未保存的更改？"
- 文案："当前变换尚未保存，请选择如何处理。"
- 三个按钮：
  | 按钮 | 样式 | 行为 |
  |------|------|------|
  | 取消 | 灰色 | 关闭弹窗，继续编辑 |
  | 保留节点 | 白色 | 仅退出 transformMode（`updateConfig(id, { transformMode: false })`），清空 activeTransformNodeId，保留原始图片数据 |
  | 放弃并删除 | 红色 | 删除转换节点及其 edges，清空 activeTransformNodeId |

---

## Feature 3: activeTransformNodeId 互斥

### 验收条件

1. **进入 transform 模式时** → `activeTransformNodeId = newNodeId`
2. **同一时间只有一个节点处于 transform 模式**
3. **新节点进入 transform 时**，检查已有 activeTransformNodeId：
   - 无旧节点 → 直接进入
   - 有旧节点且无变更 → 自动清理旧节点（删除），进入新节点
   - 有旧节点且有变更 → 弹出确认弹窗（同 Feature 2.B），用户做出选择后处理旧节点，**无论旧节点如何处理，新 transform 都正常创建**
4. **退出 transform 模式时** → `activeTransformNodeId = null`
5. **页面关闭/刷新时** → 如有未保存变更，浏览器弹出 beforeunload 原生提示

### 外部触发取消的机制

画布空白处点击或其他节点被选中时，由 CanvasView 检测，通过 nodeStore 通知 ImageGenNode 执行取消：

- CanvasView 的 `onPaneClick`：检测 `activeTransformNodeId`，若存在则调用 `triggerCancelTransform()`，**不调用** `selectNode(null)`
- CanvasView 的 `onNodeClick`：若点击的节点不是当前 transform 节点，调用 `triggerCancelTransform()`
- nodeStore 新增：
  - `cancelRequestedAt: number` — 时间戳，每次触发取消请求时更新
  - `triggerCancelTransform()` — 更新 cancelRequestedAt
- ImageGenNode：useEffect 监听 `cancelRequestedAt` 变化，值是当前节点 ID 时执行取消流程

### beforeunload 实现

```
useEffect(() => {
  if (!transformMode || !hasChanges) return;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '您有未保存的更改，确定要离开吗？';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [transformMode, hasChanges]);
```

---

## Feature 4: 键盘快捷键

### 验收条件

1. **仅在 `activeTransformNodeId !== null` 时生效**（即 transformMode 激活时）
2. **Escape**：
   - 触发取消流程
   - 不在 input/textarea/contentEditable 元素内触发
   - capture 阶段，阻止事件冒泡
3. **Ctrl+S / Cmd+S**（支持 `e.ctrlKey || e.metaKey`）：
   - 触发保存流程
   - 阻止浏览器默认行为（`e.preventDefault()`）
   - capture 阶段
4. **注册方式**：在 `ImageGenNode` 内通过 useEffect 在 document 上绑定 capture 事件

---

## 影响的文件

| 文件 | 变更 |
|------|------|
| `nodeStore.ts` | 新增：`setActiveTransformNodeId`、`cancelRequestedAt`、`triggerCancelTransform` |
| `canvasStore.ts` | 新增 `deleteTransformNode(id)` 方法（删除 node + 关联 edges + selectNode(null)） |
| `CanvasView.tsx` | onPaneClick / onNodeClick 中检测 activeTransformNodeId → triggerCancelTransform |
| `imageTransform.ts` | 输出格式改为 `image/webp`（质量 0.92），其他逻辑不变 |
| `ImageGenNode.tsx` | 实现 onSave/onCancel handler、管理 isSaving 状态、设置 activeTransformNodeId、快捷键绑定、beforeunload、监听 cancelRequestedAt |
| `TransformToolbar.tsx` | isSaving 已在 props 中，无需接口变更。isSaving 时所有按钮 + 取消按钮 disabled |
| `ConfirmModal.tsx`（新增） | Portal 渲染的三按钮确认弹窗 |
| 各测试文件 | TDD 新增测试 |

---

## 不在本次范围

- 保存进度分步提示（"正在处理图片..."→"正在上传..."）
- 保存成功后自动重命名节点（如 "原图_旋转90°"）
- 撤销/重做支持
- 批量旋转/镜像
- 旧的 AI 生成 fileId 清理

---

## 关键设计决策

1. **输出格式 WebP 0.92** — 体积约为 PNG 的 30%，所有现代浏览器支持
2. **maxSize=2048** — 已存在于 `transformImage.ts`，无需修改
3. **EXIF 无需处理** — 浏览器渲染 `<img>` 时已自动修正
4. **取消弹窗三按钮** — "取消" / "保留节点" / "放弃并删除"，给用户完整选择
5. **快捷键仅在 transformMode 时生效** — 避免与其他组件冲突
6. **beforeunload 防护** — 未保存变更时阻止意外离开
7. **互斥策略** — 新 transform 创建时处理旧 transform（有变更弹窗，无论结果新节点都创建）
8. **取消触发通信** — CanvasView 通过 `triggerCancelTransform()` → `cancelRequestedAt` → ImageGenNode 监听执行取消，避免跨组件耦合
