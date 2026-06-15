# Image Fullscreen Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Canvas 图片节点实现全屏图片查看功能 — 点击工具栏"放大查看"按钮弹出模态覆盖层，展示大图与元数据信息。

**Architecture:** 提取通用 `BaseFullscreenModal` 基座组件（Portal + 遮罩 + Escape + 滚动锁定 + ARIA + 焦点管理），在其上构建 `ImageFullscreenViewer` 业务组件（图片展示区 + 右侧侧边栏）。`ImageNodeToolbar` 激活现有 ExpandIcon 按钮并通过 `triggerRef` 建立焦点链路，`ImageGenNode` 管理 open 状态并串联数据流。

**Tech Stack:** React + TypeScript (strict) + Tailwind CSS + Vitest + @testing-library/react

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/components/BaseFullscreenModal.tsx` | 通用全屏模态基座 |
| 新建 | `src/components/BaseFullscreenModal.test.tsx` | 基座测试 |
| 新建 | `src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx` | 图片全屏查看器业务组件 |
| 新建 | `src/pages/canvas/components/nodes/ImageFullscreenViewer.test.tsx` | 查看器测试 |
| 修改 | `src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` | IconButton 添加 ref 转发 + ExpandIcon 激活 |
| 修改 | `src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx` | ref 转发 + onFullscreen 测试 |
| 修改 | `src/pages/canvas/components/nodes/ImageGenNode.tsx` | 状态管理 + 数据流串联 |
| 修改 | `src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | 全屏集成测试 |

---

### Task 1: BaseFullscreenModal — 测试

**Files:**
- Create: `apps/web/src/components/BaseFullscreenModal.test.tsx`

- [ ] **Step 1: 编写 BaseFullscreenModal 测试**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BaseFullscreenModal } from './BaseFullscreenModal';

describe('BaseFullscreenModal', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    // Mock rAF so requestAnimationFrame callbacks run synchronously in jsdom
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now());
      return 0;
    });
  });

  it('returns null when open is false', () => {
    const { container } = render(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试弹窗">
        <div data-testid="content">业务内容</div>
      </BaseFullscreenModal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders portal content when open is true', () => {
    render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试弹窗">
        <div data-testid="content">业务内容</div>
      </BaseFullscreenModal>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByText('业务内容')).toBeInTheDocument();
  });

  it('renders dialog role with aria-label and aria-modal', () => {
    render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="全屏查看">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', '全屏查看');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when clicking backdrop (not content)', () => {
    const onClose = vi.fn();
    render(
      <BaseFullscreenModal open={true} onClose={onClose} label="测试">
        <div data-testid="content">内容</div>
      </BaseFullscreenModal>,
    );
    // 点击业务内容不触发关闭
    fireEvent.click(screen.getByTestId('content'));
    expect(onClose).not.toHaveBeenCalled();

    // 点击遮罩触发关闭 — backdrop 是 dialog 的父元素
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape keydown and calls preventDefault + stopImmediatePropagation', () => {
    const onClose = vi.fn();
    render(
      <BaseFullscreenModal open={true} onClose={onClose} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stopImmediateSpy = vi.spyOn(event, 'stopImmediatePropagation');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    document.dispatchEvent(event);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopImmediateSpy).toHaveBeenCalled();
  });

  it('does not call onClose for non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <BaseFullscreenModal open={true} onClose={onClose} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll when open and restores on close', () => {
    const prevOverflow = document.body.style.overflow;

    const { rerender } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe(prevOverflow);
  });

  it('restores body scroll on unmount (cleanup safety)', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('does not modify body overflow when mounted with open=false', () => {
    document.body.style.overflow = 'auto';
    render(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    // overflow unchanged when mounted closed
    expect(document.body.style.overflow).toBe('auto');

    document.body.style.overflow = '';
  });

  it('preserves original overflow through full open/close cycle', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('scroll');

    // Open
    rerender(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    // Close — restore 'scroll'
    rerender(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('scroll');

    document.body.style.overflow = '';
  });

  it('focuses initialFocusRef on open', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const ref = { current: btn };
    const focusSpy = vi.spyOn(btn, 'focus');

    render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试" initialFocusRef={ref}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(btn);
  });

  it('returns focus to triggerRef on close via cleanup', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const triggerRef = { current: btn as HTMLElement | null };
    const focusSpy = vi.spyOn(btn, 'focus');

    const { rerender } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试" triggerRef={triggerRef}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    rerender(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试" triggerRef={triggerRef}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(btn);
  });

  it('returns focus to triggerRef on unmount (safety net)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const triggerRef = { current: btn as HTMLElement | null };
    const focusSpy = vi.spyOn(btn, 'focus');

    const { unmount } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试" triggerRef={triggerRef}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    unmount();
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(btn);
  });
});
```

- [ ] **Step 2: 运行测试验证全部失败**

```bash
cd apps/web && npx vitest run src/components/BaseFullscreenModal.test.tsx
```
Expected: 13 tests FAIL（组件文件尚不存在）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/BaseFullscreenModal.test.tsx
git commit -m "test: add BaseFullscreenModal tests"
```

