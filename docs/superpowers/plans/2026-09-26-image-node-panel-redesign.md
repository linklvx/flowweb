# Canvas 图片节点面板与交互改造 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 spec `docs/superpowers/specs/2026-09-26-image-node-panel-redesign.md` 的 10 项图片节点 UI/交互改造（数量选择器修复+张文案、输入区光标+占位文案、工具行风格/参考按钮、运行按钮 token 化、1K 分辨率、标题双击编辑+mediaName 唯一真源、handle 拖拽弹菜单建节点连线）。

**Architecture:** P0 独立 bug 修复 → P1 四项纯展示（相互独立）→ P2 两项交互（标题状态机、拖拽菜单=纯函数守卫+menuStore 扩展+新菜单组件+CanvasView 接线）。可测逻辑全部抽出组件（shouldOpenHandleMenu 纯函数），CanvasView 只做接线。所有颜色经 token（新 `--canvas-run-btn-*` 对走 b0 登记表/registry 变更登记/contrast-pairs）。

**Tech Stack:** React 18 + @xyflow/react 12.10.2 + zustand + Tailwind（语义 token 类）+ vitest + @testing-library/react（jsdom）。

**工作目录：** 所有命令在 `D:\flowweb\apps\web` 下执行。测试命令 `pnpm vitest run <file>`（或 `npx vitest run <file>`）。

**已知门禁：** lint-gate（`pnpm lint`，no-color-hex 增量门禁——**既有硬编码色如 #f5f5f5/#2a2a2a/#ccc 已 baselined，保持原样不改不删**；新代码禁引入新 hex）；css-audit（`node scripts/css-audit.mjs`）；contrast-table（`node scripts/contrast-table.mjs`）。

---

### Task 1: GenerateCountSelector——修"再次点击关不上"+图标+张文案+去 8 档（P0，需求 2）

**Files:**
- Modify: `src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.tsx`
- Create: `src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.test.tsx`
- Modify: `src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`（L265-306 区间 10 行断言）

- [ ] **Step 1.1: 新建失败测试**

创建 `src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GenerateCountSelector } from './GenerateCountSelector';

describe('GenerateCountSelector', () => {
  it('mousedown+click 真实序列：再次点击同一按钮应关闭菜单（修复前必红）', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId('canvas-node-image-count-menu')).toBeInTheDocument();
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.queryByTestId('canvas-node-image-count-menu')).not.toBeInTheDocument();
  });

  it('点击 body 关闭（回归）', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId('canvas-node-image-count-menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('canvas-node-image-count-menu')).not.toBeInTheDocument();
  });

  it('按钮含 svg 图标前缀且显示「1张」', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.textContent).toContain('1张');
  });

  it('菜单项为 1张/2张/4张，无 8张', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-node-image-count-select'));
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    const menu = screen.getByTestId('canvas-node-image-count-menu');
    expect(within(menu).getByText('1张')).toBeTruthy();
    expect(within(menu).getByText('2张')).toBeTruthy();
    expect(within(menu).getByText('4张')).toBeTruthy();
    expect(within(menu).queryByText('8张')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 1.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.test.tsx`
Expected: 用例 1 FAIL（第二次序列后菜单仍在——bug 复现）；用例 3/4 FAIL（无 svg/无张文案/有 8×）。

- [ ] **Step 1.3: 同步改 ImageConfigPanel.test.tsx 既有断言（L265-306 区间）**

逐条替换（先 `git diff` 确认行号仍对齐，组件未改前这些断言当前是绿的，改完随 Step 1.5 一起验证）：
- L269 `expect(btn.textContent).toContain('1×');` → `expect(btn.textContent).toContain('1张');`
- L285 `expect(screen.getAllByText('1×').length).toBeGreaterThanOrEqual(2);` → `expect(screen.getAllByText('1张').length).toBeGreaterThanOrEqual(2);`
- L286 `expect(screen.getByText('2×')).toBeTruthy();` → `expect(screen.getByText('2张')).toBeTruthy();`
- L287 `expect(screen.getByText('4×')).toBeTruthy();` → `expect(screen.getByText('4张')).toBeTruthy();`
- L288 `expect(screen.getByText('8×')).toBeTruthy();` → **整行删除**（选项去 8）
- L294 `fireEvent.click(screen.getByText('2×'));` → `fireEvent.click(screen.getByText('2张'));`
- L295 `toContain('2×')` → `toContain('2张')`
- L302 `expect(screen.getByText('2×')).toBeTruthy();` → `expect(screen.getByText('2张')).toBeTruthy();`
- L305 `expect(screen.queryByText('2×')).not.toBeInTheDocument();` → `expect(screen.queryByText('2张')).not.toBeInTheDocument();`
- L306 `expect(screen.getByText('1×')).toBeTruthy();` → `expect(screen.getByText('1张')).toBeTruthy();`

L272-279 tooltip 用例（「生成数量」）不动。

**查询口径说明**：`within(menu)` 收窄只用于新组件测试（GenerateCountSelector.test.tsx，防御 EraseBottomToolbar「1张」重名）；本文件（ImageConfigPanel.test.tsx）的渲染树不含 EraseBottomToolbar，沿用 `screen.getByText` 即可（L285 的 `getAllByText ≥2` 语义=触发器+菜单项，保留）。

- [ ] **Step 1.4: 实现**

`GenerateCountSelector.tsx` 全量替换为：

