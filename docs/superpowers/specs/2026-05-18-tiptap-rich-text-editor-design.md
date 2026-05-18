# Tiptap 富文本编辑器 — 设计文档

**日期**: 2026-05-18  
**状态**: 已确认  
**基线上限**: checkpoint-toolbar (commit 16d3097)

---

## 目标

将文本节点从 Markdown 源码编辑（textarea + 符号插入）升级为 Tiptap WYSIWYG 富文本编辑。用户选中文字点击工具栏按钮后，文字**直接变大/加粗/倾斜**，不再插入 `#` `**` 等 Markdown 符号。

---

## 依赖

只安装两个核心包（starter-kit 已包含 heading/bold/italic/list/hr/paragraph/history）：

```json
{
  "@tiptap/react": "2.10.0",
  "@tiptap/starter-kit": "2.10.0"
}
```

---

## 组件架构

```
TextInputNode (useEditor → editor 实例)
  ├─ TextNodeToolbar (新增 editor prop)
  │   ├─ H1 → editor.chain().focus().toggleHeading({ level: 1 }).run()
  │   ├─ H2 → editor.chain().focus().toggleHeading({ level: 2 }).run()
  │   ├─ H3 → editor.chain().focus().toggleHeading({ level: 3 }).run()
  │   ├─ ¶ → editor.chain().focus().setParagraph().run()
  │   ├─ B  → editor.chain().focus().toggleBold().run()
  │   ├─ I  → editor.chain().focus().toggleItalic().run()
  │   ├─ UL → editor.chain().focus().toggleBulletList().run()
  │   ├─ OL → editor.chain().focus().toggleOrderedList().run()
  │   ├─ HR → editor.chain().focus().setHorizontalRule().run()
  │   ├─ Copy → 富文本剪贴板（HTML + 纯文本）
  │   └─ Fullscreen → CustomEvent (不变)
  ├─ 标题栏 (不变：invisible span + absolute input)
  ├─ <EditorContent editor={editor} />  ← 替换原有 <textarea>
  └─ TextConfigPanel (不变)
```

### TextNodeToolbar 接口变更

```typescript
// 旧
interface Props { nodeId: string; }

// 新
import type { Editor } from '@tiptap/react';
interface Props { nodeId: string; editor: Editor | null; }
```

---

## 数据流

```
用户操作 → Tiptap editor.onUpdate → onChange(editor.getHTML())
  → nodeStore.updateText(id, html)
  → content 字段存储 HTML 字符串（原为纯文本）
```

- `TextNodeData.content` 类型保持 `string`，但从纯文本变为 HTML
- store 接口不变：`updateText(id, content)` 无需修改
- 向后兼容：旧数据（纯文本）传给 Tiptap 作为初始 content，自动包裹在 `<p>` 中

---

## 编辑器配置

```typescript
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
  ],
  content: nodeData?.content ?? '',
  editorProps: {
    attributes: {
      class: 'nodrag prose-dark', // nodrag 阻止 React Flow 拖拽
    },
  },
  onUpdate: ({ editor }) => {
    updateText(id, editor.getHTML());
  },
});
```

- 不需 `immediateRender: false`（SSR）
- 不需要 `editable` 控制（始终可编辑）

---

## 暗色主题 CSS（Tiptap 内容样式）

```css
/* 标题层级 */
.tiptap-content h1 { font-size: 22px; font-weight: 700; color: #fff; margin: 0 0 8px 0; line-height: 1.3; }
.tiptap-content h2 { font-size: 18px; font-weight: 600; color: #eee; margin: 12px 0 6px 0; line-height: 1.3; }
.tiptap-content h3 { font-size: 15px; font-weight: 600; color: #ddd; margin: 10px 0 4px 0; line-height: 1.3; }
.tiptap-content p  { font-size: 13px; color: #bbb; margin: 0 0 8px 0; line-height: 1.7; }
.tiptap-content ul, .tiptap-content ol { font-size: 13px; color: #bbb; padding-left: 20px; line-height: 1.8; }
.tiptap-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 10px 0; }
```

通过 `editorProps.attributes.class` 注入 `tiptap-content`。

---

## 按钮激活状态

```typescript
// 工具栏按钮根据当前光标位置高亮
const isActive = (type: string, opts?: Record<string, unknown>) =>
  editor?.isActive(type, opts);

// 示例
editor.isActive('bold')                    → 加粗按钮 bg-white/20
editor.isActive('heading', { level: 1 })   → H1 按钮 bg-white/20
editor.isActive('bulletList')              → 无序列表按钮 bg-white/20
```

**激活态样式**：按钮添加 `bg-white/20`（当前 hover 是 `bg-white/10`，激活态更亮一点以区分）。

---

## 改动的文件

| 文件 | 改动内容 |
|------|----------|
| `apps/web/package.json` | 新增 @tiptap/react@2.10.0, @tiptap/starter-kit@2.10.0 |
| `TextInputNode.tsx` | textarea → EditorContent, useEditor hook, onUpdate 回调 |
| `TextNodeToolbar.tsx` | 新增 editor prop, insertFormat → chain commands, 激活状态高亮 |
| `TextNodeToolbar.test.tsx` | 适配 editor mock, 测试新行为 |
| `TextInputNode.test.tsx` | 适配 EditorContent 渲染, 更新断言 |
| `TextConfigPanel.tsx` | 不变 |
| `nodeStore.ts` | 不变 |

---

## 工程细节（Critical）

### 1. 编辑器实例空值安全

`useEditor` 初始渲染返回 `null`，所有调用必须空值检查。在 TextNodeToolbar 顶部定义通用安全函数：

```typescript
const exec = (command: (editor: Editor) => void) => {
  if (editor) command(editor);
};

// 使用方式
<button onClick={() => exec(e => e.chain().focus().toggleBold().run())}>
  B
</button>
```

### 2. 组件卸载时销毁编辑器

TextInputNode 中添加 cleanup effect 防止内存泄漏：

```typescript
useEffect(() => {
  return () => {
    editor?.destroy();
  };
}, [editor]);
```

### 3. 工具栏点击保持编辑器焦点

点击工具栏按钮时编辑器会失焦。工具栏根元素添加 `onMouseDown` 阻止默认行为：

```tsx
<div
  className="nodrag pointer-events-auto flex items-center ..."
  onMouseDown={(e) => e.preventDefault()}
  style={{ transform: `scale(${1 / zoom})`, ... }}
>
```

### 4. 复制按钮 — 富文本剪贴板

复制时同时写入 HTML 和纯文本格式，粘贴到其他地方（如飞书/Notion/Word）时保留格式：

```typescript
const handleCopy = async () => {
  if (!editor) return;
  const text = editor.getText();
  const html = editor.getHTML();
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
  } catch {
    // 降级：只复制纯文本
    await navigator.clipboard.writeText(text);
  }
};
```

---

## 不做的

- 不引入 Ant Design 组件（按钮保持 SVG 图标 + Tailwind 样式）
- 不引入 underline/color/highlight/text-align 扩展（当前工具栏无对应按钮）
- 不改变卡片尺寸（360×210 不变）
- 不改变标题栏实现
- 不改变悬浮位置和 anti-zoom 逻辑
- 不改变 Copy/Fullscreen 按钮的行为
