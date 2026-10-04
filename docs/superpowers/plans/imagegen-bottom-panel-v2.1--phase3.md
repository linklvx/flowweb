<!-- doc-status: historical | verified_at: n/a -->
# 实施计划：ImageGen 底部面板 v2.1 — Phase 3（修订版）

> 参考 Specs：`docs/superpowers/specs/imagegen-bottom-panel-v2.1.md`
> 前置：Phase 1 + Phase 2 已完成
> 模式：TDD（RED → GREEN → REFACTOR）
> 代理：subagent-driven-development

---

## 目标

1. **@提及系统**：键入 `@` → 弹出图片选择器 → 插入 inline 芯片
2. **剪贴板粘贴**：Ctrl+V 粘贴图片（File + base64 双模式 + 异常兜底）
3. **弹窗互斥**：`/` 指令与 `@` 提及不同时显示
4. **Hook 规范**：所有 Hook 在顶层调用，杜绝条件返回后调用

---

## Step 1：ImageMentionList 组件（新建，TDD）

### RED — 测试

**文件**：`.../prompt-input/ImageMentionList.test.tsx`

```
测试用例（6 个）：
1. renders all success-status images from items array (缩略图 + 名称)
2. highlights item at selectedIndex
3. shows "无匹配图片" 友好文案 when items empty (非空白)
4. calls onSelect with selected item on click
5. keyboard: ArrowDown/ArrowUp wraps, Enter selects, Escape closes
6. does not crash with single item
```

### GREEN — 实现

**文件**：`.../prompt-input/ImageMentionList.tsx`

- 复用 `CommandMentionList` 的样式类名：`.command-popup` `.command-item` `.command-item.selected`
- 渲染：64x64 缩略图 + 文件名 + 状态指示
- 空态："无匹配图片" 灰色文案
- 键盘导航：↑↓EnterEsc
- 渲染到 `document.body`（Portal）

---

## Step 2：PromptInput 扩展（修改，TDD）

### 2a. 类型定义补全

```typescript
interface PromptInputProps {
  nodeId: string;
  value: PromptValue;
  onChange: (value: PromptValue) => void;
  onCommandSelect: (command: CommandItem) => void;
  onGenerate?: () => void;

  // 🆕 Phase 3
  allImages: ImageItem[];
  onPasteImage?: (file: File) => void;

  placeholder?: string;
  disabled?: boolean;
  maxHeight?: number;
  debounceMs?: number;
}
```

### 2b. 弹窗互斥逻辑 🔴

```typescript
// 新增状态：同一时间只允许一个弹窗
const [activeMention, setActiveMention] = useState<'command' | 'image' | null>(null);

// /指令弹窗 activeMention === 'command' → 渲染
// @提及弹窗 activeMention === 'image'  → 渲染
// 互斥：打开一个时，另一个自动关闭
```

### 2c. @提及扩展（复用 createNativeSuggestionRenderer）

```typescript
Mention.extend({ name: 'imageMention' }).configure({
  HTMLAttributes: { class: 'hidden' },
  suggestion: {
    char: '@',
    items: ({ query }) => allImages
      .filter(img => img.status === 'success' && img.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8),
    render: createNativeSuggestionRenderer((item) => {
      // same DOM creation + positioning as /command
    }),
    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: 'image', attrs: { src: props.url },
      }).run();
      setActiveMention(null);
    },
  },
})
```

**关键**：复用 Step 1 Phase 1 已有的 `createNativeSuggestionRenderer` 工具函数。@mention 和 /command 共用同一套 DOM 挂载/定位/关闭逻辑。

### 2d. 剪贴板粘贴（增强版）

