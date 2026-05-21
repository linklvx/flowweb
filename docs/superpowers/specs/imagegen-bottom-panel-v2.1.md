# 技术规格：ImageGen 底部面板 v2.1（最终版）

> 状态：待确认 | 嵌套 store + ReactFlow 同步 + 指令删除同步 + Phase 1

---

## 0. 架构决策：嵌套 Store 结构

采用 `AppNode` 模式，与 React Flow 节点模型完全对齐：

```typescript
// apps/web/src/stores/nodeStore.ts

// ========== 各节点数据类型 ==========

interface TextNodeData {
  content: string;
}

interface ImageNodeData {
  style: string;
  model: string;
  quality: string;
  ratio: string;
  fileId?: string;
  referenceImage?: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  prompt: PromptValue;
}

interface VideoNodeData {
  model: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  fileId?: string;
  // Phase 2+ 扩展
}

// ========== 通用节点类型（ReactFlow 对齐）==========

export interface AppNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  selected?: boolean;
  dragging?: boolean;
  data: TextNodeData | ImageNodeData | VideoNodeData;
}

// ========== Store 状态 ==========

interface NodeState {
  nodes: Record<string, AppNode>;

  // 核心方法
  addNode: (node: AppNode) => void;
  updateNodeData: <T>(nodeId: string, data: Partial<T>) => void;
  deleteNode: (nodeId: string) => Promise<void>;

  // 便捷方法（类型安全包装）
  updateText: (id: string, content: string) => void;
  updateConfig: (id: string, config: Partial<ImageNodeData>) => void;
  setStatus: (id: string, status: ImageNodeData['status']) => void;
  setFileResult: (id: string, fileId: string) => void;
  getNodeData: <T>(id: string) => T | undefined;
}
```

**优势**：TypeScript 自动推断类型、添加新节点类型无需改现有代码、杜绝跨类型字段访问。

---

## 1. 字段清理（直接删除，无兼容）

| 删除字段 | 替代方案 |
|----------|---------|
| `resolution` | `quality` + `ratio` |
| `extraPrompt` | `prompt.text` |
| `count` | Phase 2 按需添加 |
| `isGenerating` | 复用 `status: 'loading'` |
| `resultUrl` | 删除（统一用 `fileId` + `useMediaUrl`） |

### 最终 ImageNodeData

```typescript
interface ImageNodeData {
  style: string;                          // 默认 '写实'
  model: string;                          // 默认 'sdxl'
  quality: string;                        // 默认 'standard'
  ratio: string;                          // 默认 '1:1'
  fileId?: string;                        // 悬浮上传 / 生成结果
  referenceImage?: string;                // 悬浮上传参考图
  status: 'idle' | 'loading' | 'done' | 'error';  // 默认 'idle'
  prompt: PromptValue;                    // 默认 { text: '', allImages: [], referencedImageIds: [] }
}
```

---

## 2. 双入口架构

```
ImageGenNode
├── 🔵 悬浮上传按钮 → nodes[id].data.fileId / .referenceImage
│   用途：成品图预览  |  ✅ 保留现有逻辑不变
│
└── 🟢 底部面板 → nodes[id].data.prompt / .model / .ratio / .quality
    用途：AI 参考图 + 图文混排  |  🆕 全新实现
```

数据完全隔离，互不干扰。

---

## 3. ReactFlow 状态同步机制 🔴 核心

**关键原则**：自定义 `nodeStore` 是唯一数据源，ReactFlow 内部状态仅作为视图层。

```typescript
// apps/web/src/pages/canvas/hooks/useReactFlowSync.ts

import { useEffect } from 'react';
import { useNodesState, type NodeChange } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';

export const useReactFlowSync = () => {
  const [reactFlowNodes, setReactFlowNodes, onNodesChange] = useNodesState([]);
  const storeNodes = useNodeStore((state) => state.nodes);
  const updateNodeData = useNodeStore((state) => state.updateNodeData);
  const deleteNode = useNodeStore((state) => state.deleteNode);

  // Store → ReactFlow 单向同步（数据源 → 视图）
  useEffect(() => {
    const nodes = Object.values(storeNodes).map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
      selected: node.selected,
      dragging: node.dragging,
    }));
    setReactFlowNodes(nodes);
  }, [storeNodes, setReactFlowNodes]);

  // ReactFlow → Store 单向同步（仅系统字段）
  const handleNodesChange = (changes: NodeChange[]) => {
    onNodesChange(changes);

    for (const change of changes) {
      if (change.type === 'position' && change.id) {
        const node = storeNodes[change.id];
        if (node) {
          updateNodeData(change.id, { position: change.position } as any);
        }
      }
      if (change.type === 'select' && change.id) {
        updateNodeData(change.id, { selected: change.selected } as any);
      }
      if (change.type === 'remove' && change.id) {
        deleteNode(change.id);
      }
    }
  };

  return { reactFlowNodes, handleNodesChange };
};
```