---

### Task 2: BaseFullscreenModal — 实现

**Files:**
- Create: `apps/web/src/components/BaseFullscreenModal.tsx`

- [ ] **Step 4: 实现 BaseFullscreenModal 组件**

```typescript
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface BaseFullscreenModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  triggerRef?: React.RefObject<HTMLElement>;
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: ReactNode;
}

export function BaseFullscreenModal({
  open,
  onClose,
  label,
  triggerRef,
  initialFocusRef,
  children,
}: BaseFullscreenModalProps) {
  // Scroll lock — only activates when open transitions to true
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Focus management — cleanup handles both close AND unmount uniformly
  useEffect(() => {
    if (!open) return;

    requestAnimationFrame(() => {
      initialFocusRef?.current?.focus();
    });

    return () => {
      triggerRef?.current?.focus();
    };
  }, [open, initialFocusRef, triggerRef]);

  // Escape key — mounted only when open
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: 运行测试验证全部通过**

```bash
cd apps/web && npx vitest run src/components/BaseFullscreenModal.test.tsx
```
Expected: 13 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/BaseFullscreenModal.tsx
git commit -m "feat: add BaseFullscreenModal - 通用全屏模态基座组件"
```

---

### Task 3: ImageFullscreenViewer — 测试

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/ImageFullscreenViewer.test.tsx`

- [ ] **Step 7: 编写 ImageFullscreenViewer 测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageFullscreenViewer } from './ImageFullscreenViewer';
import type { ImageNodeData } from '@/stores/nodeStore';

const mockNodeData: ImageNodeData = {
  style: 'style-1',
  model: 'MJ V8.1',
  quality: '1k',
  ratio: '16:9',
  fileId: 'img-001',
  status: 'done',
  prompt: { text: '一只猫在花园里', allImages: [], referencedImageIds: [] },
};

describe('ImageFullscreenViewer', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ImageFullscreenViewer
        open={false}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the fullscreen dialog when open', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays model, quality, and ratio from nodeData', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('MJ V8.1')).toBeInTheDocument();
    expect(screen.getByText('1k')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
  });

  it('displays prompt text when available', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('一只猫在花园里')).toBeInTheDocument();
  });

  it('displays fallback when prompt is empty', () => {
    const dataWithNoPrompt = {
      ...mockNodeData,
      prompt: { text: '', allImages: [], referencedImageIds: [] },
    };
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={dataWithNoPrompt}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('暂无提示词')).toBeInTheDocument();
  });

  it('displays fallback for all missing metadata fields', () => {
    const emptyData: ImageNodeData = {
      style: '',
      model: '',
      quality: '',
      ratio: '',
      status: 'done',
      prompt: { text: '', allImages: [], referencedImageIds: [] },
    };
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={emptyData}
        triggerRef={{ current: null }}
      />,
    );
    // 模型, 质量, 宽高比, 图片尺寸 = 4 个"未知"
    const unknowns = screen.getAllByText('未知');
    expect(unknowns.length).toBe(4);
  });

  it('shows error state when displayUrl is empty', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl={undefined}
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('图片加载失败')).toBeInTheDocument();
  });

  it('renders close button with correct aria-label', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByLabelText('关闭全屏查看')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={onClose}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    fireEvent.click(screen.getByLabelText('关闭全屏查看'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders download <a> with href and download when displayUrl is valid', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const downloadLink = screen.getByText('下载图片').closest('a');
    expect(downloadLink).toHaveAttribute('href', 'https://example.com/img.jpg');
    expect(downloadLink).toHaveAttribute('download');
    expect(downloadLink?.tabIndex).not.toBe(-1);
  });

  it('renders disabled download <a> (no href, tabIndex=-1, aria-disabled) when displayUrl is empty', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl={undefined}
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const downloadLink = screen.getByText('下载图片').closest('a');
    expect(downloadLink).not.toHaveAttribute('href');
    expect(downloadLink?.tabIndex).toBe(-1);
    expect(downloadLink?.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows loading state initially when displayUrl is valid', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    // <img> is rendered but loading state visible until onLoad
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
  });

  it('alt uses prompt text when available', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe('一只猫在花园里');
  });

  it('alt falls back to "生成的图片" when prompt is empty', () => {
    const noPrompt = { ...mockNodeData, prompt: { text: '', allImages: [], referencedImageIds: [] } };
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={noPrompt}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe('生成的图片');
  });

  it('img has draggable=false and select-none class', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.className).toContain('select-none');
  });

  it('displays image dimensions after onLoad', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true });
    fireEvent.load(img);
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
  });

  it('shows "计算中" for dimensions before onLoad', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/img.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    expect(screen.getByText('计算中')).toBeInTheDocument();
  });

  it('handles image onError by showing failure state', () => {
    render(
      <ImageFullscreenViewer
        open={true}
        onClose={vi.fn()}
        displayUrl="https://example.com/broken.jpg"
        nodeData={mockNodeData}
        triggerRef={{ current: null }}
      />,
    );
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.getByText('图片加载失败')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: 运行测试验证全部失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageFullscreenViewer.test.tsx
```
Expected: 18 tests FAIL（组件文件尚不存在）

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageFullscreenViewer.test.tsx
git commit -m "test: add ImageFullscreenViewer tests"
```

---

### Task 4: ImageFullscreenViewer — 实现

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx`

