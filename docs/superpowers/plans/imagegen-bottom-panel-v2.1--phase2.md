# 实施计划：ImageGen 底部面板 v2.1 — Phase 2（修订版）

> 参考 Specs：`docs/superpowers/specs/imagegen-bottom-panel-v2.1.md`
> 前置：Phase 1 已完成
> 模式：TDD（RED → GREEN → REFACTOR）

---

## 目标

在 ImageConfigPanel 的 PromptInput 上方添加 **ImageThumbnailBar**。

```
ImageConfigPanel
├── 🆕 ImageThumbnailBar
│   ├── 批量上传（presigned POST + 并发限制 3 + 真实进度 + 节流 100ms）
│   ├── 拖拽排序（@dnd-kit/sortable）
│   ├── 拖拽文件上传（drop files on thumbnail bar）
│   ├── 缩略图预览（64x64 + uploading/success/error 三态 UI）
│   │   ├── uploading：百分比进度
│   │   ├── success：删除按钮
│   │   └── error：红色遮罩 + 重试图标
│   └── 点击插入 PromptInput（.focus() → insertContent）
│
├── ✅ PromptInput
└── ✅ 设置栏 + 生成按钮
```

---

## 新增依赖

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
pnpm add image-conversion
```

---

## Step 1：store 扩展（强制）

### updatePromptImages 便捷方法

**直接嵌套更新 `prompt` 会覆盖 `text`/`referencedImageIds`，必须用专用方法：**

```typescript
// nodeStore.ts 强制添加
updatePromptImages: (nodeId: string, allImages: ImageItem[]) => {
  set((state) => {
    const node = state.nodes[nodeId];
    if (!node || node.type !== 'image') return state;  // 类型守卫
    return {
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...node,
          data: {
            ...node.data,
            prompt: { ...node.data.prompt, allImages },
          },
        },
      },
    };
  });
},
```

---

## Step 2：useImageUpload hook（新建，TDD）

### RED — 测试

**文件**：`.../prompt-input/useImageUpload.test.ts`

```
测试用例：
1.  uploadSingleImage — 成功上传后返回 ImageItem（status='success'）
2.  uploadSingleImage — 上传过程中实时更新 progress（节流 100ms）
3.  uploadSingleImage — 上传失败后清理临时 URL，标记 error
4.  uploadSingleImage — >2MB 图片自动压缩（image-conversion）
5.  uploadSingleImage — nodeId 不存在时返回 null，不抛错
6.  uploadBatchImages — 并发限制 3
7.  uploadBatchImages — 超出 maxCount 时自动截断
8.  uploadBatchImages — 单个失败不中断其他上传
9.  deleteImage — 调用 confirm API 删除 + 从 store 移除
10. 类型守卫 — 非 image 类型节点返回 null
```

### GREEN — 实现

**文件**：`.../prompt-input/useImageUpload.ts`

```typescript
import { compressAccurately } from 'image-conversion';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { useNodeStore } from '@/stores/nodeStore';
import axios from 'axios';
import type { ImageItem } from './types';