```tsx
import { memo, useState, useEffect } from 'react';

interface GenerateCountSelectorProps {
  count: number;
  options?: number[];
  onChange: (count: number) => void;
  disabled?: boolean;
}

function GenerateCountSelectorComponent({ count, options = [1, 2, 4], onChange, disabled }: GenerateCountSelectorProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="canvas-node-image-count-select"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="group relative inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-[#f5f5f5] transition-all active:bg-overlay-2 hover:bg-overlay-2 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`生成 ${count} 张`}
        disabled={disabled}
      >
        <span className="count-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs font-normal text-text bg-[var(--canvas-controls-bg)] rounded-md whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">生成数量</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M8.00016 1.33252C8.46405 1.33252 8.89912 1.33708 9.31592 1.34619C9.8305 1.3575 10.3352 1.52823 10.7489 1.84749C11.8025 2.6608 12.5088 3.3675 13.2795 4.35921C13.8428 5.08443 14.1295 5.97534 14.144 6.87614L14.1532 7.99984C14.1532 8.26775 14.1497 8.53448 14.1466 8.79997C14.1472 8.82905 14.1492 8.85832 14.1493 8.88786C14.1492 8.90698 14.1474 8.92593 14.1453 8.9445C14.1301 10.0648 14.0892 11.1624 14.0223 12.2297C13.9442 13.4716 12.9577 14.4593 11.7183 14.5448C10.5426 14.6256 9.40591 14.6678 8.00016 14.6678C6.59439 14.6678 5.45774 14.6256 4.28206 14.5448C3.04244 14.4595 2.05616 13.4717 1.97803 12.2297C1.89234 10.8641 1.84717 9.4489 1.84717 7.99984C1.84717 6.55087 1.89234 5.1361 1.97803 3.77067C2.0561 2.52857 3.04236 1.54082 4.28206 1.45557C5.45772 1.37474 6.59436 1.33252 8.00016 1.33252ZM8.00016 2.33252C6.61687 2.33252 5.50303 2.37436 4.35042 2.45361C3.60933 2.50461 3.0225 3.09414 2.97607 3.83382C2.89173 5.17804 2.84717 6.57158 2.84717 7.99984C2.84717 9.42819 2.89172 10.8222 2.97607 12.1665C3.02256 12.9061 3.60935 13.4957 4.35042 13.5467C5.503 13.626 6.61685 13.6678 8.00016 13.6678C9.38347 13.6678 10.4973 13.626 11.6499 13.5467C12.3909 13.4956 12.9778 12.906 13.0243 12.1665C13.0929 11.0725 13.1333 9.94559 13.1466 8.79411C13.1226 7.74073 12.6935 7.19336 12.1636 6.87549C11.5742 6.52209 10.8001 6.41763 10.1076 6.39762C9.292 6.37398 8.59521 5.73532 8.59521 4.87549V2.33512C8.4021 2.33329 8.20407 2.33252 8.00016 2.33252ZM9.59521 4.87549C9.59521 5.15103 9.81774 5.38838 10.1369 5.39762C10.8715 5.41887 11.8606 5.52796 12.6779 6.01807C12.8208 6.10379 12.9561 6.2013 13.0835 6.30908C12.9907 5.82096 12.7917 5.36183 12.4897 4.97314C11.7717 4.04921 11.1262 3.40183 10.1382 2.63916C9.97871 2.51607 9.7929 2.4304 9.59521 2.3846V4.87549Z" fill="currentColor" />
        </svg>
        <span>{count}张</span>
      </button>
      {open && (
        <div
          data-testid="canvas-node-image-count-menu"
          className="absolute bottom-full mb-1 right-0 bg-[#2a2a2a] border border-overlay-2 rounded-lg py-1 shadow-xl z-50 min-w-[80px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => { onChange(n); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-overlay-2 bg-transparent text-[#ccc] ${n === count ? 'bg-overlay-2' : ''}`}
            >
              {n}张
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const GenerateCountSelector = memo(GenerateCountSelectorComponent);
```

要点：`onMouseDown={(e) => e.stopPropagation()}`（修根因——mousedown 不再冒泡到 document 的关闭监听，再次点击靠自身 toggle 关闭，spec §3.1-A2 固有取舍）；options 默认 `[1,2,4]`（两个调用点 ImageConfigPanel.tsx:147 / ImageExtConfigPanel.tsx:280 均不传 options，自动生效）；`text-[#f5f5f5]/#2a2a2a/#ccc` 为既有 baselined 色保持原样。

- [ ] **Step 1.5: 跑绿（新测试+面板测试）**

Run: `pnpm vitest run src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.test.tsx src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 1.6: 全量回归**

Run: `pnpm vitest run`
Expected: 全绿（ImageExtConfigPanel.test 无数量断言已核实；imageExtNodeApi.test.tsx L94 `generateCount: 8` 是 API 透传断言，**保持不动**）。

- [ ] **Step 1.7: Commit**

```bash
git add src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.tsx src/pages/canvas/components/nodes/config-panel/GenerateCountSelector.test.tsx src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx
git commit -m "fix(web): 数量选择器修\"再次点击关不上\"（触发器补 mousedown stopPropagation）+文档图标前缀+1x/2x/4x→1张/2张/4张去8档+菜单独立testid+aria-label中文化"
```

---

### Task 2: PromptInput——输入区 I 光标 + 新占位文案（P1a，需求 1/3）

**Files:**
- Modify: `src/pages/canvas/components/nodes/prompt-input/PromptInput.css:64-66`（.prompt-editor 块）、`:119-127`（.command-chip 块）
- Modify: `src/pages/canvas/components/nodes/prompt-input/PromptInput.tsx:230`（默认 placeholder）
- Modify: `src/pages/canvas/components/nodes/prompt-input/PromptInput.test.tsx`（文件末尾追加用例）

- [ ] **Step 2.1: 写失败测试**

在 `PromptInput.test.tsx` 的 describe 块末尾追加（该文件已有 `capturedEditorConfig` 捕获 useEditor 配置的机制与 `renderPromptInput` helper，直接复用）：

```tsx
  // ---- 默认 placeholder 文案（需求 3）----
  it('N1. 默认 placeholder 为新文案（不传 placeholder prop）', () => {
    // renderPromptInput 显式传 placeholder 后 ...props 展开——传 undefined 覆盖之，
    // 组件解构默认值对 undefined 生效 → 命中默认文案路径
    renderPromptInput({ placeholder: undefined });
    // capturedEditorConfig 是 vi.hoisted holder：.current 即 useEditor config（一层 current，勿多包）
    const exts = capturedEditorConfig.current!.extensions as any[];
    const ph = exts.find((e: any) => e?.name === 'placeholder');
    expect(ph?.options?.placeholder).toBe('描述你想要生成的画面内容，@引用素材');
  });
```

同时在文件顶部 import 区补 `import { readFileSync } from 'node:fs';` 与 `import path from 'node:path';`（若未有），追加 CSS 断言用例：

```tsx
  // ---- 输入区 cursor（需求 1）----
  it('N2. PromptInput.css：.prompt-editor 有 cursor:text 且 .command-chip 有 cursor:default', () => {
    const css = readFileSync(path.resolve(__dirname, 'PromptInput.css'), 'utf-8');
    // 全文兜底 + 锚定切片双保险（.prompt-editor 在文件中出现 3 次，切片锚第一块 L64）
    expect(css).toContain('cursor: text');
    const editorBlock = css.slice(css.indexOf('.prompt-editor {'), css.indexOf('.prompt-editor p'));
    expect(editorBlock).toContain('cursor: text');
    const chipBlock = css.slice(css.indexOf('.command-chip'), css.indexOf('/* ImageThumbnailBar'));
    expect(chipBlock).toContain('cursor: default');
  });
```

（若 `capturedEditorConfig` 的扩展不可直接 `.find`，按该文件既有用例对 extensions 的访问方式调整断言写法——机制相同。）

- [ ] **Step 2.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/nodes/prompt-input/PromptInput.test.tsx`
Expected: N1 FAIL（默认值仍是旧文案）、N2 FAIL（无 cursor 声明）。

- [ ] **Step 2.3: 实现**

1. `PromptInput.tsx` L230：
   `placeholder = '描述你想要的画面，输入 / 添加设置...',` → `placeholder = '描述你想要生成的画面内容，@引用素材',`

2. `PromptInput.css` L64-66 现有块：
```css
.prompt-editor {
  word-break: break-word;
}
```
改为：
```css
.prompt-editor {
  word-break: break-word;
  cursor: text; /* 需求1：空编辑区（仅 placeholder）下浏览器默认箭头，显式 I 型；chip 的 cursor 靠内联/自有规则不受影响 */
}
```

3. 同文件 L119-127 `.command-chip` 块内追加一行 `cursor: default;`（编辑器内命令徽章，防继承 I 型）：
```css
.command-chip {
  display: inline;
  background-color: #2563eb;
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
  margin: 0 2px;
  cursor: default; /* 需求1 配套：徽章非可编辑文本，不随 .prompt-editor 变 I 型 */
}
```

- [ ] **Step 2.4: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/nodes/prompt-input/PromptInput.test.tsx`
Expected: 全部 PASS（既有用例传自定义 placeholder，不受默认值影响）。

- [ ] **Step 2.5: Commit**

```bash
git add src/pages/canvas/components/nodes/prompt-input/PromptInput.tsx src/pages/canvas/components/nodes/prompt-input/PromptInput.css src/pages/canvas/components/nodes/prompt-input/PromptInput.test.tsx
git commit -m "feat(web): 图片节点输入区 I 光标（.prompt-editor cursor:text+.command-chip default）+默认占位改「描述你想要生成的画面内容，@引用素材」"
```

---

### Task 3: ImageThumbnailBar——工具行 [风格][参考(+号)] [缩略图]（P1b，需求 4/5/6）

**Files:**
- Modify: `src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx`（return 段 L98-147 重排+新增风格按钮）
- Modify: `src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`（追加用例+改用例 3）

说明：VideoConfigPanel（:237-254）与 Image/ImageExt 面板共享本组件，统一生效（spec 拍板）；ImageGenNode.test 已 mock 本组件，不受影响。

- [ ] **Step 3.1: 写失败测试**

在 `ImageThumbnailBar.test.tsx` 的 describe 末尾追加：

```tsx
  it('9. renders 风格 button (aria-label) before 参考 upload button', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const style = screen.getByRole('button', { name: '风格' });
    const upload = screen.getByTestId('upload-button');
    expect(style).toBeInTheDocument();
    expect(upload.textContent).toContain('参考');
    // 风格在参考左侧
    expect(style.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('10. upload-button (参考) renders before first thumbnail', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const upload = screen.getByTestId('upload-button');
    const firstThumb = screen.getByTestId('thumb-img-1');
    expect(upload.compareDocumentPosition(firstThumb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('11. 风格 button still rendered when images reach maxCount (upload hidden)', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        maxCount={3}
      />,
    );
    expect(screen.queryByTestId('upload-button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '风格' })).toBeInTheDocument();
  });

  it('12. clicking 参考 button triggers hidden file input click', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');
    fireEvent.click(screen.getByTestId('upload-button'));
    expect(clickSpy).toHaveBeenCalled();
  });
```

- [ ] **Step 3.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`
Expected: 用例 9/10/11 FAIL（无风格按钮、顺序相反、参考无文字）；12 PASS（现状已有——回归保护）。

- [ ] **Step 3.3: 实现**

`ImageThumbnailBar.tsx` 的 return 段（L98-147）替换为（逻辑函数 handleDragOver/processUpload/handleDrop/handleFileChange/handleDeleteImage/handleUploadClick 全部不动，仅重排 JSX+新按钮）：

```tsx
  return (
    <div
      data-testid="thumbnail-bar"
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' as any }}
      onDragOver={disabled ? undefined : handleDragOver}
      onDrop={disabled ? undefined : handleDrop}
    >
      {/* 风格按钮 — 仅外观无功能（spec 需求4 拍板；点击无反应是预期，登记 §7-4） */}
      <button
        type="button"
        aria-label="风格"
        className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-surface-dim transition-colors hover:bg-overlay-2"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5H3.5A6.5 6.5 0 0 1 10 3.5Z" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 7a3 3 0 0 1 3 3H7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="10" cy="9" r="1.2" fill="currentColor" />
        </svg>
        <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">风格</span>
      </button>

      {showUploadButton && (
        <>
          {/* 参考按钮 = 原 +号上传按钮改版（spec 需求5/6：上传行为/data-testid 保留，缩略图移到其右侧） */}
          <button
            data-testid="upload-button"
            aria-label="参考"
            onClick={handleUploadClick}
            className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-surface-dim transition-colors hover:bg-overlay-2 focus:outline-none shadow-none outline-none"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M13.5 6V4.5A2.5 2.5 0 0 0 11 2H4.5A2.5 2.5 0 0 0 2 4.5V11a2.5 2.5 0 0 0 2.5 2.5H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">参考</span>
          </button>
          <input
            ref={fileInputRef}
            data-testid="file-input"
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={disabled ? undefined : handleDragEnd}
      >
        <SortableContext items={images.map((img) => img.id)}>
          {images.map((image) => (
            <SortableImageItem
              key={image.id}
              image={image}
              onDelete={disabled ? () => {} : handleDeleteImage}
              onClick={disabled ? () => {} : onImageClick}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
```

要点：颜色全部走 Tailwind 语义类（`bg-surface-dim`=--fw-surface-dim、`text-text-dim-2`、`hover:bg-overlay-2`，spec §4）；风格按钮不受 showUploadButton/disabled 控制（与上传无关，满 9 张仍显示）；56 按钮与 50 缩略图同排高差 6px 为已知登记项（spec §7-7）。

- [ ] **Step 3.4: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`
Expected: 全部 PASS（含既有 1-8）。

- [ ] **Step 3.5: 全量回归**

Run: `pnpm vitest run`
Expected: 全绿（VideoConfigPanel.test 若有对 upload-button 的断言需同步检查——其为共享组件，只断言存在性则天然通过）。

- [ ] **Step 3.6: Commit**

```bash
git add src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx
git commit -m "feat(web): 工具行政版——[风格(仅外观)][参考(原+号 56×56 竖排)] [缩略图] 顺序对调，颜色走 surface-dim/dim-2 语义 token"
```

---

### Task 4: RunButton 新箭头+title+token 对（P1c，需求 8）

**Files:**
- Modify: `src/pages/canvas/components/nodes/config-panel/RunButton.tsx`
- Create: `src/pages/canvas/components/nodes/config-panel/RunButton.test.tsx`
- Modify: `src/index.css`（深块 + 唯一 .light 块各加 2 个 token）
- Modify: `e2e/b0-token-blocks.spec.ts`（DOMAIN_TOKENS/DOMAIN_DARK/DOMAIN_LIGHT）
- Modify: `e2e/audit/contrast-pairs.json`（pairs 补 2 条）
- Modify: `e2e/audit/canvas-migration-registry.json`（adjudications 尾部补变更登记）

- [ ] **Step 4.1: 写失败测试**

创建 `src/pages/canvas/components/nodes/config-panel/RunButton.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunButton } from './RunButton';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('RunButton', () => {
  it('title=生成 且含 20×20 箭头 svg', () => {
    render(<RunButton loading={false} onClick={vi.fn()} />);
    const btn = screen.getByTitle('生成');
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('背景/箭头指向新 token（字符串断言，不解析 rgb）', () => {
    render(<RunButton loading={false} onClick={vi.fn()} />);
    const btn = screen.getByTitle('生成');
    expect(btn.className).toContain('bg-[var(--canvas-run-btn-bg)]');
    expect(btn.querySelector('svg')?.className).toContain('text-[var(--canvas-run-btn-icon)]');
  });

  it('index.css 深/浅块均定义新 token 对（正则锚定块头——顶部注释亦含 .light/:root, 字样，indexOf 切片会得到空串假红）', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../../index.css'), 'utf-8');
    const darkStart = css.search(/:root,\s*\.dark\s*\{/);
    const lightStart = css.search(/\.light\s*\{/);
    expect(darkStart).toBeGreaterThan(-1);
    expect(lightStart).toBeGreaterThan(darkStart); // 源序约束（D8）
    const darkBlock = css.slice(darkStart, lightStart);
    const lightBlock = css.slice(lightStart, css.indexOf('}', lightStart + 5000));
    expect(darkBlock).toContain('--canvas-run-btn-bg: rgb(145, 145, 145)');
    expect(darkBlock).toContain('--canvas-run-btn-icon: #141414');
    expect(lightBlock).toContain('--canvas-run-btn-bg: rgb(135, 135, 135)');
    expect(lightBlock).toContain('--canvas-run-btn-icon: #141414');
  });
});
```

- [ ] **Step 4.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/nodes/config-panel/RunButton.test.tsx`
Expected: 三条全 FAIL。

- [ ] **Step 4.3: 实现**

1. `RunButton.tsx` 全量替换：

```tsx
import { memo } from 'react';

interface RunButtonProps {
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function RunButtonComponent({ loading, onClick, disabled }: RunButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title="生成"
      className="size-7 shrink-0 flex items-center justify-center rounded-lg bg-[var(--canvas-run-btn-bg)] transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? '⏳' : (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="text-[var(--canvas-run-btn-icon)]">
          <path d="M4.16699 9.99996L10.0003 4.16663M10.0003 4.16663L15.8337 9.99996M10.0003 4.16663V15.8333" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export const RunButton = memo(RunButtonComponent);
```

2. `src/index.css` 深块（`:root,.dark` 内，`--canvas-handle-hover-icon: #FFFFFF;` 之后）追加：

```css
  --canvas-run-btn-bg: rgb(145, 145, 145);  /* 图片节点面板运行钮底（2026-09-26 需求8；深档保参考值 ≈4.81:1@面板底） */
  --canvas-run-btn-icon: #141414;           /* 运行钮箭头（灰底上 ≈6:1） */
```

3. 同文件唯一 `.light` 块内（`--canvas-handle-hover-icon: #111827;` 之后）追加（**禁止另起 .light 块**，b1-token-migration.spec L331 守卫）：

```css
  --canvas-run-btn-bg: rgb(135, 135, 135);  /* 浅档加深（参考值 2.78:1→≈3.18:1@#f0f1f2；拍板对象=按钮底 vs 面板底（WCAG 1.4.11 非文本控件 ≥3:1），箭头@钮底 ≈5.1:1 轻松达标；终值以 contrast-table 首跑为准，<3.0 则加深 rgb(125, 125, 125)） */
  --canvas-run-btn-icon: #141414;
```

4. `e2e/b0-token-blocks.spec.ts`：`DOMAIN_TOKENS` 数组（L66-72）追加两键 `,'--canvas-run-btn-bg', '--canvas-run-btn-icon'`；`DOMAIN_DARK`（L74-93）追加——**值必须无空格**（b0 机制：actual 经 `v.replace(/\s+/g,'')` 归一化，expected 表值**原样**精确比对，参照既有 `'--canvas-controls-bg': 'rgb(38,38,38)'`）：

```ts
  '--canvas-run-btn-bg': 'rgb(145,145,145)',
  '--canvas-run-btn-icon': '#141414',
```

`DOMAIN_LIGHT`（L95-114）追加：

```ts
  '--canvas-run-btn-bg': 'rgb(135,135,135)',
  '--canvas-run-btn-icon': '#141414',
```

（CSS 源文件写带空格 `rgb(145, 145, 145)` 与深块 L38 惯例一致；b0 表写无空格——两处口径勿混。）

5. `e2e/audit/contrast-pairs.json`：`pairs` 数组尾部追加 **3 条**。注意工具契约（contrast-table.mjs 已核）：条目 schema 为 `{id, fg, bg, specExpect?, spec}`；`luminance()` **只解析 hex**（rgb() 串会 NaN 静默）；`specExpect != null` 才有 drift 牙齿。**specExpect 一律先置 null、跑 `node scripts/contrast-table.mjs` 取实测输出回填（仓内规矩：首跑回填、禁手算定稿），回填后复跑须全绿**。配对对象=拍板真正保护的两层（按钮底@面板底 ×2 深浅 + 箭头@浅钮底）：

```json
    { "id": "P8-运行钮底@深面板底", "fg": "#919191", "bg": "#262626", "specExpect": null, "spec": "§4 需求8 深档保参考值 rgb(145,145,145)≡#919191（手算参考 ≈4.81，以首跑为准）" },
    { "id": "P8-运行钮底@浅面板底", "fg": "#878787", "bg": "#F0F1F2", "specExpect": null, "spec": "§4 需求8 浅档加深 ≥3:1 拍板（WCAG 1.4.11；rgb(135,135,135)≡#878787，手算参考 ≈3.18，以首跑为准；首跑 <3.0 则改 rgb(125,125,125) 并同步 index.css/.light 块与 b0 表后重跑）" },
    { "id": "P8-运行钮箭头@浅钮底", "fg": "#141414", "bg": "#878787", "specExpect": null, "spec": "§4 需求8 箭头@浅档钮底（手算参考 ≈5.1，以首跑为准）" }
```

**baseline 说明**：RunButton 原 `text-[#999]` 行被本任务删除，其 hex-baseline 陈旧键**留存不重建**（baseline 冻结、门禁只拦新增键；删除既有行是安全的）。

6. `e2e/audit/canvas-migration-registry.json`：adjudications 数组尾部追加（推翻 Task 22 对 RunButton:14 的预登记裁定，spec §4 管道合规）：

```json
   {
    "prop": "backgroundColor",
    "before": "var(--canvas-controls-bg)",
    "after": "var(--canvas-run-btn-bg)",
    "why": "2026-09-26 image-node-panel-redesign 需求8 运行按钮政版：推翻 Task 22 对 RunButton:14 的预登记裁定，新 token 对（深 rgb(145,145,145) 保参考值/浅 rgb(135,135,135) 加深 ≥3:1 拍板），同步 20px 新箭头 SVG+title=生成"
   }
```

- [ ] **Step 4.4: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/nodes/config-panel/RunButton.test.tsx src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx src/pages/canvas/components/nodes/ImageExtConfigPanel.test.tsx`
Expected: 全 PASS（两面板共享组件统一生效）。

- [ ] **Step 4.5: Commit**

```bash
git add src/pages/canvas/components/nodes/config-panel/RunButton.tsx src/pages/canvas/components/nodes/config-panel/RunButton.test.tsx src/index.css e2e/b0-token-blocks.spec.ts e2e/audit/contrast-pairs.json e2e/audit/canvas-migration-registry.json
git commit -m "feat(web): 运行按钮政版——20px 新箭头+title=生成+新 token 对 --canvas-run-btn-*（深保参考值/浅加深 ≥3:1），b0 登记表/contrast-pairs/registry 变更登记齐套"
```

---

### Task 5: 分辨率 1K（P1d，需求 9）

**Files:**
- Modify: `src/pages/canvas/components/nodes/config-panel/RatioResolutionPopover.tsx:63`
- Modify: `src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`（追加用例）

- [ ] **Step 5.1: 写失败测试**

在 `ImageConfigPanel.test.tsx` 的 ratio 弹层用例区（L218-262 附近）后追加：

```tsx
  it('should render 1K/2K/4K resolution options (需求9)', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-ratio-select'));
    const popup = screen.getByText('分辨率').closest('div');
    expect(screen.getByText('1K')).toBeTruthy();
    expect(screen.getByText('2K')).toBeTruthy();
    expect(screen.getByText('4K')).toBeTruthy();
    expect(popup).toBeTruthy();
  });
```

- [ ] **Step 5.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx -t '1K'`
Expected: FAIL（getByText('1K') 找不到）。

- [ ] **Step 5.3: 实现**

`RatioResolutionPopover.tsx` L63：`{['2K', '4K'].map((res) => (` → `{['1K', '2K', '4K'].map((res) => (`。

- [ ] **Step 5.4: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`
Expected: 全 PASS（默认 resolution '2K' 断言 L201-203 不受影响）。

- [ ] **Step 5.5: Commit**

```bash
git add src/pages/canvas/components/nodes/config-panel/RatioResolutionPopover.tsx src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx
git commit -m "feat(web): 比例/分辨率弹层增加 1K 档（1K/2K/4K）——仅 RatioResolutionPopover，EraseBottomToolbar 等其余入口不动（spec §7-5）"
```

---

### Task 6: 标题双击编辑 + mediaName 唯一真源 + 13px（P2a，需求 7）

**Files:**
- Modify: `src/pages/canvas/components/nodes/ImageGenNode.tsx:250-270`（状态机）+ `:1067-1115`（标题 JSX）+ `:1071-1077`（图标 13px）
- Modify: `src/pages/canvas/components/nodes/ImageGenNode.test.tsx:226-258`（4 条用例改双态 + ghost 用例删除）

说明：ImageExtNode 是 `<ImageGenNode {...props}/>` 透传组件，本改动自动落两类图片节点（spec §2）；其余 4 种节点标题为独立实现，不动。

- [ ] **Step 6.1: 改写测试（先红）**

`ImageGenNode.test.tsx` L226-258 四条标题用例整体替换为：

```tsx
  it('renders static title span from mediaName; no input before double click', () => {
    renderNode();
    expect(screen.queryByLabelText('节点标题')).not.toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('displays mediaName from store (唯一真源——外部来源改名直接生效)', () => {
    mockNodeData.mediaName = '外部标题';
    renderNode();
    expect(screen.getByText('外部标题')).toBeInTheDocument();
    mockNodeData.mediaName = undefined;
  });

  it('double click enters edit mode; blur writes mediaName via updateConfig', () => {
    renderNode();
    fireEvent.doubleClick(screen.getByText('Image'));
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input.value).toBe('Image');
    // 编辑态容器 flex-1（宽度=节点宽−图标/尺寸占位；jsdom 量不到布局，类断言+人工验收，spec §5 P2a）
    expect(input.parentElement?.className).toContain('flex-1');
    fireEvent.change(input, { target: { value: '我的图片' } });
    fireEvent.blur(input);
    expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { mediaName: '我的图片' });
  });

  it('empty blur does not write store and exits edit mode', () => {
    renderNode();
    fireEvent.doubleClick(screen.getByText('Image'));
    const input = screen.getByLabelText('节点标题');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('节点标题')).not.toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('Escape exits edit mode without writing store', () => {
    renderNode();
    fireEvent.doubleClick(screen.getByText('Image'));
    const input = screen.getByLabelText('节点标题');
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('节点标题')).not.toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('title uses 13px font and 13px icon', () => {
    renderNode();
    const span = screen.getByText('Image');
    expect(span.style.fontSize).toBe('13px');
    const icon = span.closest('div')?.querySelector('svg');
    expect(icon?.getAttribute('width')).toBe('13');
  });
```

（原 L251 ghost sizer 用例随机制删除，不迁移。）

- [ ] **Step 6.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`
Expected: 新用例 FAIL（现状常驻 input、focus 模式、12px）。

- [ ] **Step 6.3: 实现——状态机（L250-270 替换）**

```tsx
  // Editable title — mediaName 唯一真源（spec §3.2：显示读 store，draft 仅编辑缓冲）
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef('');
  const mediaName = nodeData?.mediaName ?? 'Image';

  const startEdit = useCallback(() => {
    setDraft(mediaName);
    draftRef.current = mediaName;
    setEditing(true);
  }, [mediaName]);

  const saveTitle = useCallback(() => {
    const trimmed = draftRef.current.trim();
    setEditing(false);
    if (trimmed && trimmed !== mediaName) {
      updateConfig(id, { mediaName: trimmed } as any);
    }
  }, [id, mediaName, updateConfig]);
```

删除原 `label/draft/titleText` 三个定义（L251-252、L270）；`saveTitle` 原定义（L256-263）与 `startEdit`（L265-268）一并被上段替换。注意文件内若其它处引用 `titleText`，一并改为 `mediaName`（grep 确认：仅标题 JSX 使用）。

- [ ] **Step 6.4: 实现——标题 JSX（L1067-1115 替换）**

```tsx
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: nodeWidth, lineHeight: '20px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 13, height: 13 }}>
          <svg width="13" height="13" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* 原 L1074 的 path 原样保留，勿动 */}
            ...原 path...
          </svg>
        </span>
        <div className="relative flex min-w-0 flex-1 items-center">
          {editing ? (
            <input
              ref={titleInputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                draftRef.current = e.target.value;
              }}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') titleInputRef.current?.blur();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder="请输入标题"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              className="nodrag absolute inset-0 w-full h-auto bg-transparent outline-none"
              style={{ fontSize: 13, lineHeight: '20px', minWidth: 0 }}
              aria-label="节点标题"
              maxLength={20}
            />
          ) : (
            <span
              className="nodrag select-none cursor-default truncate"
              style={{ fontSize: 13, lineHeight: '20px' }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
            >
              {mediaName}
            </span>
          )}
        </div>
        {naturalSize && (
          <span className="shrink-0 ml-auto" style={{ fontSize: 10, color: '#777' }}>
            {naturalSize.w} × {naturalSize.h}
          </span>
        )}
      </div>
```

要点：图标 12→13（span 尺寸与 svg width/height 同步）；容器 lineHeight 18px→20px（13px 字号匹配）；幽灵测量 span 机制删除；编辑态保留图标与右侧尺寸文本（拍板"保留占位减宽"），内层 `flex-1` + input `absolute inset-0` → input 宽=节点宽−图标−gap−尺寸占位；Escape 直接 `setEditing(false)`（draft 丢弃即还原，不写 store）；`autoFocus`+`onFocus select()` 实现进入编辑自动聚焦全选。外层 `overflow-hidden whitespace-nowrap` 保留（静态 truncate 生效）。

- [ ] **Step 6.5: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx`
Expected: 全 PASS（含非标题既有用例——mockNodeData 默认无 mediaName → 'Image' 兜底路径不变）。

- [ ] **Step 6.6: 全量回归 + tsc**

Run: `pnpm vitest run && npx tsc -b --noEmit 2>&1 | head -20`
Expected: vitest 全绿；tsc 无新增报错。

- [ ] **Step 6.7: Commit**

```bash
git add src/pages/canvas/components/nodes/ImageGenNode.tsx src/pages/canvas/components/nodes/ImageGenNode.test.tsx
git commit -m "feat(web): 图片节点标题双击编辑+mediaName 唯一真源（修撤销/协作/再生成三类分叉）+13px 字号图标，编辑态保留占位减宽（幽灵测量机制删除）"
```

---

### Task 7: handleMenu.ts 纯函数——守卫/绝对矩形/决策/边 id/clientPoint（P2b-1，需求 10 守卫）

**Files:**
- Create: `src/pages/canvas/components/handleMenu.ts`
- Create: `src/pages/canvas/components/handleMenu.test.ts`

要点：canvasStore 子节点（如分镜组 cell）的 position 是**组内相对坐标**——节点体命中判定必须先沿 parentId 累加祖先 position 解析绝对矩形（`absoluteRectsOf`），否则组内 imageGen 判定全错（最需要"落在节点体不弹"的场景恰好失效）；**group 类型节点过滤**（组是容器非实体节点，往组内空白松手仍应弹菜单——行为裁定随 Task 10 收尾登记 spec）；`decideHandleMenu` 把"决策+载荷组装"一并纳入纯函数（Task 9 接线因此可测）。

- [ ] **Step 7.1: 写失败测试**

创建 `src/pages/canvas/components/handleMenu.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  shouldOpenHandleMenu, decideHandleMenu, absoluteRectsOf,
  isPointOnAnyNode, handleEdgeId, clientPoint,
} from './handleMenu';

const rects = [{ x: 0, y: 0, w: 200, h: 150 }];

const baseArgs = {
  reconnecting: false,
  isValid: null as boolean | null,
  toHandle: null,
  toNode: null,
  nodeType: 'imageGen',
  isLocked: false,
  dragDistancePx: 30,
  flowPoint: { x: 1000, y: 1000 },
  rects,
};

describe('shouldOpenHandleMenu', () => {
  it('① 空白松手+位移达标+imageGen+未锁 → true', () => {
    expect(shouldOpenHandleMenu(baseArgs)).toBe(true);
  });

  it('①′ imageExtGen 同样放行（两类图片节点拍板）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, nodeType: 'imageExtGen' })).toBe(true);
  });

  it('② isValid===true → false（正常连线已建边）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, isValid: true })).toBe(false);
  });

  it('③ toHandle 非 null → false（落在 handle 上，含类型不合法组合）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, isValid: false, toHandle: { id: 'h' } as any })).toBe(false);
  });

  it('③″ toNode 非 null → false', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, toNode: { id: 'n1' } as any })).toBe(false);
  });

  it('③′ flowPoint 落入节点矩形 → false（节点体命中，guard2 承保）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, flowPoint: { x: 100, y: 100 } })).toBe(false);
  });

  it('④ reconnecting → false（边端点重连手势）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, reconnecting: true })).toBe(false);
  });

  it('⑤ 位移 < 5px → false（假拖拽）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, dragDistancePx: 3 })).toBe(false);
  });

  it('⑥ isLocked → false', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, isLocked: true })).toBe(false);
  });

  it('⑦ 非 imageGen/imageExtGen → false', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, nodeType: 'videoGen' })).toBe(false);
    expect(shouldOpenHandleMenu({ ...baseArgs, nodeType: undefined })).toBe(false);
  });
});