- [ ] **Step 10: 实现 ImageFullscreenViewer 组件**

```typescript
import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import type { ImageNodeData } from '@/stores/nodeStore';

interface ImageFullscreenViewerProps {
  open: boolean;
  onClose: () => void;
  displayUrl: string | undefined;
  nodeData: ImageNodeData;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

type ImageState = 'loading' | 'success' | 'error';

// 局部滚动条样式（独立类名前缀避免冲突）
const SCROLLBAR_STYLES = `
  .image-fv-sidebar::-webkit-scrollbar { width: 6px; }
  .image-fv-sidebar::-webkit-scrollbar-track { background: transparent; }
  .image-fv-sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
  .image-fv-sidebar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
`;

function ImageFullscreenViewerComponent({
  open,
  onClose,
  displayUrl,
  nodeData,
  triggerRef,
}: ImageFullscreenViewerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [imageState, setImageState] = useState<ImageState>(
    displayUrl ? 'loading' : 'error',
  );
  const [imgSize, setImgSize] = useState<string | null>(null);

  // Reset state when displayUrl changes
  useEffect(() => {
    if (displayUrl) {
      setImageState('loading');
      setImgSize(null);
    } else {
      setImageState('error');
      setImgSize(null);
    }
  }, [displayUrl]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageState('success');
    setImgSize(`${img.naturalWidth} × ${img.naturalHeight}`);
  }, []);

  const handleError = useCallback(() => {
    setImageState('error');
    setImgSize(null);
  }, []);

  const prompt = nodeData.prompt?.text?.trim() || '';
  const model = nodeData.model || '未知';
  const quality = nodeData.quality || '未知';
  const ratio = nodeData.ratio || '未知';
  const sizeDisplay = imgSize || (imageState === 'loading' ? '计算中' : '未知');

  const downloadDisabled = imageState !== 'success' || !displayUrl;

  const imgAlt = prompt || '生成的图片';

  return (
    <BaseFullscreenModal
      open={open}
      onClose={onClose}
      label="全屏查看"
      triggerRef={triggerRef}
      initialFocusRef={closeBtnRef}
    >
      <style>{SCROLLBAR_STYLES}</style>
      <div className="w-full mx-5 max-w-[1400px] h-[calc(100vh-40px)] max-h-[876px] rounded-[16px] bg-[#1C1C1C]/80 border border-white/10 flex overflow-hidden">
        {/* 左侧：图片展示区 */}
        <div className="relative min-h-0 min-w-0 flex-1 flex flex-col items-center justify-center overflow-hidden">
          {imageState === 'loading' && (
            <div className="flex items-center justify-center text-white/40 text-sm">
              加载中...
            </div>
          )}

          {imageState === 'error' && (
            <div className="flex flex-col items-center justify-center gap-2 text-white/40">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span className="text-sm">图片加载失败</span>
            </div>
          )}

          {imageState !== 'error' && displayUrl && (
            <img
              src={displayUrl}
              alt={imgAlt}
              className="max-w-full max-h-full object-contain cursor-zoom-in select-none transition-opacity duration-200"
              draggable={false}
              style={{ opacity: imageState === 'success' ? 1 : 0 }}
              onLoad={handleLoad}
              onError={handleError}
            />
          )}
        </div>

        {/* 右侧：侧边栏 — 纯 flex 流式布局 */}
        <div className="w-[284px] shrink-0 flex flex-col p-5 gap-5">
          {/* 顶部区块：关闭按钮 */}
          <div className="flex justify-end shrink-0">
            <button
              ref={closeBtnRef}
              type="button"
              aria-label="关闭全屏查看"
              className="flex w-8 h-8 justify-center items-center rounded-[8px] hover:bg-white/[0.09] transition-colors cursor-pointer border-0 bg-transparent text-popover-foreground"
              onClick={onClose}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 中间可滚动内容 */}
          <div className="flex-1 min-h-0 image-fv-sidebar overflow-y-auto">
            <div className="flex flex-col gap-5">
              {/* 提示词 */}
              <section className="space-y-2">
                <span className="text-sm font-semibold leading-5 text-neutral-400">提示词</span>
                <div className="relative h-[180px] self-stretch rounded-[12px] bg-white/5 text-sm leading-5 font-normal text-popover-foreground text-left overflow-hidden">
                  <div className="h-full pt-2 pl-3 pb-3 pr-1.5 overflow-y-auto image-fv-sidebar">
                    {prompt || '暂无提示词'}
                  </div>
                </div>
              </section>

              {/* 信息 */}
              <section className="flex flex-col gap-2.5">
                <span className="text-sm font-semibold leading-5 text-neutral-400">信息</span>
                <div className="flex flex-col items-start gap-2 py-2 px-2.5 self-stretch rounded-[12px] bg-white/5">
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">模型:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{model}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">质量:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{quality}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">宽高比:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{ratio}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">图片尺寸:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{sizeDisplay}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* 底部下载按钮 — 统一使用 <a> 标签 */}
          <div className="w-full shrink-0">
            <a
              href={downloadDisabled ? undefined : displayUrl}
              download={!downloadDisabled}
              tabIndex={downloadDisabled ? -1 : 0}
              aria-disabled={downloadDisabled}
              title={downloadDisabled ? '图片加载失败，无法下载' : undefined}
              className={`gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex h-8 py-2 px-0 justify-center items-center self-stretch rounded-[8px] border-[1.33px] border-white/10 bg-[#646464] backdrop-blur-[50px] text-primary-foreground text-xs font-semibold leading-none w-full no-underline select-none ${
                downloadDisabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'shadow cursor-pointer hover:bg-[#757575]'
              }`}
            >
              下载图片
            </a>
          </div>
        </div>
      </div>
    </BaseFullscreenModal>
  );
}

export const ImageFullscreenViewer = memo(ImageFullscreenViewerComponent);
```