export function useImageUpload(nodeId: string) {
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const allImages = (node?.type === 'image' ? node.data.prompt.allImages : []) as ImageItem[];
  const updatePromptImages = useNodeStore((s) => s.updatePromptImages);

  const uploadSingleImage = async (
    file: File,
    onProgress?: (p: number) => void
  ): Promise<ImageItem | null> => {
    // 类型守卫
    if (!node || node.type !== 'image') return null;

    // >2MB 自动压缩
    let processedFile = file;
    if (file.size > 2 * 1024 * 1024) {
      processedFile = await compressAccurately(file, 2 * 1024 * 1024);
    }

    // 创建临时项
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const tempUrl = URL.createObjectURL(processedFile);
    const tempItem: ImageItem = {
      id: tempId, url: tempUrl, name: file.name,
      status: 'uploading', progress: 0,
    };

    // 加入 store（用于实时显示）
    const prevImages = useNodeStore.getState().nodes[nodeId]?.data?.prompt?.allImages ?? [];
    updatePromptImages(nodeId, [...prevImages, tempItem]);

    try {
      // 1. presign
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: processedFile.name, fileSize: processedFile.size,
        fileType: processedFile.type, type: 'uploaded',
      });

      // 2. 上传（节流 100ms）
      let lastProgress = 0;
      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', processedFile);

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (!e.total) return;
          const p = Math.round((e.loaded / e.total) * 100);
          if (p - lastProgress >= 10) {  // 节流：每 10% 更新
            lastProgress = p;
            onProgress?.(p);
            // 更新 store 中进度（直接从 store 读取最新数据）
            const imgs = useNodeStore.getState().nodes[nodeId]?.data?.prompt?.allImages ?? [];
            updatePromptImages(nodeId,
              imgs.map((img: ImageItem) =>
                img.id === tempId ? { ...img, progress: p } : img
              )
            );
          }
        },
      });

      // 3. confirm
      await confirmUpload({ fileId, key, fileSize: processedFile.size });

      // 替换为真实项 — url 使用 MinIO 真实路径，非临时 blob URL
      const realItem: ImageItem = {
        id: fileId,
        url: `/api/storage/files/${fileId}`,  // MinIO 真实 URL
        name: file.name,
        status: 'success',
        progress: 100,
      };
      const imgs = useNodeStore.getState().nodes[nodeId]?.data?.prompt?.allImages ?? [];
      updatePromptImages(nodeId,
        imgs.map((img: ImageItem) =>
          img.id === tempId ? realItem : img
        )
      );

      return realItem;
    } catch {
      // 单个失败不抛错，标记 error
      const imgs = useNodeStore.getState().nodes[nodeId]?.data?.prompt?.allImages ?? [];
      updatePromptImages(nodeId,
        imgs.map((img: ImageItem) =>
          img.id === tempId ? { ...img, status: 'error' } : img
        )
      );
      return null;
    } finally {
      URL.revokeObjectURL(tempUrl);
    }
  };

  const uploadBatchImages = async (files: File[], maxCount = 9): Promise<ImageItem[]> => {
    const remaining = maxCount - allImages.length;
    const toUpload = files.slice(0, remaining);
    const results: ImageItem[] = [];

    // 并发 3
    for (let i = 0; i < toUpload.length; i += 3) {
      const batch = toUpload.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map((f) => uploadSingleImage(f)));
      results.push(...batchResults.filter(Boolean) as ImageItem[]);
    }
    return results;
  };

  const deleteImage = async (imageId: string) => {
    updatePromptImages(nodeId, allImages.filter((img) => img.id !== imageId));
    try { await fetch(`/api/storage/files/${imageId}`, { method: 'DELETE' }); } catch {}
  };

  return { uploadSingleImage, uploadBatchImages, deleteImage };
}
```

### 进度节流策略

`onUploadProgress` 中仅当进度变化 ≥ 10% 时才更新 store，100ms 间隔太短无意义，用增量阈值替代。

---

## Step 3：SortableImageItem 组件（新建，TDD）

### RED — 测试

**文件**：`.../prompt-input/SortableImageItem.test.tsx`

```
测试用例：
1.  renders thumbnail img with src=image.url
2.  uploading state shows progress percentage
3.  success state shows delete button
4.  error state shows red overlay + retry icon
5.  onClick calls onImageClick(imageId) (only when status='success')
6.  delete button click calls onDelete(imageId)
7.  dragging disables click and delete (events stoppedPropagation)
8.  does not call onClick when status is 'uploading' or 'error'
```

### GREEN — 实现

**文件**：`.../prompt-input/SortableImageItem.tsx`

- `useSortable` + `CSS.Transform.toString(transform)`
- 三态 UI：
  - **uploading**：半透明黑色遮罩 + 百分比（如 "67%"）
  - **success**：右上角红色 × 删除按钮，左下角蓝色编辑按钮（Phase 3）
  - **error**：红色半透明遮罩 + 重试图标 🔄
- `isDragging` 时禁用 click/delete
- 类型守卫：`onClick` 仅在 `status === 'success'` 时触发

---

## Step 4：ImageThumbnailBar 组件（新建，TDD）

### RED — 测试

**文件**：`.../prompt-input/ImageThumbnailBar.test.tsx`

```
测试用例：
1.  renders all image thumbnails (SortableImageItem)
2.  shows upload + button when images.length < maxCount
3.  hides upload button when images.length >= maxCount
4.  drag-and-drop file triggers uploadBatchImages
5.  dragEnd sorts images and calls onChange with new order
6.  onChange receives correctly ordered ImageItem[]
7.  upload complete calls onImageUploaded(imageId)
8.  disabled prop disables all interactions
```

### GREEN — 实现

**文件**：`.../prompt-input/ImageThumbnailBar.tsx`

```tsx
interface ImageThumbnailBarProps {
  nodeId: string;
  images: ImageItem[];
  onChange: (images: ImageItem[]) => void;
  onImageClick: (imageId: string) => void;
  onImageUploaded: (imageId: string) => void;
  maxCount?: number;   // default 9
  disabled?: boolean;
}
```

- `DndContext` + `SortableContext`（`horizontalListSortingStrategy`）
- `useSensors(PointerSensor({ activationConstraint: { distance: 5 } }), KeyboardSensor)`
- 拖拽文件上传区域：`onDragOver`（必须 `preventDefault` + `stopPropagation` 防止浏览器打开文件）+ `onDrop` → `uploadBatchImages(files)`
- 隐藏 `<input type="file" multiple accept="image/*">`，点击 + 号触发
- `handleDragEnd` → `arrayMove(images, oldIdx, newIdx)` → `onChange`
- 上传复用现有 presigned POST 流程

---

## Step 5：PromptInput 扩展 insertImage

### PromptInputRef 新增

```typescript
export interface PromptInputRef {
  forceSync: () => void;
  focus: () => void;
  clear: () => void;
  insertImage: (imageId: string) => void;  // 🆕
}
```

### 实现

```typescript
insertImage: (imageId: string) => {
  // 先 focus 确保插入到光标位置，兼容即梦交互
  editor?.chain().focus().insertContent({
    type: 'image',
    attrs: { id: imageId },
  }).run();
},
```

---

## Step 6：ImageConfigPanel 集成

```tsx
// ImageConfigPanel.tsx 新增
const promptRef = useRef<PromptInputRef>(null);
const { uploadSingleImage, uploadBatchImages } = useImageUpload(nodeId);

