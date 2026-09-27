# Canvas 键盘快捷键面板 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Canvas 左侧 NodePalette 底部增加快捷键按钮，点击后在页面底部居中弹出快捷键参考面板，支持滑入/滑出动画。

**Architecture:** 状态提升到 `CanvasPageInner`，通过 props 传递给 `NodePalette` 和新增的 `KeyboardShortcutsPanel`。面板使用 CSS transition 实现开闭动画，`transitionend` 事件处理关闭后卸载。

**Tech Stack:** React 18 + TypeScript strict + Vitest + @testing-library/react + Tailwind CSS

---

### Task 1: NodePalette 底部增加快捷键按钮

**Files:**
- Create: (test first)
- Modify: `apps/web/src/pages/canvas/components/NodePalette.tsx`
- Modify: `apps/web/src/pages/canvas/components/NodePalette.test.tsx`

- [ ] **Step 1: 写 NodePalette 快捷键按钮的失败测试**

在 `NodePalette.test.tsx` 的 `describe('NodePalette')` 块内追加以下测试（在最后一个 `it(...)` 之后）：

```tsx
describe('shortcuts button', () => {
  it('should render shortcuts button at the bottom', () => {
    renderPalette();
    expect(screen.getByText('快捷键')).toBeInTheDocument();
  });

  it('should call onToggleShortcuts when shortcuts button is clicked', () => {
    const onToggle = vi.fn();
    render(<NodePalette onToggleShortcuts={onToggle} />);
    fireEvent.click(screen.getByText('快捷键'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should render shortcuts button without onToggleShortcuts prop (optional)', () => {
    renderPalette();
    fireEvent.click(screen.getByText('快捷键'));
    // Should not throw
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/NodePalette.test.tsx`
Expected: 3 tests FAIL because "快捷键" text not found

- [ ] **Step 3: 实现 NodePalette 快捷键按钮**

修改 `NodePalette.tsx`：

1. Component 函数签名和 props 改为：
```tsx
interface NodePaletteProps {
  onToggleShortcuts?: () => void;
}

function NodePaletteComponent({ onToggleShortcuts }: NodePaletteProps) {
```

2. 在最后一个 `})` (NODE_TYPES.map 结束) 和底部 hint div 之间插入分隔线和按钮：
```tsx
      <div className="border-t border-[#333] mx-0.5" />
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleShortcuts?.();
        }}
        className="bg-[#252525] border rounded-lg p-2 text-center cursor-pointer hover:border-[#888] transition-colors"
        style={{ borderColor: '#09CAF5' }}
      >
        <div className="text-base mb-0.5">{'⌨️'}</div>
        <div className="text-[10px] text-[#09CAF5] font-bold">快捷键</div>
      </div>
```

3. memo 导出行改为：`export const NodePalette = memo(NodePaletteComponent);`（不变）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/NodePalette.test.tsx`
Expected: All tests PASS (including original 7 + 3 new = 10)

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/canvas/components/NodePalette.tsx apps/web/src/pages/canvas/components/NodePalette.test.tsx
git commit -m "feat: add keyboard shortcuts button to NodePalette"
```

---

### Task 2: 创建 KeyboardShortcutsPanel 组件

**Files:**
- Create: `apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.tsx`
- Create: `apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`

- [ ] **Step 1: 写 KeyboardShortcutsPanel 的失败测试**

新建 `apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';

describe('KeyboardShortcutsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderPanel = (isOpen: boolean, onClose = vi.fn()) =>
    render(<KeyboardShortcutsPanel isOpen={isOpen} onClose={onClose} />);

  it('should render nothing when isOpen is false', () => {
    const { container } = renderPanel(false);
    expect(container.firstChild).toBeNull();
  });

  it('should render the panel when isOpen is true', () => {
    renderPanel(true);
    expect(screen.getByText('创作')).toBeInTheDocument();
    expect(screen.getByText('缩放')).toBeInTheDocument();
    expect(screen.getByText('移动画布')).toBeInTheDocument();
    expect(screen.getByText('其他')).toBeInTheDocument();
  });

  it('should render all 23 shortcut entries', () => {
    renderPanel(true);
    expect(screen.getByText('成组')).toBeInTheDocument();
    expect(screen.getByText('合并分镜组')).toBeInTheDocument();
    expect(screen.getByText('解组')).toBeInTheDocument();
    expect(screen.getByText('连线')).toBeInTheDocument();
    expect(screen.getByText('复制整组')).toBeInTheDocument();
    expect(screen.getByText('生成')).toBeInTheDocument();
    expect(screen.getByText('新建节点')).toBeInTheDocument();
    expect(screen.getByText('节点复制')).toBeInTheDocument();
    expect(screen.getByText('创建副本')).toBeInTheDocument();
    expect(screen.getByText('放大')).toBeInTheDocument();
    expect(screen.getByText('缩小')).toBeInTheDocument();
    expect(screen.getByText('适应画布')).toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('重做')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭快捷键面板');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when clicking outside the panel', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when clicking inside the panel', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);
    const panel = screen.getByText('创作').closest('[data-panel]');
    fireEvent.mouseDown(panel!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should render key cap elements', () => {
    renderPanel(true);
    // Check key cap for Ctrl+G
    const ctrlKeys = screen.getAllByText('Ctrl');
    expect(ctrlKeys.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('Tab')).toBeInTheDocument();
    expect(screen.getByText('Enter')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`
