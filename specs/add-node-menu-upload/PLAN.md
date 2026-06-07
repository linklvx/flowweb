# Plan: AddNodeMenu 上传按钮功能实现

## Spec 版本: 1.1 | 日期: 2026-06-07

---

## 实现概览

修改 `AddNodeMenu.tsx`，将「上传」按钮从"打开素材库"改为"选文件→上传→创建节点"。

**只改 1 个文件**（+ 测试文件），复用现有全部基础设施。

---

## Step 1: 编写测试（TDD Red）

**文件**: `apps/web/src/pages/canvas/components/AddNodeMenu.test.tsx`

### 新增测试用例

```typescript
// 1. 点击上传按钮触发文件选择
it('点击上传按钮弹出文件选择对话框', () => {
  // 验证 <input type="file"> 的 click() 被调用
})

// 2. 选择图片文件后执行上传流程
it('选择图片文件后调用 presignUpload 和 confirmUpload', () => {
  // 模拟文件选择 → 验证 upload chain 被调用
})

// 3. 上传成功后创建对应类型节点
it('上传图片成功后创建 ImageGenNode', () => {
  // presignUpload + confirmUpload 成功 → addNode('image', pos) 被调用
})
it('上传视频成功后创建 VideoGenNode', () => {
  // 同上，验证 addNode('video', pos)
})
it('上传音频成功后创建 AudioGenNode', () => {
  // 同上，验证 addNode('audio', pos)
})

// 4. 上传后设置正确的节点数据字段
it('上传成功后通过 updateConfig 设置文件引用', () => {
  // 图片: referenceImage, 视频: referenceVideo, 音频: referenceAudio
})

// 5. 上传失败行为
it('上传失败后输出错误且不创建节点', () => {
  // presignUpload reject → console.error → addNode 不被调用
})

// 6. 取消文件选择
it('取消文件选择后菜单保持打开', () => {
  // onChange 不触发 → 菜单状态不变
})

// 7. 上传中按钮状态
it('上传过程中按钮显示"上传中..."且不可点击', () => {
  // uploading=true → 按钮 disabled, 文字 "上传中..."
})

// 8. 现有菜单项不受影响
it('现有菜单项（文本/图片节点/视频节点等）行为不变', () => {
  // 验证这些按钮仍然调用 addNode 而非上传
})
```

### Mock 策略

```typescript
vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

// canvasStore / nodeStore 通过 vi.mock 或直接操作 store
```

---

## Step 2: 实现代码（TDD Green）

**文件**: `apps/web/src/pages/canvas/components/AddNodeMenu.tsx`

### 2.1 新增 imports

```typescript
import { useRef, useState, useCallback } from 'react';  // 已有 useRef, useCallback
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { useNodeStore } from '@/stores/nodeStore';
import axios from 'axios';
```

### 2.2 新增状态

```typescript
const [uploading, setUploading] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);
```

### 2.3 修改 handleItemClick - upload 分支

**现有代码** (第 163-166 行):
```typescript
if (item.type === 'upload') {
  materialLibraryOpen();
  onClose();
  return;
}
```

**替换为**:
```typescript
if (item.type === 'upload') {
  fileInputRef.current?.click();
  return;
}
```

### 2.4 新增文件选择处理函数

```typescript
const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return; // 用户取消选择，菜单保持打开

  setUploading(true);
  try {
    // 1. 获取预签名 URL
    const { fileId, uploadUrl, key, fields } = await presignUpload({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      type: 'uploaded',
    });

    // 2. 上传到 MinIO
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append('file', file);

    const proxyUrl = import.meta.env.DEV
      ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
      : uploadUrl;

    await axios.post(proxyUrl, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    // 3. 确认上传
    await confirmUpload({ fileId, key, fileSize: file.size });

    // 4. 确定节点类型
    const nodeType = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : null;
    if (!nodeType) throw new Error(`Unsupported file type: ${file.type}`);

    // 5. 计算视口中心位置
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;

    // 6. 创建画布节点
    const nodeId = addNode(nodeType, { x: centerX - 125, y: centerY - 30 });

    // 7. 设置文件引用到节点数据
    const refField = nodeType === 'image' ? 'referenceImage'
      : nodeType === 'video' ? 'referenceVideo'
      : 'referenceAudio';
    useNodeStore.getState().updateConfig(nodeId, { [refField]: fileId });

    // 8. 关闭菜单
    onClose();
  } catch (err: any) {
    console.error('[AddNodeMenu] upload error:', err.message);
  } finally {
    setUploading(false);
    // 清除 input，允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
}, [viewport, addNode, onClose]);
```