- [ ] **Step 11: 运行测试验证通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageFullscreenViewer.test.tsx
```
Expected: 18 tests PASS

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx
git commit -m "feat: add ImageFullscreenViewer - 图片全屏查看器组件"
```

---

### Task 5: ImageNodeToolbar — 测试修改

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

- [ ] **Step 13: 编写新测试（追加到现有 describe 块末尾）**

在 `describe('ImageNodeToolbar', () => {` 的最后一个 `it(...)` 之后（第 327 行附近），追加：

```typescript
  // ── onFullscreen + triggerRef 测试 ──

  it('calls onFullscreen when "放大查看" button is clicked', () => {
    setupPortalTarget();
    const onFullscreen = vi.fn();
    render(<ImageNodeToolbar {...defaultProps} onFullscreen={onFullscreen} />);
    fireEvent.click(screen.getByLabelText('放大查看'));
    expect(onFullscreen).toHaveBeenCalledTimes(1);
    cleanupPortalTarget();
  });

  it('放大查看 button forwards triggerRef to button element', () => {
    setupPortalTarget();
    const ref = { current: null as HTMLButtonElement | null };
    render(<ImageNodeToolbar {...defaultProps} onFullscreen={vi.fn()} triggerRef={ref} />);
    const btn = screen.getByLabelText('放大查看');
    expect(ref.current).toBe(btn);
    cleanupPortalTarget();
  });

  it('放大查看 button is not shown in upload-only mode (no image)', () => {
    setupPortalTarget();
    render(<ImageNodeToolbar {...defaultProps} fileId={undefined} referenceImage={undefined} />);
    expect(screen.queryByLabelText('放大查看')).not.toBeInTheDocument();
    cleanupPortalTarget();
  });
```