**同步规则**：
| 字段 | 所有者 | 流向 |
|------|--------|------|
| `data`（业务数据） | nodeStore | Store → ReactFlow |
| `position` | ReactFlow | ReactFlow → Store |
| `selected` | ReactFlow | ReactFlow → Store |
| `dragging` | ReactFlow | ReactFlow → Store |
| `id` / `type` | nodeStore（创建时设定） | Store → ReactFlow |

---

## 4. 类型定义

```typescript
// apps/web/src/pages/canvas/components/nodes/prompt-input/types.ts

export interface ImageItem {
  id: string; url: string; name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
}

export interface PromptValue {
  text: string;
  allImages: ImageItem[];
  referencedImageIds: string[];
}

export interface CommandItem {
  id: string; name: string; description: string;
  icon: string; value: string;
  category: 'model' | 'ratio' | 'quality';
}

export const COMMANDS: CommandItem[] = [
  { id: 'model-sdxl', name: 'SD XL', description: 'Stable Diffusion XL', icon: '🎨', value: 'sdxl', category: 'model' },
  { id: 'model-flux', name: 'Flux', description: 'Flux 模型', icon: '✨', value: 'flux', category: 'model' },
  { id: 'ratio-1-1', name: '1:1', description: '正方形', icon: '⬜', value: '1:1', category: 'ratio' },
  { id: 'ratio-16-9', name: '16:9', description: '宽屏', icon: '📺', value: '16:9', category: 'ratio' },
  { id: 'ratio-9-16', name: '9:16', description: '竖屏', icon: '📱', value: '9:16', category: 'ratio' },
  { id: 'quality-std', name: '标准', description: '标准画质', icon: '📷', value: 'standard', category: 'quality' },
  { id: 'quality-2k', name: '2K', description: '2K 高清', icon: '🖼️', value: '2k', category: 'quality' },
  { id: 'quality-4k', name: '4K', description: '4K 超清', icon: '🎞️', value: '4k', category: 'quality' },
];

// 删除 chip 时恢复的默认值
export const CATEGORY_DEFAULTS: Record<CommandItem['category'], string> = {
  model: 'sdxl',
  ratio: '1:1',
  quality: 'standard',
};
```

---

## 5. PromptInput 组件规格

### 5.1 组件结构

```
PromptInput
├── useEditor (Tiptap)
│   ├── StarterKit (仅 document/paragraph/text/history)
│   ├── Placeholder → "描述你想要的画面，输入 / 添加设置..."
│   └── Mention (char: '/')
│       ├── 选中 → 插入 chip + 更新 store
│       └── native DOM popup (不用 tippy.js)
│           └── CommandMentionList
│               ├── 分组: 模型/比例/质量
│               ├── 键盘: ↑↓EnterEsc
│               └── 选中 → onCommandSelect + editor.commands.insertContent
└── EditorContent
```

### 5.2 指令选中 → Store 同步

```
用户输入 "/model flux" Enter →
  ├── editor.commands.insertContent(command chip)
  ├── onCommandSelect({ category: 'model', value: 'flux' })
  └── updateConfig(id, { model: 'flux' })  ← Store 更新
```

### 5.3 指令 Chip 删除 → Store 恢复默认 🔴 核心

```
用户 Backspace 删除 chip →
  ├── editor.on('transaction') 检测删除的 command 节点
  ├── 读取 node.attrs.category → 查 CATEGORY_DEFAULTS
  └── updateConfig(id, { [category]: defaultValue })  ← Store 恢复默认
```

```typescript
// PromptInput.tsx — 删除同步
useEffect(() => {
  if (!editor) return;

  editor.on('transaction', ({ transaction }) => {
    // 检查是否有节点被删除
    if (!transaction.docChanged) return;

    transaction.steps.forEach((step: any) => {
      if (step.jsonID === 'replace' && step.slice?.content?.size === 0) {
        const pos = step.from;
        const node = transaction.before.nodeAt(pos);

        if (node?.type.name === 'command') {
          const category = node.attrs.category as CommandItem['category'];
          const defaultValue = CATEGORY_DEFAULTS[category];
          onCommandSelect({ category, value: defaultValue } as CommandItem);
        }
      }
    });
  });
}, [editor, onCommandSelect]);
```

### 5.4 快捷键

```typescript
// Ctrl+Enter 触发生成
useEffect(() => {
  if (!editor) return;
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onGenerate?.();
    }
  };
  editor.view.dom.addEventListener('keydown', onKeyDown);
  return () => editor.view.dom.removeEventListener('keydown', onKeyDown);
}, [editor, onGenerate]);
```

---

## 6. ImageConfigPanel 布局

```
┌───────────────────────────────────────┐
│  📝 PromptInput                        │
│  ┌───────────────────────────────────┐ │
│  │ 描述你想要的画面，输入 / ...       │ │
│  │ /model  SD XL  /ratio  1:1        │ │  ← command chips
│  └───────────────────────────────────┘ │
│                                         │
│  sdxl  │  1:1  │  standard             │ ← store 只读
│                                         │
│                               [▶ 生成]  │ ← disabled: status=loading 或无文本
└───────────────────────────────────────┘
```