Expected: FAIL — module not found, component not exported

- [ ] **Step 3: 实现 KeyboardShortcutsPanel 组件**

新建 `apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.tsx`：

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  label: string;
  keys: string[];
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: '创作',
    items: [
      { label: '成组', keys: ['Ctrl', 'G'] },
      { label: '合并分镜组', keys: ['Ctrl', 'Alt', 'G'] },
      { label: '解组', keys: ['Ctrl', 'Shift', 'G'] },
      { label: '连线', keys: ['Ctrl', 'L'] },
      { label: '复制整组', keys: ['Ctrl', 'Shift', 'C'] },
      { label: '生成', keys: ['Ctrl', 'Enter'] },
      { label: '新建节点', keys: ['Tab'] },
      { label: '节点复制', keys: ['Alt', '拖动节点'] },
      { label: '创建副本', keys: ['Ctrl', 'Alt', '拖动'] },
    ],
  },
  {
    title: '缩放',
    items: [
      { label: '放大', keys: ['Ctrl', '+'] },
      { label: '缩小', keys: ['Ctrl', '-'] },
      { label: '适应画布', keys: ['Ctrl', '0'] },
      { label: '滚动', keys: ['滚轮·双指'] },
      { label: '鼠标', keys: ['Ctrl', '滚轮'] },
    ],
  },
  {
    title: '移动画布',
    items: [
      { label: '键盘', keys: ['Space', '拖动'] },
      { label: '触控板', keys: ['空格', '双指拖动'] },
      { label: '鼠标', keys: ['中键拖动'] },
      { label: '整理画布', keys: ['Alt', 'Shift', 'F'] },
    ],
  },
  {
    title: '其他',
    items: [
      { label: '撤销', keys: ['Ctrl', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: '删除', keys: ['⌫'] },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  if (children === '+' || children === '-' || children === '⌫') {
    return (
      <span className="flex shrink-0 items-center justify-center w-7 h-7 rounded-lg border border-[#444] text-sm">
        {children}
      </span>
    );
  }
  return (
    <span className="flex h-7 min-w-7 shrink-0 items-center justify-center px-1.5 font-sans text-sm rounded-lg border-[0.5px] border-[#444]">
      {children}
    </span>
  );
}

export function KeyboardShortcutsPanel({ isOpen, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      requestAnimationFrame(() => setClosing(false));
    } else if (visible) {
      setClosing(true);
    }
  }, [isOpen]);

  const handleTransitionEnd = useCallback(() => {
    if (closing) {
      setVisible(false);
      setClosing(false);
    }
  }, [closing]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none"
    >
      <div
        ref={panelRef}
        data-panel
        onTransitionEnd={handleTransitionEnd}
        className={`pointer-events-auto relative box-border rounded-2xl p-5 mx-4 mb-6 max-w-[960px] w-auto backdrop-blur-xl transition-all duration-200 ${closing ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100'}`}
        style={{
          background: 'rgba(38, 38, 38, 0.96)',
          border: '0.5px solid #363636',
          boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.4), 0px 2px 8px rgba(0, 0, 0, 0.3)',
        }}
      >
        <header className="absolute right-3 top-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭快捷键面板"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[#3a3a3a]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 17.1864 17.1854" fill="currentColor" className="text-[#999]">
              <path d="M15.7959 0.117157C15.9521 -0.0390524 16.2051 -0.0390524 16.3613 0.117157L17.0693 0.824189C17.2254 0.980406 17.2255 1.23442 17.0693 1.39059L9.86618 8.59274L17.0693 15.7949C17.2254 15.9511 17.2255 16.2051 17.0693 16.3613L16.3613 17.0683C16.2051 17.2245 15.9521 17.2244 15.7959 17.0683L8.59274 9.86618L1.39059 17.0683C1.23442 17.2245 0.981382 17.2244 0.825165 17.0683L0.117157 16.3613C-0.0390524 16.2051 -0.0390524 15.9511 0.117157 15.7949L7.31931 8.59274L0.117157 1.39059C-0.0390524 1.23439 -0.0390524 0.980398 0.117157 0.824189L0.825165 0.117157C0.981375 -0.0390524 1.23439 -0.0390524 1.39059 0.117157L8.59274 7.31931L15.7959 0.117157Z" />
            </svg>
          </button>
        </header>
        <div className="flex flex-col gap-4 md:flex-row md:gap-5 lg:gap-6 md:items-stretch max-h-[80vh] overflow-y-auto">
          {SECTIONS.map((section, si) => (
            <div key={section.title} className="flex md:flex-row gap-0">
              {si > 0 && <div className="hidden md:block w-px bg-[#363636] shrink-0 self-stretch mr-4 lg:mr-6" />}
              <section className="flex w-full min-w-0 flex-col gap-2 md:w-[160px] lg:w-[190px] shrink-0">
                <h3 className="text-sm font-medium text-[#09CAF5]">{section.title}</h3>
                <div className="flex flex-col gap-2">
                  {section.items.map((item) => (
                    <div key={item.label} className="flex w-full items-center justify-between gap-3">
                      <span className="text-sm text-[#bbb] leading-snug">{item.label}</span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 text-sm shrink-0">
                        {item.keys.map((key, ki) => (
                          <span key={ki}>
                            {ki > 0 && key !== '+' && key !== '-' && item.keys[ki - 1] !== '⌫' && <span className="text-[#888] text-xs mr-1">+</span>}
                            <Kbd>{key}</Kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx`
Expected: All 7 tests PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.tsx apps/web/src/pages/canvas/components/KeyboardShortcutsPanel.test.tsx
git commit -m "feat: add KeyboardShortcutsPanel component with slide animation"
```

---

### Task 3: CanvasPage 集成快捷键状态

**Files:**
- Modify: `apps/web/src/pages/canvas/page.tsx`
- Modify: `apps/web/src/pages/canvas/page.test.tsx`

- [ ] **Step 1: 更新 CanvasPage 测试**

在 `apps/web/src/pages/canvas/page.test.tsx` 的 `describe('CanvasPage')` 块内追加：

```tsx
  it('should render shortcuts button in NodePalette after load', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });
  });

  it('should show shortcuts panel when button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('快捷键'));
    expect(screen.getByText('创作')).toBeInTheDocument();
    expect(screen.getByText('缩放')).toBeInTheDocument();
  });

  it('should close shortcuts panel when close button is clicked', async () => {
    render(<MemoryRouter><CanvasPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('快捷键'));
    expect(screen.getByText('创作')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭快捷键面板'));
    await waitFor(() => {
      expect(screen.queryByText('创作')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/page.test.tsx`
Expected: 3 new tests FAIL

- [ ] **Step 3: 实现 CanvasPage 集成**

修改 `apps/web/src/pages/canvas/page.tsx`：

1. 在 `CanvasPageInner` 函数内添加状态：
```tsx
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
```

2. 将 `<NodePalette />` 改为：
```tsx
        <NodePalette onToggleShortcuts={() => setShortcutsOpen((v) => !v)} />
```

3. 在 `</ReactFlowProvider>` 之前添加面板：
```tsx
        <KeyboardShortcutsPanel
          isOpen={isShortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
```

4. 在文件顶部添加 import：
```tsx
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/page.test.tsx`
Expected: All tests PASS (original + 3 new)

- [ ] **Step 5: 运行全量 Canvas 测试确认无回归**

Run: `cd apps/web && npx vitest run src/pages/canvas/`
Expected: All tests PASS

- [ ] **Step 6: 浏览器验证**

- 打开 `http://localhost:5173`，进入 Canvas 页面
- 确认左侧 NodePalette 底部显示 ⌨️ 快捷键按钮
- 点击按钮 → 面板从底部滑入
- 点击右上角 ✕ → 面板滑出
- 点击画布任意位置 → 面板滑出
- 面板展示 4 列完整快捷键

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx
git commit -m "feat: integrate keyboard shortcuts panel into Canvas page"
```