- [ ] **Step 14: 运行测试验证新增失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx -t "onFullscreen|triggerRef|upload-only"
```
Expected: 3 tests FAIL（onFullscreen + triggerRef 尚未实现）

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
git commit -m "test: add onFullscreen + triggerRef tests for ImageNodeToolbar"
```

---

### Task 6: ImageNodeToolbar — 修改

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`

- [ ] **Step 16: 重写 IconButton 为 forwardRef**

将 `IconButton` 函数（line 147-167）用 `React.forwardRef` 重写，支持标准 ref 转发：

```typescript
// 需要在文件头部已有 import 中添加 forwardRef：
import { memo, useState, useEffect, useMemo, type ReactNode, forwardRef } from 'react';

interface IconButtonProps {
  icon: ReactNode;
  ariaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({
  icon, ariaLabel, onClick, disabled, className = '',
}, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      tabIndex={0}
      disabled={disabled}
      onClick={onClick}
      className={`${BTN_CLASS} flex items-center justify-center border-0 rounded-lg p-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
      style={{ backgroundColor: BTN_BG, color: ICON_COLOR }}
    >
      {icon}
    </button>
  );
});
```

- [ ] **Step 17: 修改 ImageNodeToolbarProps 添加 onFullscreen + triggerRef**

```typescript
// line 6-17
interface ImageNodeToolbarProps {
  nodeId: string;
  fileId?: string;
  referenceImage?: string;
  selected: boolean;
  onUpload?: () => void;
  onRotateMirror?: () => void;
  onCrop?: () => void;
  onOutpaint?: () => void;
  onErase?: () => void;
  onRedraw?: () => void;
  onFullscreen?: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}
```

- [ ] **Step 18: 修改函数参数解构**

```typescript
// line 202-213
function ImageNodeToolbarComponent({
  nodeId,
  fileId,
  referenceImage,
  selected,
  onUpload = () => {},
  onRotateMirror,
  onCrop,
  onOutpaint,
  onErase,
  onRedraw,
  onFullscreen,
  triggerRef,
}: ImageNodeToolbarProps) {
```

- [ ] **Step 19: 激活 ExpandIcon 按钮（line 338）**

将：
```typescript
<IconButton icon={<ExpandIcon />} ariaLabel="放大查看" />
```

改为：
```typescript
<IconButton icon={<ExpandIcon />} ariaLabel="放大查看" onClick={onFullscreen} ref={triggerRef} />
```

- [ ] **Step 20: 运行全部 ImageNodeToolbar 测试验证通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
```
Expected: 所有已有测试 + 3 新测试 PASS

- [ ] **Step 21: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx
git commit -m "feat: activate fullscreen button in ImageNodeToolbar with onFullscreen + triggerRef"
```

---

### Task 7: ImageGenNode — 集成

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] **Step 22: 修改 ImageGenNode 组件**

**a) 添加 import（在现有 imports 之后）：**

```typescript
import { ImageFullscreenViewer } from './ImageFullscreenViewer';
```

**b) 添加状态、refs 和稳定回调（在现有 useState 声明附近，约 line 88-89 之后）：**

```typescript
const [fullscreenOpen, setFullscreenOpen] = useState(false);
const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);

const handleOpenFullscreen = useCallback(() => {
  setFullscreenOpen(true);
}, []);

const handleCloseFullscreen = useCallback(() => {
  setFullscreenOpen(false);
}, []);
```

**c) 在 `<ImageNodeToolbar>` 添加 props（line 747-758）：**

```typescript
<ImageNodeToolbar
  nodeId={id}
  fileId={fileId}
  referenceImage={referenceImage}
  selected={selected ?? false}
  onUpload={() => fileInputRef.current?.click()}
  onRotateMirror={handleRotateMirror}
  onCrop={() => enterEditMode('crop')}
  onOutpaint={() => enterEditMode('outpaint')}
  onErase={() => enterEditMode('erase')}
  onRedraw={() => enterEditMode('redraw')}
  onFullscreen={handleOpenFullscreen}
  triggerRef={fullscreenTriggerRef}
/>
```

**d) 在 JSX return 末尾（ImageNodeToolbar 调用之后）添加 FullscreenViewer：**