### 生成按钮逻辑

```typescript
disabled={data.status === 'loading' || !data.prompt.text.trim()}
```

### 节点删除资源清理

```typescript
deleteNode: async (nodeId: string) => {
  const node = get().nodes[nodeId];
  if (node?.type === 'image') {
    const imgData = node.data as ImageNodeData;
    // 清理参考图
    const deleteRefs = imgData.prompt.allImages.map((img) =>
      fetch(`/api/storage/files/${img.id}`, { method: 'DELETE' }).catch(() => {})
    );
    await Promise.allSettled(deleteRefs);
    // 清理结果图
    if (imgData.fileId) {
      await fetch(`/api/storage/files/${imgData.fileId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  const newNodes = { ...get().nodes };
  delete newNodes[nodeId];
  set({ nodes: newNodes });
};
```

---

## 7. Phase 1 文件清单

### 新建 (6)

| 文件 | 说明 |
|------|------|
| `.../prompt-input/types.ts` | CommandItem + COMMANDS + CATEGORY_DEFAULTS |
| `.../prompt-input/CommandMentionList.tsx` | /指令弹出菜单 |
| `.../prompt-input/CommandMentionList.test.tsx` | 菜单测试 |
| `.../prompt-input/PromptInput.tsx` | Tiptap + /指令 + 删除同步 + 快捷键 |
| `.../prompt-input/PromptInput.test.tsx` | 编辑器测试 |
| `canvas/hooks/useReactFlowSync.ts` | Store↔ReactFlow 同步 hook |

### 修改 — Store (2)

| 文件 | 改动 |
|------|------|
| `stores/nodeStore.ts` | AppNode 嵌套结构 + addNode/updateNodeData/deleteNode |
| `stores/nodeStore.test.ts` | 全量重写测试 |

### 修改 — 消费者适配 (13)

| 文件 | 改动 |
|------|------|
| `nodes/ImageGenNode.tsx` | `nodes[id]` → `nodes[id]?.data` |
| `nodes/ImageGenNode.test.tsx` | 适配新结构 |
| `nodes/VideoGenNode.tsx` | `nodes[id]` → `nodes[id]?.data` |
| `nodes/VideoGenNode.test.tsx` | 适配新结构 |
| `nodes/VideoConfigPanel.tsx` | `nodes[id]` → `nodes[id]?.data` |
| `nodes/VideoConfigPanel.test.tsx` | 适配新结构 |
| `nodes/TextInputNode.tsx` | `nodes[id]` → `nodes[id]?.data` |
| `nodes/TextInputNode.test.tsx` | 适配新结构 |
| `nodes/TextConfigPanel.tsx` | `nodes[id]` → `nodes[id]?.data` |
| `nodes/TextConfigPanel.test.tsx` | 适配新结构 |
| `canvas/page.tsx` | loadProject 适配 AppNode |
| `canvas/page.test.tsx` | 适配新结构 |
| `canvas/hooks/useCanvasPersistence.ts` | 适配新结构 |

### 修改 — 新功能 (2+1)

| 文件 | 改动 |
|------|------|
| `nodes/ImageConfigPanel.tsx` | 空壳 → PromptInput + 设置栏 + 生成按钮 |
| `nodes/ImageConfigPanel.test.tsx` | 重写集成测试 |
| `index.css` | +50 行样式 |

### 依赖

```bash
pnpm add @tiptap/extension-mention @tiptap/extension-placeholder
```

---

## 8. TDD 实施顺序

```
Step 1: pnpm add 依赖
Step 2: nodeStore 重写 (RED: 写测试 → GREEN: 新 store + AppNode)
Step 3: useReactFlowSync hook (RED → GREEN)
Step 4: 批量适配 13 个消费者 (每个测试通过)
Step 5: types.ts + CommandMentionList (RED → GREEN)
Step 6: PromptInput (RED → GREEN) — 含 chip 删除同步 + 快捷键
Step 7: ImageConfigPanel 集成 (RED → GREEN)
Step 8: CSS 样式
Step 9: 全量回归 pnpm test
```

---

## 9. 验证清单

- [ ] `pnpm test -- nodeStore` — 全部新测试通过
- [ ] `pnpm test -- useReactFlowSync` — 同步逻辑测试通过
- [ ] `pnpm test -- ImageGenNode` — 无回归
- [ ] `pnpm test -- VideoGenNode` — 无回归
- [ ] `pnpm test -- TextInputNode` — 无回归
- [ ] `pnpm test -- CommandMentionList` — 6 tests pass
- [ ] `pnpm test -- PromptInput` — 编辑器 + 删除同步 + 快捷键测试
- [ ] `pnpm test -- ImageConfigPanel` — 集成测试通过
- [ ] `pnpm test` — 前端全部通过
- [ ] `pnpm test` — 后端 199 tests 无回归
- [ ] `npx tsc --noEmit` — 无错误