// 类型守卫
const node = useNodeStore((s) => s.nodes[nodeId]);
if (!node || node.type !== 'image') return null;

const prompt = node.data.prompt;

// 粘贴图片处理（无缝兼容历史粘贴功能）
const handlePasteImage = (file: File) => uploadSingleImage(file);

<ImageThumbnailBar
  nodeId={nodeId}
  images={prompt.allImages}
  onChange={(allImages) => updatePromptImages(nodeId, allImages)}
  onImageClick={(imageId) => promptRef.current?.insertImage(imageId)}
  onImageUploaded={(imageId) => promptRef.current?.insertImage(imageId)}
  disabled={status === 'loading'}
/>

<PromptInput
  ref={promptRef}
  nodeId={nodeId}
  ...
/>
```

---

## Step 7：CSS

**文件**：`PromptInput.css`（追加）

```css
/* 缩略图栏 — 横向滚动 + 隐藏滚动条 */
.thumbnail-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;          /* Firefox */
}
.thumbnail-bar::-webkit-scrollbar { display: none; }  /* Chrome/Safari */

/* 单个缩略图 */
.thumbnail-item {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
  border: 1px solid #2A2A34;
  cursor: pointer;
}

.thumbnail-item--uploading {
  opacity: 0.6;
}
.thumbnail-item--error {
  border-color: #ef4444;
}

/* 上传进度覆盖层 */
.thumbnail-progress {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
}

/* 错误覆盖层 */
.thumbnail-error {
  position: absolute;
  inset: 0;
  background: rgba(239, 68, 68, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 删除按钮 */
.thumbnail-delete {
  position: absolute;
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 上传按钮 */
.thumbnail-add {
  width: 64px;
  height: 64px;
  border: 1px dashed #3F3F46;
  border-radius: 6px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6b7280;
  transition: border-color 0.2s;
}
.thumbnail-add:hover { border-color: #52525B; }
```

---

## 文件清单

### 新建 (6)

| 文件 | 说明 |
|------|------|
| `.../prompt-input/useImageUpload.ts` | 上传 hook（压缩 + 节流 + 容错） |
| `.../prompt-input/useImageUpload.test.ts` | 10 个测试 |
| `.../prompt-input/SortableImageItem.tsx` | 三态缩略图组件 |
| `.../prompt-input/SortableImageItem.test.tsx` | 8 个测试 |
| `.../prompt-input/ImageThumbnailBar.tsx` | 缩略图栏 |
| `.../prompt-input/ImageThumbnailBar.test.tsx` | 8 个测试 |

### 修改 (4)

| 文件 | 改动 |
|------|------|
| `stores/nodeStore.ts` | **强制**新增 `updatePromptImages` 方法 |
| `stores/nodeStore.test.ts` | 新增 `updatePromptImages` 测试 |
| `.../prompt-input/PromptInput.tsx` | 新增 `insertImage` ref 方法 |
| `nodes/ImageConfigPanel.tsx` | 集成 ImageThumbnailBar + 粘贴处理 + 类型守卫 |
| `.../prompt-input/PromptInput.css` | 追加缩略图栏样式 |

### 依赖

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
pnpm add image-conversion
```

---

## TDD 实施顺序

```
Step 1: pnpm add 依赖
Step 2: nodeStore updatePromptImages (RED → GREEN)
Step 3: useImageUpload hook (RED → GREEN → REFACTOR)
Step 4: SortableImageItem (RED → GREEN → REFACTOR)
Step 5: ImageThumbnailBar (RED → GREEN → REFACTOR)
Step 6: PromptInput insertImage 扩展 (RED → GREEN)
Step 7: ImageConfigPanel 集成 (更新测试 + 类型守卫)
Step 8: CSS + 全量回归
```

## Subagent 分配

```
Step 2 (store)     ──→ main agent (改动小)
Step 3 (useImageUpload) ──→ subagent-1 (worktree)
Step 4 (SortableImageItem) ──→ subagent-2 (worktree) [并行 Step 3]
Step 5 (ImageThumbnailBar) ──→ subagent-3 (worktree) [依赖 Step 3,4]
Step 6-8              ──→ main agent 串行
```

---

## 验证清单（追加到 Phase 1 验证之上）

- [ ] `pnpm test -- nodeStore` — updatePromptImages 测试通过
- [ ] `pnpm test -- useImageUpload` — 10 tests pass
- [ ] `pnpm test -- SortableImageItem` — 8 tests pass
- [ ] `pnpm test -- ImageThumbnailBar` — 8 tests pass
- [ ] `pnpm test -- ImageConfigPanel` — 现有 6 tests 无回归
- [ ] `pnpm test` — 全量 >224 tests 通过
- [ ] `npx tsc --noEmit` — 无新错误