```typescript
<ImageFullscreenViewer
  open={fullscreenOpen}
  onClose={handleCloseFullscreen}
  displayUrl={displayUrl ?? undefined}
  nodeData={nodeData}
  triggerRef={fullscreenTriggerRef}
/>
```

`displayUrl` 在 line 72-74 定义为 `const displayUrl = resultUrl || refPreviewUrl;`，类型为 `string | null`，`?? undefined` 将其转为 `string | undefined`。

- [ ] **Step 23: 运行 ImageGenNode 测试验证无回归**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx
```
Expected: 所有已有测试 PASS

- [ ] **Step 24: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx
git commit -m "feat: integrate ImageFullscreenViewer into ImageGenNode"
```

---

### Task 8: 浏览器手动验证

- [ ] **Step 25: 启动 dev server 并验证功能**

```bash
cd apps/web && npm run dev
```

在浏览器中验证：
1. 进入 Canvas 页面，选中图片节点 → 工具栏显示"放大查看"按钮
2. 点击"放大查看" → 全屏弹窗打开，图片居中，body 不可滚动
3. 侧边栏显示正确的提示词、模型、质量、宽高比、图片尺寸
4. 点击关闭按钮 / 遮罩空白 / Escape → 弹窗关闭，焦点归还原按钮
5. 弹窗关闭后 body 滚动恢复
6. 下载按钮可点击 → 触发下载或新标签页
7. 无图片节点 → 工具栏不显示放大查看按钮（upload-only mode）
8. 弹窗打开时删除节点 → 弹窗正常卸载无残留

- [ ] **Step 26: 最终 Commit（如有调整）**

---

## Self-Review

**1. Spec coverage:**
- [x] 遮罩 `onClick` + `e.target === e.currentTarget` — Task 2 Step 4 实现
- [x] body 滚动锁定（仅 `open=true` 时生效） — Task 2 Step 4 useEffect
- [x] 图片三态互斥渲染 — Task 4 Step 10
- [x] 全元数据空值兜底 — Task 4 Step 10
- [x] `downloadDisabled` 时 `<a>` 移除 `href` + `tabIndex={-1}` + `aria-disabled` — Task 4 Step 10
- [x] `displayUrl` 变更时重置状态 — Task 4 Step 10 useEffect
- [x] 侧边栏 flex 流式布局（shrink-0 + flex-1 scroll + shrink-0） — Task 4 Step 10
- [x] 关闭按钮 `w-8 h-8` + `aria-label="关闭全屏查看"` — Task 4 Step 10
- [x] `open=false` 返回 `null` — Task 2 Step 4
- [x] 焦点时序（cleanup 统一处理归还） — Task 2 Step 4
- [x] Escape `preventDefault` + `stopImmediatePropagation` — Task 2 Step 4 + Task 1 Step 1 测试断言
- [x] scroll 值无 useRef（useEffect closure `prevOverflow`） — Task 2 Step 4
- [x] ARIA 中性 div: `role="dialog"` + `aria-modal` + `aria-label` — Task 2 Step 4
- [x] 图片 `draggable={false}` + `select-none` — Task 4 Step 10
- [x] 图片 `alt` 三态 — Task 4 Step 10
- [x] 下载统一 `<a>` 标签 — Task 4 Step 10
- [x] 节点卸载 cleanup 兜底还原 — Task 2 Step 4
- [x] 选中状态联动（弹窗保持打开） — 天然实现（fullscreenOpen 独立于 selected）
- [x] triggerRef 完整链路：ImageGenNode → ImageNodeToolbar → IconButton → button DOM — Task 6 + Task 7

**2. Placeholder scan:** 无 TBD/TODO/实现后补充 等占位符。

**3. Type consistency:**
- `triggerRef: React.RefObject<HTMLButtonElement>` — 从 ImageGenNode → ImageNodeToolbar → IconButton (forwardRef) → `<button ref>` 全链路一致
- `handleOpenFullscreen` / `handleCloseFullscreen` 用 `useCallback` 稳定引用，避免 useEffect 频繁重绑定
- `imgAlt` 简化为 `prompt || '生成的图片'`，错误状态文字由占位区承载，无死代码
- `initialFocusRef: React.RefObject<HTMLElement>` — closeBtnRef 为 `useRef<HTMLButtonElement>(null)`，兼容 `HTMLElement`
- `ImageNodeData` 来自 `@/stores/nodeStore`
- `displayUrl: string | undefined` 从 `string | null` 通过 `?? undefined` 转换