describe('absoluteRectsOf', () => {
  it('顶层节点直接取 position；无尺寸节点跳过', () => {
    const nodes = [
      { id: 'n1', type: 'imageGen', position: { x: 10, y: 20 }, measured: { width: 200, height: 150 } },
      { id: 'n2', type: 'textInput', position: { x: 0, y: 0 } },
    ] as any[];
    expect(absoluteRectsOf(nodes)).toEqual([{ x: 10, y: 20, w: 200, h: 150 }]);
  });

  it('组内子节点沿 parentId 累加祖先 position（分镜组 cell 场景）', () => {
    const nodes = [
      { id: 'g1', type: 'group', position: { x: 500, y: 400 }, width: 600, height: 400 },
      { id: 'cell1', type: 'imageGen', parentId: 'g1', position: { x: 100, y: 50 }, measured: { width: 200, height: 150 } },
    ] as any[];
    // group 被过滤；cell 绝对矩形 = (500+100, 400+50)
    expect(absoluteRectsOf(nodes)).toEqual([{ x: 600, y: 450, w: 200, h: 150 }]);
  });
});

describe('isPointOnAnyNode', () => {
  it('点在矩形内 → true；外 → false；空矩形表 → false', () => {
    expect(isPointOnAnyNode({ x: 199, y: 149 }, rects)).toBe(true);
    expect(isPointOnAnyNode({ x: 201, y: 100 }, rects)).toBe(false);
    expect(isPointOnAnyNode({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('decideHandleMenu', () => {
  it('守卫通过 → open + 完整 payload（含 flowPoint 直通）', () => {
    const d = decideHandleMenu({ ...baseArgs, nodeId: 'img1', side: 'source', clientX: 300, clientY: 200 });
    expect(d).toEqual({
      kind: 'open',
      payload: { x: 300, y: 200, nodeId: 'img1', side: 'source', flowPoint: { x: 1000, y: 1000 } },
    });
  });

  it('isValid=true → ignore（正常连线不弹）', () => {
    expect(decideHandleMenu({ ...baseArgs, nodeId: 'img1', side: 'source', clientX: 0, clientY: 0, isValid: true }))
      .toEqual({ kind: 'ignore' });
  });
});

describe('handleEdgeId / clientPoint', () => {
  it('确定性 id 前缀 handle:（不走 auto 通道，spec §3.3）', () => {
    expect(handleEdgeId('a', 'b')).toBe('handle:a:b');
  });
  it('clientPoint 兼容 MouseEvent 与 TouchEvent', () => {
    expect(clientPoint({ clientX: 10, clientY: 20 } as MouseEvent)).toEqual({ x: 10, y: 20 });
    expect(clientPoint({ changedTouches: [{ clientX: 5, clientY: 6 }] } as unknown as TouchEvent)).toEqual({ x: 5, y: 6 });
  });
});
```

- [ ] **Step 7.2: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/handleMenu.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 7.3: 实现**

创建 `src/pages/canvas/components/handleMenu.ts`：

```ts
/** handle 拖拽弹菜单——守卫/决策纯函数与工具（spec 2026-09-26-image-node-panel-redesign §3.3）
 * 守卫顺序承重：reconnecting 必须最先（复位语义）；toNode 由 toHandle 派生、仅覆盖 handle 命中，
 * 节点体命中由 isPointOnAnyNode(绝对矩形) 单独承保。 */

const HANDLE_MENU_NODE_TYPES = new Set(['imageGen', 'imageExtGen']);
const DRAG_THRESHOLD_PX = 5;

export interface HandleMenuNodeLike {
  id: string;
  type?: string;
  parentId?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}

export interface NodeRect { x: number; y: number; w: number; h: number }

/** 解析节点的画布绝对矩形：子节点 position 是组内相对坐标（canvasStore 惯例），
 * 沿 parentId 累加祖先 position；group 是容器非实体节点，过滤之
 * （行为裁定：往组内空白处松手仍弹菜单——Task 10 收尾登记 spec §7）。 */
export function absoluteRectsOf(nodes: HandleMenuNodeLike[]): NodeRect[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absPos = (n: HandleMenuNodeLike, seen = new Set<string>()): { x: number; y: number } => {
    let x = n.position.x;
    let y = n.position.y;
    let cur = n;
    while (cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      cur = parent;
    }
    return { x, y };
  };
  const rects: NodeRect[] = [];
  for (const n of nodes) {
    if (n.type === 'group') continue;
    const w = n.measured?.width ?? n.width;
    const h = n.measured?.height ?? n.height;
    if (!w || !h) continue;
    const { x, y } = absPos(n);
    rects.push({ x, y, w, h });
  }
  return rects;
}

export function isPointOnAnyNode(flowPoint: { x: number; y: number }, rects: NodeRect[]): boolean {
  return rects.some((r) =>
    flowPoint.x >= r.x && flowPoint.x <= r.x + r.w &&
    flowPoint.y >= r.y && flowPoint.y <= r.y + r.h,
  );
}

export interface HandleMenuPayload {
  x: number;
  y: number;
  nodeId: string;
  side: 'source' | 'target';
  flowPoint: { x: number; y: number };
}

export interface HandleMenuGuardArgs {
  reconnecting: boolean;
  isValid: boolean | null;
  toHandle: unknown;
  toNode: unknown;
  nodeType: string | undefined;
  isLocked: boolean;
  dragDistancePx: number;
  flowPoint: { x: number; y: number };
  rects: NodeRect[];
}

export function shouldOpenHandleMenu(args: HandleMenuGuardArgs): boolean {
  if (args.reconnecting) return false;
  if (args.isValid === true) return false;
  if (args.toHandle !== null && args.toHandle !== undefined) return false;
  if (args.toNode !== null && args.toNode !== undefined) return false;
  if (!HANDLE_MENU_NODE_TYPES.has(args.nodeType ?? '')) return false;
  if (args.isLocked) return false;
  if (args.dragDistancePx < DRAG_THRESHOLD_PX) return false;
  if (isPointOnAnyNode(args.flowPoint, args.rects)) return false;
  return true;
}

export type HandleMenuDecision =
  | { kind: 'ignore' }
  | { kind: 'open'; payload: HandleMenuPayload };

/** 决策+载荷组装一并纯函数化：Task 9 的 onConnectEnd 退化为"取 event/state → 调本函数 → open"。 */
export function decideHandleMenu(
  args: HandleMenuGuardArgs & { nodeId: string; side: 'source' | 'target'; clientX: number; clientY: number },
): HandleMenuDecision {
  if (!shouldOpenHandleMenu(args)) return { kind: 'ignore' };
  return {
    kind: 'open',
    payload: {
      x: args.clientX,
      y: args.clientY,
      nodeId: args.nodeId,
      side: args.side,
      flowPoint: args.flowPoint,
    },
  };
}

/** handle 拖拽建边的确定性 id——前缀刻意避开 auto:/auto-out:（那是协作/撤销的通道路由，spec §2.1）；
 * handle: 走 LocalUser 常规通道，与 addNode 同 origin 同撤销步。 */
export function handleEdgeId(sourceNodeId: string, targetNodeId: string): string {
  return `handle:${sourceNodeId}:${targetNodeId}`;
}

export function clientPoint(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('clientX' in e) return { x: e.clientX, y: e.clientY };
  const t = e.changedTouches[0];
  return { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
}
```

（menuStore 的 `HandleMenuState`（Task 8）与本模块 `HandleMenuPayload` 结构一致——保持字段同名同型。）

- [ ] **Step 7.4: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/handleMenu.test.ts`
Expected: 全 PASS。

- [ ] **Step 7.5: Commit**

```bash
git add src/pages/canvas/components/handleMenu.ts src/pages/canvas/components/handleMenu.test.ts
git commit -m "feat(web): handle 拖拽菜单守卫纯函数（reconnecting/isValid/toHandle+绝对矩形节点体判定含组内坐标解析与 group 过滤/类型集合/锁定/位移阈值）+decideHandleMenu 决策载荷+handle: 确定性边 id+clientPoint 触摸兼容"
```

---

### Task 8: menuStore 扩展 + HandleAddNodeMenu 组件（P2b-2，需求 10 菜单）

**Files:**
- Modify: `src/stores/menuStore.ts`
- Create: `src/pages/canvas/components/HandleAddNodeMenu.tsx`
- Create: `src/pages/canvas/components/HandleAddNodeMenu.test.tsx`

- [ ] **Step 8.1: 扩展 menuStore（含双向互斥）**

`menuStore.ts` 全量替换为：

```ts
import { create } from 'zustand';

export interface HandleMenuState {
  x: number;
  y: number;
  nodeId: string;
  side: 'source' | 'target';
  /** 松手点的画布坐标——CanvasView 守卫时经 screenToFlowPosition 换算一次并复用于建节点（spec §3.3） */
  flowPoint: { x: number; y: number };
}

interface MenuState {
  isOpen: boolean;
  position?: { x: number; y: number };
  triggerEl: HTMLButtonElement | null;
  lastMousePos: { x: number; y: number };
  handleMenu?: HandleMenuState;
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  updateMousePos: (pos: { x: number; y: number }) => void;
  open: (pos?: { x: number; y: number }) => void;
  close: () => void;
  toggle: () => void;
  openHandleMenu: (m: HandleMenuState) => void;
  closeHandleMenu: () => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  isOpen: false,
  position: undefined,
  triggerEl: null,
  lastMousePos: { x: 0, y: 0 },
  handleMenu: undefined,
  setTriggerEl: (el) => set({ triggerEl: el }),
  updateMousePos: (pos) => set({ lastMousePos: pos }),
  // 双向互斥（spec §3.3）：右键菜单开时清 handle 菜单
  open: (pos) => set({ isOpen: true, position: pos, handleMenu: undefined }),
  close: () => set({ isOpen: false, position: undefined }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  // 双向互斥另一侧：handle 菜单开时关右键菜单
  openHandleMenu: (m) => set({ handleMenu: m, isOpen: false, position: undefined }),
  closeHandleMenu: () => set({ handleMenu: undefined }),
}));
```

- [ ] **Step 8.2: 写失败测试**

创建 `src/pages/canvas/components/HandleAddNodeMenu.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HandleAddNodeMenu } from './HandleAddNodeMenu';
import { useMenuStore } from '@/stores/menuStore';

const mockAddNode = vi.fn(() => 'new-1'); // 构造时实现：clearAllMocks 只清调用记录、保留 implementation（mockReset 才清），此写法在 beforeEach clearAllMocks 下安全
const mockAddEdge = vi.fn();

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { addNode: mockAddNode, addEdge: mockAddEdge };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    { getState: () => ({ addNode: mockAddNode, addEdge: mockAddEdge }) },
  ),
}));

const openMenu = (side: 'source' | 'target') => {
  useMenuStore.getState().openHandleMenu({
    x: 400, y: 300, nodeId: 'img1', side,
    flowPoint: { x: 1200, y: 800 },
  });
};

describe('HandleAddNodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMenuStore.getState().closeHandleMenu();
    useMenuStore.getState().close();
  });

  it('source 侧渲染 4 项（文本/图片/视频/音频）', () => {
    openMenu('source');
    render(<HandleAddNodeMenu />);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '文本' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '图片' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '视频' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '音频' })).toBeTruthy();
  });

  it('target 侧仅渲染 2 项（文本/图片）', () => {
    openMenu('target');
    render(<HandleAddNodeMenu />);
    expect(screen.getByRole('menuitem', { name: '文本' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '图片' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '视频' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '音频' })).not.toBeInTheDocument();
  });

  it('source 侧选「文本」→ 建节点于松手点-半宽高 + 建边 原→新（handle: 确定性 id）', () => {
    openMenu('source');
    render(<HandleAddNodeMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: '文本' }));
    expect(mockAddNode).toHaveBeenCalledWith('textInput', { x: 1200 - 125, y: 800 - 30 });
    expect(mockAddEdge).toHaveBeenCalledWith('img1', 'new-1', undefined, undefined, 'handle:img1:new-1');
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
  });

  it('target 侧选「图片」→ 建边 新→原', () => {
    openMenu('target');
    render(<HandleAddNodeMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: '图片' }));
    expect(mockAddNode).toHaveBeenCalledWith('imageGen', { x: 1200 - 125, y: 800 - 30 });
    expect(mockAddEdge).toHaveBeenCalledWith('new-1', 'img1', undefined, undefined, 'handle:new-1:img1');
  });

  it('点击背板关闭；Escape 关闭', () => {
    openMenu('source');
    render(<HandleAddNodeMenu />);
    fireEvent.click(screen.getByTestId('handle-add-node-menu-backdrop'));
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
    openMenu('source');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
  });

  it('menuStore 双向互斥：openHandleMenu 关闭 AddNodeMenu 态，open 清 handleMenu', () => {
    useMenuStore.getState().open({ x: 1, y: 1 });
    openMenu('source');
    expect(useMenuStore.getState().isOpen).toBe(false);
    useMenuStore.getState().open({ x: 2, y: 2 });
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
  });
});
```

- [ ] **Step 8.3: 跑红**

Run: `pnpm vitest run src/pages/canvas/components/HandleAddNodeMenu.test.tsx`
Expected: FAIL（组件不存在；openHandleMenu 未定义）。

- [ ] **Step 8.4: 实现 HandleAddNodeMenu**

创建 `src/pages/canvas/components/HandleAddNodeMenu.tsx`：

```tsx
import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useMenuStore } from '@/stores/menuStore';
import { handleEdgeId } from './handleMenu';

/** spec 2026-09-26-image-node-panel-redesign §3.3：handle 拖拽松手弹出的精简添加节点菜单。
 * 关闭机制照抄 AddNodeMenu：背板遮罩 + Escape（不用 document mousedown——避免触发器/关闭序缺陷）。 */

interface MenuItemDef {
  type: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_TEXT = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="8" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2.2" />
    <path d="M11 13H21M11 18H18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const ICON_IMAGE = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="7" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M10.5 21L14.2 16.7L17 19.5L19.2 16.8L22 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12.5" cy="12.5" r="1.5" fill="currentColor" />
  </svg>
);
const ICON_VIDEO = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="8" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M14 13.2V18.8L19 16L14 13.2Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
  </svg>
);
const ICON_AUDIO = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3.5 8v4M7.5 5v10M11.5 7v6M15.5 9v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SOURCE_ITEMS: MenuItemDef[] = [
  { type: 'textInput', label: '文本', icon: ICON_TEXT },
  { type: 'imageGen', label: '图片', icon: ICON_IMAGE },
  { type: 'videoGen', label: '视频', icon: ICON_VIDEO },
  { type: 'audioGen', label: '音频', icon: ICON_AUDIO },
];
const TARGET_ITEMS: MenuItemDef[] = [
  { type: 'textInput', label: '文本', icon: ICON_TEXT },
  { type: 'imageGen', label: '图片', icon: ICON_IMAGE },
];

export function HandleAddNodeMenu() {
  const handleMenu = useMenuStore((s) => s.handleMenu);
  const closeHandleMenu = useMenuStore((s) => s.closeHandleMenu);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!handleMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHandleMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleMenu, closeHandleMenu]);

  // 定位：松手坐标 +8/+8，边界钳制（对齐 AddNodeMenu L167-178）
  useEffect(() => {
    if (!handleMenu || !menuRef.current) return;
    const menuEl = menuRef.current;
    let left = handleMenu.x + 8;
    let top = handleMenu.y + 8;
    const menuHeight = menuEl.offsetHeight;
    const menuWidth = menuEl.offsetWidth;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    if (top < 8) top = 8;
    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 8;
    if (left < 8) left = 8;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }, [handleMenu]);

  const handleItemClick = useCallback((item: MenuItemDef) => {
    const m = useMenuStore.getState().handleMenu;
    if (!m) return;
    const { addNode, addEdge } = useCanvasStore.getState();
    const newId = addNode(item.type, { x: m.flowPoint.x - 125, y: m.flowPoint.y - 30 });
    if (m.side === 'source') {
      addEdge(m.nodeId, newId, undefined, undefined, handleEdgeId(m.nodeId, newId));
    } else {
      addEdge(newId, m.nodeId, undefined, undefined, handleEdgeId(newId, m.nodeId));
    }
    useMenuStore.getState().closeHandleMenu();
  }, []);

  if (!handleMenu) return null;
  const items = handleMenu.side === 'source' ? SOURCE_ITEMS : TARGET_ITEMS;

  return (
    <div
      data-testid="handle-add-node-menu-backdrop"
      className="fixed inset-0 z-[calc(var(--z-panel)-1)]"
      onClick={closeHandleMenu}
      onContextMenu={(e) => { e.preventDefault(); closeHandleMenu(); }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="添加节点"
        data-testid="handle-add-node-menu"
        className="absolute w-[148px] rounded-xl py-1"
        style={{
          backgroundColor: 'var(--canvas-controls-bg)',
          border: '1px solid var(--canvas-controls-border)',
          boxShadow: 'var(--canvas-shadow-menu)',
        }}
      >
        <div className="px-3 pt-1.5 pb-1 text-xs text-text-dim-2">添加节点</div>
        {items.map((item) => (
          <button
            key={item.type}
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm text-text transition-colors hover:bg-overlay-2"
            onClick={() => handleItemClick(item)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.5: 挂载到 page.tsx**

`src/pages/canvas/page.tsx` L307（`<AddNodeMenu ... />` 之后）追加一行：

```tsx
        <HandleAddNodeMenu />
```

并在文件顶部 AddNodeMenu 的 import 旁补：

```tsx
import { HandleAddNodeMenu } from './components/HandleAddNodeMenu';
```

- [ ] **Step 8.6: 跑绿**

Run: `pnpm vitest run src/pages/canvas/components/HandleAddNodeMenu.test.tsx src/pages/canvas/page.test.tsx`
Expected: 全 PASS（page.test 若因新增组件报错，检查其是否需要补 mock——按该文件既有 mock 模式给 HandleAddNodeMenu 加 `vi.mock('./components/HandleAddNodeMenu', () => ({ HandleAddNodeMenu: () => null }))`）。

- [ ] **Step 8.7: Commit**

```bash
git add src/stores/menuStore.ts src/pages/canvas/components/HandleAddNodeMenu.tsx src/pages/canvas/components/HandleAddNodeMenu.test.tsx src/pages/canvas/page.tsx
git commit -m "feat(web): HandleAddNodeMenu 精简添加节点菜单（右4项/左2项，背板+Escape 关闭，建节点中心对齐松手点+handle: 确定性边连线）+menuStore handleMenu 字段双向互斥"
```

---

### Task 9: CanvasView 接线——onConnectStart/End + 重连标志位（P2b-3，需求 10）

**Files:**
- Modify: `src/pages/canvas/components/CanvasView.tsx`（import + 4 个回调 + ReactFlow 4 个 prop）
- Modify: `src/pages/canvas/components/CanvasView.test.tsx`（mock state 补 `addEdge` 键）

说明：本任务是薄接线——决策+载荷已纯函数化（Task 7 `decideHandleMenu`，含 2 条断言），建节点/建边在 Task 8 组件测试以 store mock 断言；ReactFlow 真渲染下 onConnectEnd 无法在 jsdom 合成拖拽手势触发，剩余接线正确性由 tsc + 全量回归 + Task 10 人工验收承保（spec §5 P2b）。

- [ ] **Step 9.1: CanvasView.test mock 补 addEdge 键**

`CanvasView.test.tsx` L51（`addNode: mockAddNode,` 之后）追加：

```ts
        addEdge: mockAddEdge,
```

并在 L9 hoisted 区（`const mockAddNode = vi.hoisted(() => vi.fn());` 之后）追加：

```ts
const mockAddEdge = vi.hoisted(() => vi.fn());
```

同文件 mock 的 `getState()`（L59-62 现仅 `{ pendingMediaFile, requestAddMediaNode }`）补 `nodes` 键（新守卫经 `useCanvasStore.getState().nodes` 取节点表，缺键则一旦触发即 undefined 崩溃）：

```ts
      getState: () => ({
        pendingMediaFile: mockPendingMediaFile,
        requestAddMediaNode: vi.fn(),
        nodes: mockNodes,
      }),
```

跑既有测试确认不回归：`pnpm vitest run src/pages/canvas/components/CanvasView.test.tsx` → 全 PASS。

- [ ] **Step 9.2: 实现 CanvasView 接线**

1. 文件顶部 import 区（既有 `@/stores/...` import 旁）追加：

```tsx
import { clientPoint, decideHandleMenu, absoluteRectsOf } from './handleMenu';
import { useMenuStore } from '@/stores/menuStore';
```

（`useMenuStore` 已被 onPaneContextMenu 经 `useMenuStore.getState()` 使用——检查是否已 import，已 import 则跳过。）

2. 在 `onPaneContextMenu`（L234 附近）之前插入接线回调：

```tsx
  // ── handle 拖拽弹菜单（spec 2026-09-26-image-node-panel-redesign §3.3）──
  // 起点经 ref 写入：onConnectEnd 同 tick 读取，避免闭包旧值
  const handleDragStartRef = useRef<{ x: number; y: number; nodeId: string; handleType: string } | null>(null);
  const reconnectingRef = useRef(false);

  const onConnectStart = useCallback((event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
    const p = clientPoint(event);
    handleDragStartRef.current = {
      x: p.x,
      y: p.y,
      nodeId: params.nodeId ?? '',
      handleType: params.handleType ?? '',
    };
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    // 重连标志必须在 onConnectEnd 开头复位（spec §3.3 守卫 0：事件序 onReconnectStart→onConnectStart→…→此处）
    const wasReconnecting = reconnectingRef.current;
    reconnectingRef.current = false;
    const dragStart = handleDragStartRef.current;
    handleDragStartRef.current = null;
    if (wasReconnecting || !dragStart) return;

    const p = clientPoint(event);
    const flowPoint = screenToFlowPosition(p);
    const nodes = useCanvasStore.getState().nodes;
    const node = nodes.find((n) => n.id === dragStart.nodeId);
    // isLocked 来源=useNodeStore.activeEditNodeId（CanvasView L102-103 既有订阅同一 store，实证勿改读 canvasStore）
    const isLockedNow = useNodeStore.getState().activeEditNodeId !== null;

    const decision = decideHandleMenu({
      reconnecting: wasReconnecting,
      isValid: state?.isValid ?? null,
      toHandle: state?.toHandle ?? null,
      toNode: state?.toNode ?? null,
      nodeType: node?.type,
      isLocked: isLockedNow,
      dragDistancePx: Math.hypot(p.x - dragStart.x, p.y - dragStart.y),
      flowPoint,
      rects: absoluteRectsOf(nodes),
      nodeId: dragStart.nodeId,
      side: dragStart.handleType === 'target' ? 'target' : 'source',
      clientX: p.x,
      clientY: p.y,
    });
    if (decision.kind === 'open') {
      useMenuStore.getState().openHandleMenu(decision.payload);
    }
  }, [screenToFlowPosition]);

  const onReconnectStart = useCallback(() => { reconnectingRef.current = true; }, []);
  // 双保险复位：Esc 取消重连走 cancelConnection、不触发 onConnectEnd（spec §3.3）；正常结束时紧随其后的重复复位无副作用
  const onReconnectEnd = useCallback(() => { reconnectingRef.current = false; }, []);
```

3. 顶部类型 import 补 `FinalConnectionState`（从 `@xyflow/react`；若该泛型类型不直接导出，改从 `@xyflow/system` 导入——两者等价）。`useRef` 未 import 则补。

4. `<ReactFlow>` props（L351 `onConnect={onConnect as any}` 之后）追加：

```tsx
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
```

（若 tsc 对 onConnectEnd 的 FinalConnectionState 泛型报不匹配，参照仓内 `onConnect as any` 先例加 `as any`。）

5. 注意：`useCanvasStore.getState().nodes` / `useNodeStore.getState()` 在回调内取 state（不进依赖数组），避免 nodes 变化导致回调重建；`screenToFlowPosition` 来自 useReactFlow 已在组件内。检查 `useNodeStore` 是否已 import（CanvasView 现有 import 里若无则补 `import { useNodeStore } from '@/stores/nodeStore';`）。

- [ ] **Step 9.3: 类型与回归验证**

Run: `pnpm vitest run src/pages/canvas/components/CanvasView.test.tsx && npx tsc -b --noEmit 2>&1 | head -20`
Expected: 测试全 PASS；tsc 无新增报错。

- [ ] **Step 9.4: Commit**

```bash
git add src/pages/canvas/components/CanvasView.tsx src/pages/canvas/components/CanvasView.test.tsx
git commit -m "feat(web): CanvasView 接线 handle 拖拽弹菜单——onConnectStart/End+重连双复位标志位，守卫走 shouldOpenHandleMenu 纯函数，flowPoint 换算一次复用建节点"
```

---

### Task 10: 收尾门禁 + 浏览器人工验收

**Files:** 无新改动（只跑门禁与人工验收；发现问题时回对应 Task 修复后重跑）

- [ ] **Step 10.1: 全量单测**

Run: `pnpm vitest run`
Expected: 全绿。

- [ ] **Step 10.2: lint-gate（no-color-hex 增量）**

Run: `pnpm lint`
Expected: PASS / 0 new（新增代码未引入新硬编码色；既有 baselined 行未动）。

- [ ] **Step 10.3: css-audit**

Run: `node scripts/css-audit.mjs`
Expected: exit 0。

- [ ] **Step 10.4: contrast-table 自检（新 token 配对回填后）**

Run: `node scripts/contrast-table.mjs`
Expected: 全部通过（Task 4 回填的 expect 值与工具计算一致；若 tolerance 0.01 内不一致，用工具输出值修正 contrast-pairs.json 的 expect 后重跑）。

- [ ] **Step 10.5: token 守卫（b0/b1）**

**前置**：Playwright e2e 需 webServer（build+preview）与登录态 storageState——先试跑 `npx playwright test e2e/b0-token-blocks.spec.ts`；**若环境不可用，静态回退**（等价校验，并在提交说明登记"b0/b1 Playwright 未跑、以静态校验回退"）：

```bash
grep -c "canvas-run-btn-bg" src/index.css   # 期望 2（深块+浅块各一）
grep -n "light {" src/index.css | wc -l     # 期望 1（唯一 .light 块，源序在 :root,.dark 后——Task 4 内联测试已断言）
```

Run: `npx playwright test e2e/b0-token-blocks.spec.ts e2e/b1-token-migration.spec.ts`
Expected: 全绿（新 token 双值已在 b0 DOMAIN 表且无空格；浅值写入唯一 .light 块未另起块）。

- [ ] **Step 10.6: 浏览器人工验收（启动 dev server 后逐项过 spec §8）**

重点手势/视觉项（jsdom 覆盖不到）：
1. 输入区空态悬停 I 光标；chip/命令徽章不是 I 型
2. 数量按钮再点关闭（真实鼠标）
3. 风格/参考按钮 56×56 视觉、与 50px 缩略图同排高差可接受性
4. 运行按钮浅/深主题下灰底黑箭头观感（浅档底 vs 面板底 ≥3:1 以 contrast-table 首跑值为准）
5. 标题：**单击不进入编辑（预期行为变更，非缺陷）**；双击进入（input 右边缘与尺寸文本左缘对齐=节点宽−占位的实宽核验）、Enter/失焦保存、Esc 还原、改名后刷新仍保留、Ctrl+Z 与后续操作同栈回滚
6. 拖拽：右 handle 拖到空白弹 4 项/左 2 项；落在另一节点体上不弹；**落在组内空白处弹菜单（group 过滤裁定）**、组内图片节点体上不弹（绝对坐标解析）；拖边端点重连不弹；Esc 取消重连后再拖仍能弹；点 handle 不拖不弹；锁定态（进入节点编辑模式）不弹；建节点中心对齐松手点且自动连线、Ctrl+Z 节点+边一起撤销
7. 视频节点面板同步出现新工具行（共享组件统一生效）

- [ ] **Step 10.7: spec §7 登记核对（文档侧收尾，不写代码）**

核对 spec `2026-09-26-image-node-panel-redesign.md` §7 与最终实现一致，需要补充/订正的：group 过滤行为裁定（组内空白松手弹菜单——Task 7 裁定补登 §3.3/§7）；浅档终值（若首跑后改 rgb(125) 则订正 §4 表）；VideoConfigPanel:430 英文 aria-label 与本次中文化的不一致已在 §7-7 登记无需动。

- [ ] **Step 10.8: 验收问题修复后终跑 + 最终 Commit（如有修复）**

```bash
pnpm vitest run && pnpm lint && node scripts/css-audit.mjs
```

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：需求 1→Task 2；需求 2→Task 1；需求 3→Task 2；需求 4/5/6→Task 3；需求 7→Task 6；需求 8→Task 4；需求 9→Task 5；需求 10→Task 7/8/9；spec §4 token 管道→Task 4；spec §5 收尾→Task 10。无遗漏。
2. **占位符**：Task 6 Step 6.4 图标 path 以"原 L1074 path 原样保留"指示（保留既有 48×48 图片 path，非新代码）；Task 4 contrast-pairs 条目注明"以文件实际键名为准照抄结构"（文件结构在执行时可见）；其余步骤均含完整代码。
3. **类型一致性**：`shouldOpenHandleMenu`/`isPointOnAnyNode`/`handleEdgeId`/`clientPoint`（Task 7 定义）与 Task 8/9 调用签名一致；`HandleMenuState.flowPoint` 在 menuStore（Task 8）与 CanvasView openHandleMenu 载荷（Task 9）一致；`addNode(type, {x,y})`/`addEdge(s,t,u,u,id)` 与 canvasStore 既有签名一致。
4. **执行顺序**：Task 1（P0）→ 2-5（P1 独立）→ 6-9（P2 依赖递进：6 独立，7→8→9 链式）→ 10 收尾。Task 2-5 之间无依赖可乱序。