### 2.5 新增隐藏的 file input（JSX）

在 overlay div 内部、菜单 div 之前添加：

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*,video/*,audio/*"
  className="hidden"
  onChange={handleFileChange}
/>
```

### 2.6 修改上传按钮的 JSX

在「上传」按钮上添加 uploading 状态：

```tsx
{ADD_RESOURCE_ITEMS.map((item) => (
  <button
    key={item.label}
    type="button"
    role="menuitem"
    className={MENU_ITEM_CLASS}
    disabled={item.type === 'upload' && uploading}
    style={{
      color: 'var(--canvas-controls-text)',
      ...(item.type === 'upload' && uploading ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
    }}
    // ... mouse handlers (unchanged)
    onClick={() => handleItemClick(item)}
  >
    <div className="...">{item.icon}</div>
    <div className="...">
      <div className="...">
        <span className="text-sm font-medium leading-5">
          {item.type === 'upload' && uploading ? '上传中...' : item.label}
        </span>
        <span className="...">{item.desc}</span>
      </div>
    </div>
  </button>
))}
```

### 2.7 移除不再需要的 import

```diff
- import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';
```

`materialLibraryOpen` 不再被使用，移除对应 import。

---

## Step 3: 验证（Green → Refactor）

### 3.1 运行测试

```bash
pnpm --filter web test -- AddNodeMenu
```

### 3.2 可视化验证

```bash
# 启动项目
preview_start "api"
preview_start "web"
```

打开 `http://localhost:5173/canvas`，手动验证：
1. 点击 + → 上传 → 选择图片 → 节点出现在画布中心
2. 点击 + → 上传 → 选择视频 → 节点出现在画布中心
3. 点击 + → 上传 → 选择音频 → 节点出现在画布中心
4. 点击 + → 上传 → 取消 → 菜单保持
5. 上传过程中按钮显示 "上传中..."

### 3.3 运行全量测试确保无回归

```bash
pnpm --filter web test
```

---

## 影响范围

| 文件 | 影响 |
|------|------|
| `AddNodeMenu.tsx` | 替换 upload 分支实现，新增 ~50 行 |
| `AddNodeMenu.test.tsx` | 新增 ~8 个测试用例 |
| `materialLibraryStore.ts` | **不受影响**（仅移除 import） |

---

## 风险点

1. **uploading 状态与菜单关闭竞态**：上传中关闭菜单不会影响上传（axios 请求独立），但 `setUploading(false)` 的 `finally` 在组件卸载后调用会有 React warning。处理方式：

```typescript
// 组件顶部
const cancelledRef = useRef(false);

// useEffect cleanup（加在现有的 Escape keydown useEffect 旁边）
useEffect(() => {
  return () => {
    cancelledRef.current = true;
  };
}, []);

// handleFileChange 的 finally 块
finally {
  if (!cancelledRef.current) {
    setUploading(false);
  }
  if (fileInputRef.current) fileInputRef.current.value = '';
}
```

2. **同一文件重复选择**：`<input>` 的 `onChange` 在选择相同文件时不会触发。处理方式：在 finally 中设置 `fileInputRef.current.value = ''`。

3. **NodeStore 同步**：`canvasStore.addNode` 内部已调用 `nodeStore.addNode`，所以 `updateConfig` 可以正常更新。不存在时序问题。