```typescript
useEffect(() => {
  if (!editor) return;
  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        // 严格校验：仅允许 image/*
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file && file.type.startsWith('image/')) {
            onPasteImage?.(file);
          }
          return;
        }
      }
    }
    // Fallback: base64 in HTML（异常兜底）
    const html = e.clipboardData?.getData('text/html');
    if (html) {
      const m = html.match(/<img[^>]+src="(data:image\/[^"]+)"/);
      if (m) {
        e.preventDefault();
        fetch(m[1])
          .then(r => r.blob())
          .then(b => {
            if (b.type.startsWith('image/')) {
              onPasteImage?.(new File([b], `paste-${Date.now()}.png`, { type: b.type }));
            }
          })
          .catch(err => console.warn('粘贴图片失败', err));  // 🆕 异常捕获
      }
    }
  };
  editor.view.dom.addEventListener('paste', onPaste);
  return () => editor.view.dom.removeEventListener('paste', onPaste);
}, [editor, onPasteImage]);
```

### RED — 追加测试

```
测试用例（追加 8 个）：
1.  typing "@" shows ImageMentionList popup
2.  selecting @ image inserts inline chip
3.  popup filters images by name when typing "@cat"
4.  popup closes on Escape
5.  pasting File image calls onPasteImage(file)
6.  pasting base64 image calls onPasteImage(file)
7.  pasting non-image text does NOT call onPasteImage
8.  pasting invalid base64 does NOT crash (console.warn)
```

---

## Step 3：ImageConfigPanel 集成（修改）

```tsx
const { uploadSingleImage } = useImageUpload(nodeId);

const handlePasteImage = useCallback(async (file: File) => {
  if (prompt.allImages.length >= 9) {
    console.warn('图片池已满，最多 9 张');
    return;
  }
  const uploaded = await uploadSingleImage(file);
  if (uploaded) {
    promptRef.current?.insertImage(uploaded.url);
  }
}, [prompt.allImages.length, uploadSingleImage]);

<PromptInput
  ref={promptRef}
  nodeId={nodeId}
  value={prompt}
  allImages={prompt.allImages}         // 🆕 for @mention
  onPasteImage={handlePasteImage}      // 🆕 for clipboard paste
  onChange={(newPrompt) => updateConfig(nodeId, { prompt: newPrompt })}
  onCommandSelect={handleCommandSelect}
  onGenerate={handleGenerate}
  disabled={status === 'loading'}
/>
```

---

## 文件清单

### 新建 (3)

| 文件 | 说明 |
|------|------|
| `.../prompt-input/ImageMentionList.tsx` | @提及图片选择器 |
| `.../prompt-input/ImageMentionList.test.tsx` | 6 测试 |
| `.../prompt-input/PromptInput.css`（追加） | image-mention 样式 |

### 修改 (3)

| 文件 | 改动 |
|------|------|
| `.../prompt-input/PromptInput.tsx` | Props 补全 + @提及 + 剪贴板 + 弹窗互斥 |
| `.../prompt-input/PromptInput.test.tsx`（追加） | +8 测试 |
| `nodes/ImageConfigPanel.tsx` | allImages + handlePasteImage |
| `nodes/ImageConfigPanel.test.tsx`（更新） | mock 适配新 props |

---

## 风险规避

| 风险 | 措施 |
|------|------|
| Hook 违规 | 所有 Hook 顶层调用，条件返回置后 |
| 弹窗冲突 | @和/互斥，同一时间只显示一个 |
| 内存泄漏 | Portal 卸载自动清理 + 编辑器 destroy 监听 |
| 粘贴冲突 | `e.preventDefault()` 强制屏蔽原生行为 |
| 类型错误 | 全量类型守卫，严格校验 file.type |
| 键盘冲突 | ↑↓/Enter/Esc 仅对当前激活弹窗生效 |

---

## TDD 实施顺序

```
Step 1: ImageMentionList (RED → GREEN → REFACTOR)
Step 2: PromptInput 扩展 — @提及 + 粘贴 + 弹窗互斥 (RED → GREEN → REFACTOR)
Step 3: ImageConfigPanel 集成 (更新 mock + 测试)
Step 4: CSS + 全量回归
```

---

## 验证清单

- [ ] `pnpm test -- ImageMentionList` — 6 tests pass
- [ ] `pnpm test -- PromptInput` — 现有 + 8 tests pass
- [ ] `pnpm test -- ImageConfigPanel` — 6 tests 无回归
- [ ] `pnpm test` — 全量通过
