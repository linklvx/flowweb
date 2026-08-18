# 工作空间项目文件夹（前端 UI）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写 /works 工作空间页面：项目文件夹 + 画布网格/列表管理，文件夹为 mock 数据，画布走真实 API。

**Architecture:** `pages/workspace/` 新目录，WorkspacePage 容器装配两个 hook（useWorkspaceData 数据层 / useFolderNavigation URL 同步）与展示组件。归属关系在 hook 内单源合并（localFolderMap 优先），组件只读 `canvas.folderId`。

**Tech Stack:** React 18 + TypeScript strict + Tailwind 3 + antd 5（Dropdown/Modal/message/Input/Tooltip）+ @ant-design/icons + dayjs（已是直接依赖 ^1.11.21）+ Vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-08-18-workspace-project-folders-design.md`

**测试命令**（均在本仓库根执行）：`cd apps/web && pnpm vitest run <路径>`；全量 `pnpm test`。

**约定：** 所有新文件在 `apps/web/src/pages/workspace/` 下（下文省略前缀）。测试文件放 `__tests__/`。每任务严格 红→绿→提交。

---

### Task 1: types.ts + utils（gradient / time）

**Files:**
- Create: `types.ts`
- Create: `utils/gradient.ts`
- Create: `utils/time.ts`
- Test: `__tests__/utils.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/utils.test.ts
import { describe, it, expect } from 'vitest';
import { getCanvasGradient } from '../utils/gradient';
import { formatRelativeTime } from '../utils/time';

describe('getCanvasGradient', () => {
  it('同 id 返回相同渐变（确定性）', () => {
    expect(getCanvasGradient('abc')).toBe(getCanvasGradient('abc'));
  });
  it('不同 id 高概率返回不同渐变', () => {
    expect(getCanvasGradient('a')).not.toBe(getCanvasGradient('b'));
  });
  it('返回 HSL 双色 linear-gradient 字符串', () => {
    expect(getCanvasGradient('x')).toMatch(/^linear-gradient\(135deg, hsl\(\d+, 70%, 75%\), hsl\(\d+, 70%, 55%\)\)$/);
  });
  it('空字符串与特殊字符 id 不报错', () => {
    expect(() => getCanvasGradient('')).not.toThrow();
    expect(() => getCanvasGradient('🦠../@')).not.toThrow();
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-18T12:00:00');
  it('3 小时前', () => {
    expect(formatRelativeTime('2026-08-18T09:00:00', now)).toBe('3 小时前');
  });
  it('2 个月前', () => {
    expect(formatRelativeTime('2026-06-10T12:00:00', now)).toBe('2 个月前');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/utils.test.ts`
Expected: FAIL — `Cannot find module '../utils/gradient'`

- [ ] **Step 3: 写实现**

```typescript
// types.ts
export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // 自引用，一期恒 null（根级）
  workspaceId: string;     // 一期恒 'personal'
  createdAt: string;
  updatedAt: string;
}

export interface FolderViewModel extends Folder {
  canvasCount: number;
  thumbnails: string[]; // 合法 CSS background 值：url("...") 或 linear-gradient(...)
}

export interface Canvas {
  id: string; // Template id；占位记录为 `placeholder-${projectId}`
  name: string;
  coverUrl: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  folderId: string | null; // null = 根目录
  isPlaceholder?: boolean;
}

export type WorkspaceItem =
  | { type: 'folder'; data: FolderViewModel }
  | { type: 'canvas'; data: Canvas };

export type ViewMode = 'grid' | 'list';
export type FilterKind = 'all' | 'folders' | 'canvases';
```

```typescript
// utils/gradient.ts
export function getCanvasGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue}, 70%, 75%), hsl(${hue}, 70%, 55%))`;
}
```

```typescript
// utils/time.ts
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);

// 局部指定 zh-cn locale，不污染全局 dayjs（antd 内部也使用 dayjs）
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  return dayjs(iso).locale('zh-cn').from(dayjs(now).locale('zh-cn'));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/utils.test.ts`
Expected: PASS（5 个用例）。若相对时间文案不符，以 dayjs zh-cn 实际输出修正断言。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/types.ts apps/web/src/pages/workspace/utils/ apps/web/src/pages/workspace/__tests__/utils.test.ts
git commit -m "feat(workspace): add types and gradient/time utils"
```

---

### Task 2: fixtures.ts（mock 文件夹 + 初始归属）

**Files:**
- Create: `fixtures.ts`
- Test: `__tests__/fixtures.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { MOCK_FOLDERS, buildInitialFolderMap } from '../fixtures';

describe('fixtures', () => {
  it('预置 2 个根级个人文件夹', () => {
    expect(MOCK_FOLDERS).toHaveLength(2);
    expect(MOCK_FOLDERS.every((f) => f.parentId === null && f.workspaceId === 'personal')).toBe(true);
  });
  it('前 2 个画布归 folder-demo-1，第 3-4 个归 folder-demo-2，其余不归属', () => {
    const map = buildInitialFolderMap(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(map).toEqual({
      c1: 'folder-demo-1',
      c2: 'folder-demo-1',
      c3: 'folder-demo-2',
      c4: 'folder-demo-2',
    });
  });
  it('空画布列表返回空对象', () => {
    expect(buildInitialFolderMap([])).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/fixtures.test.ts`
Expected: FAIL — `Cannot find module '../fixtures'`

- [ ] **Step 3: 写实现**

```typescript
// fixtures.ts
import type { Folder } from './types';

// TODO: 后端阶段整体删除，替换为真实文件夹 API
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

export const MOCK_FOLDERS: Folder[] = [
  { id: 'folder-demo-1', name: '未命名文件夹', parentId: null, workspaceId: 'personal', createdAt: iso(2), updatedAt: iso(2) },
  { id: 'folder-demo-2', name: '项目文件夹', parentId: null, workspaceId: 'personal', createdAt: iso(3), updatedAt: iso(3) },
];

// 初始归属：按画布加载顺序分配（前 2 → folder-demo-1，第 3-4 → folder-demo-2）
export function buildInitialFolderMap(canvasIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  canvasIds.slice(0, 2).forEach((id) => { map[id] = 'folder-demo-1'; });
  canvasIds.slice(2, 4).forEach((id) => { map[id] = 'folder-demo-2'; });
  return map;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/fixtures.ts apps/web/src/pages/workspace/__tests__/fixtures.test.ts
git commit -m "feat(workspace): add mock folder fixtures"
```

---

### Task 3: FolderStackPreview（标志性视觉，snapshot 锁定）

**Files:**
- Create: `components/FolderStackPreview.tsx`
- Test: `__tests__/FolderStackPreview.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/FolderStackPreview.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FolderStackPreview } from '../components/FolderStackPreview';

describe('FolderStackPreview', () => {
  it('渲染 3 张堆叠卡片', () => {
    const { container } = render(<FolderStackPreview thumbnails={['linear-gradient(red, blue)']} />);
    const cards = container.querySelectorAll('[data-testid="stack-card"]');
    expect(cards).toHaveLength(3);
  });
  it('thumbnails 依次作为卡片背景，不足 3 张用白色系渐变兜底', () => {
    const { container } = render(<FolderStackPreview thumbnails={['linear-gradient(red, blue)']} />);
    const cards = Array.from(container.querySelectorAll('[data-testid="stack-card"]'));
    // jsdom/cssom 对 gradient 的序列化不稳定，用 getAttribute('style') 做子串断言
    expect(cards[0].getAttribute('style')).toContain('linear-gradient');
    expect(cards[0].getAttribute('style')).toContain('red');
    expect(cards[1].getAttribute('style')).toContain('#CCCCCC');
    expect(cards[2].getAttribute('style')).toContain('#939E9E');
  });
  it('snapshot 锁定 DOM 结构（标志性视觉）', () => {
    const { asFragment } = render(<FolderStackPreview thumbnails={[]} />);
    expect(asFragment()).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/FolderStackPreview.test.tsx`
Expected: FAIL — `Cannot find module '../components/FolderStackPreview'`

- [ ] **Step 3: 写实现**

```tsx
// components/FolderStackPreview.tsx
const FALLBACK = 'linear-gradient(#CCCCCC 0%, #939E9E 100%)';

// 错位参数还原参考效果图：left%, top%, rotate deg
const POSITIONS = [
  { left: '5.6%', top: '37.9%', rotate: -15, z: 1 },
  { left: '31.3%', top: '18.5%', rotate: 0, z: 2 },
  { left: '58.5%', top: '24.6%', rotate: 15, z: 3 },
];

// 花瓣图标（参考效果图，stroke #646464）
const PetalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" style={{ stroke: '#646464' }}>
    <path d="M11.2077 11.0832C13.7219 11.0832 15.7601 9.04507 15.7601 6.53088C15.7601 4.01668 13.7219 1.97852 11.2077 1.97852C8.6935 1.97852 6.65533 4.01668 6.65533 6.53088C6.65533 9.04507 8.6935 11.0832 11.2077 11.0832Z" strokeWidth="1.06" />
    <path d="M2.05883 7.07063C2.40649 5.06634 4.30083 3.70985 6.31403 4.03225C8.31238 4.35169 9.68225 6.2074 9.41481 8.20129C9.41481 8.34911 9.51357 8.81255 9.57973 9.03629C9.77436 9.69448 10.1844 10.6335 11.015 11.721C12.2615 13.3554 11.948 15.691 10.3152 16.9375C8.68085 18.1841 6.34524 17.8721 5.09869 16.2378C2.41541 12.7239 1.71413 9.22201 2.0514 7.11817L2.05883 7.07063Z" strokeWidth="1.06" />
    <path d="M8.52786 8.98262L7.26662 12.7829C6.82516 14.1131 7.54561 15.5493 8.87578 15.9907L12.6761 17.252C14.0062 17.6934 15.4424 16.973 15.8839 15.6428L17.1451 11.8425C17.5866 10.5124 16.8662 9.07616 15.536 8.6347L11.7357 7.37346C10.4055 6.932 8.96932 7.65244 8.52786 8.98262Z" strokeWidth="1.06" />
  </svg>
);

interface FolderStackPreviewProps {
  thumbnails: string[]; // 合法 CSS background 值
}

export function FolderStackPreview({ thumbnails }: FolderStackPreviewProps) {
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4 / 3', background: 'linear-gradient(136deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%), rgb(29, 36, 42)', borderRadius: 12 }}>
      <div className="absolute inset-0" style={{ perspective: '400px' }}>
        {POSITIONS.map((p, i) => (
          <div key={i} className="absolute" data-testid="stack-card"
            style={{ width: '37.3%', left: p.left, top: p.top, zIndex: p.z, transform: `rotate(${p.rotate}deg)` }}>
            <div className="relative w-full rounded-xl outline outline-1 outline-[#CCCCCC]/50 shadow-[-2px_-1px_10.5px_rgba(0,0,0,0.4)]"
              style={{ aspectRatio: '100 / 134', background: thumbnails[i] ?? FALLBACK }}>
              <div className="absolute left-2 top-2"><PetalIcon /></div>
            </div>
          </div>
        ))}
      </div>
      {/* 底部玻璃凹槽（口袋造型 mask + 模糊） */}
      <div className="absolute left-0 right-0 bottom-0 z-10 pointer-events-none"
        style={{
          height: '45%',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          maskImage: `url("data:image/svg+xml,%3Csvg width='284' height='116' viewBox='0 0 284 116' preserveAspectRatio='none' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 12C0 5.37258 5.37258 0 12 0H97.5617C103.047 0 108.435 1.4556 113.174 4.2182L137.578 18.4446C141.095 20.4942 145.092 21.5742 149.162 21.5742H272C278.627 21.5742 284 26.9468 284 33.5742V100C284 108.837 276.837 116 268 116H16C7.16345 116 0 108.837 0 100V12Z' fill='black'/%3E%3C/svg%3E")`,
          maskSize: '100% 100%',
          maskRepeat: 'no-repeat',
          background: 'rgba(89, 103, 107, 0.3)',
        }} />
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/FolderStackPreview.test.tsx`
Expected: PASS（3 用例 + 生成 `__tests__/__snapshots__/`）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/components/FolderStackPreview.tsx apps/web/src/pages/workspace/__tests__/
git commit -m "feat(workspace): add folder stack preview component"
```

---

### Task 4: InlineRename + CanvasCard

**Files:**
- Create: `components/InlineRename.tsx`
- Create: `components/CanvasCard.tsx`
- Test: `__tests__/CanvasCard.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/CanvasCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasCard } from '../components/CanvasCard';
import type { Canvas } from '../types';

const base: Canvas = {
  id: 'c1', name: '画布 1', coverUrl: null, isPublic: false,
  createdAt: '2026-08-18T09:00:00', updatedAt: '2026-08-18T09:00:00', folderId: null,
};

function renderCard(canvas: Canvas, overrides?: Partial<Parameters<typeof CanvasCard>[0]>) {
  const props = {
    canvas,
    onClick: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onTogglePublic: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CanvasCard {...props} />) };
}

describe('CanvasCard', () => {
  it('渲染标题与「编辑于」相对时间', () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00'));
    renderCard(base);
    expect(screen.getByText('画布 1')).toBeInTheDocument();
    expect(screen.getByText(/编辑于/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('点击卡片触发 onClick（透传，路由由页面层分流）', () => {
    const { props } = renderCard(base);
    fireEvent.click(screen.getByTestId('canvas-card-c1'));
    expect(props.onClick).toHaveBeenCalledWith(base);
  });

  it('普通画布菜单含 4 项；占位画布菜单仅「删除」', () => {
    renderCard(base);
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('重命名')).toBeInTheDocument();
    expect(screen.getByText('移动到文件夹')).toBeInTheDocument();
    expect(screen.getByText('设为公开')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('占位画布：草稿角标 + 菜单仅删除 + 菜单无 API 项', () => {
    renderCard({ ...base, isPlaceholder: true, id: 'placeholder-p1' });
    expect(screen.getByText('草稿')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.queryByText('移动到文件夹')).not.toBeInTheDocument();
    expect(screen.queryByText('设为公开')).not.toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('isPublic 时显示「公开」标签', () => {
    renderCard({ ...base, isPublic: true });
    expect(screen.getByText('公开')).toBeInTheDocument();
  });

  it('hover 铅笔进入编辑，回车确认调用 onRename', () => {
    const { props } = renderCard(base);
    fireEvent.click(screen.getByLabelText('重命名画布'));
    const input = screen.getByDisplayValue('画布 1');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith('c1', '新名字');
  });

  it('Esc 取消不调用 onRename', () => {
    const { props } = renderCard(base);
    fireEvent.click(screen.getByLabelText('重命名画布'));
    const input = screen.getByDisplayValue('画布 1');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByText('画布 1')).toBeInTheDocument();
  });

  it('菜单「重命名」同样进入编辑态', () => {
    renderCard(base);
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(screen.getByDisplayValue('画布 1')).toBeInTheDocument();
  });

  it('variant="list" 渲染紧凑行（含菜单）', () => {
    const { props } = renderCard(base, { variant: 'list' });
    expect(screen.getByTestId('canvas-card-c1').className).toContain('h-16');
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('删除'));
    expect(props.onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/CanvasCard.test.tsx`
Expected: FAIL — `Cannot find module '../components/CanvasCard'`

- [ ] **Step 3: 写实现**

```tsx
// components/InlineRename.tsx（受控组件：编辑态由父级管理）
import { useEffect, useState } from 'react';
import { Input } from 'antd';
import { EditOutlined } from '@ant-design/icons';

interface InlineRenameProps {
  value: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onConfirm: (next: string) => void;
  ariaLabel: string;
}

export function InlineRename({ value, editing, onEditingChange, onConfirm, ariaLabel }: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (editing) setDraft(value); }, [editing, value]);

  const commit = () => {
    onEditingChange(false);
    if (draft.trim() && draft !== value) onConfirm(draft.trim());
  };

  if (editing) {
    return (
      <Input
        size="small" autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { onEditingChange(false); setDraft(value); }
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="inline-rename-input"
      />
    );
  }
  return (
    <span className="group/name flex items-center min-w-0">
      <span className="text-sm font-semibold truncate cursor-text">{value}</span>
      <button
        aria-label={ariaLabel}
        className="opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 p-0.5 ml-1 text-white/60 shrink-0 bg-transparent border-none cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onEditingChange(true); }}
      >
        <EditOutlined style={{ fontSize: 12 }} />
      </button>
    </span>
  );
}
```

```tsx
// components/CanvasCard.tsx
import { useState } from 'react';
import { Dropdown, Tooltip } from 'antd';
import { DeleteOutlined, MoveToInboxOutlined, EditOutlined, EyeOutlined, EyeInvisibleOutlined, MoreOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { Canvas } from '../types';
import { getCanvasGradient } from '../utils/gradient';
import { formatRelativeTime } from '../utils/time';
import { InlineRename } from './InlineRename';

interface CanvasCardProps {
  canvas: Canvas;
  variant?: 'grid' | 'list';
  onClick: (canvas: Canvas) => void;
  onRename: (id: string, name: string) => void;
  onMove: (canvas: Canvas) => void;
  onTogglePublic: (id: string) => void;
  onDelete: (canvas: Canvas) => void;
}

export function CanvasCard({ canvas, variant = 'grid', onClick, onRename, onMove, onTogglePublic, onDelete }: CanvasCardProps) {
  const [renaming, setRenaming] = useState(false);
  const background = canvas.coverUrl ? `url("${canvas.coverUrl}")` : getCanvasGradient(canvas.id);

  const menuItems: MenuProps['items'] = canvas.isPlaceholder
    ? [{ key: 'delete', label: '删除', icon: <DeleteOutlined /> }]
    : [
        { key: 'rename', label: '重命名', icon: <EditOutlined /> },
        { key: 'move', label: '移动到文件夹', icon: <MoveToInboxOutlined /> },
        { key: 'public', label: canvas.isPublic ? '设为私有' : '设为公开', icon: canvas.isPublic ? <EyeInvisibleOutlined /> : <EyeOutlined /> },
        { key: 'delete', label: '删除', icon: <DeleteOutlined /> },
      ];

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'delete') onDelete(canvas);
    if (key === 'rename') setRenaming(true);
    if (key === 'move') onMove(canvas);
    if (key === 'public') onTogglePublic(canvas.id);
  };

  const menuButton = (
    <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={['click']}>
      <button
        aria-label="更多操作"
        onClick={(e) => e.stopPropagation()}
        className="p-1.5 rounded-md text-white/80 border-none cursor-pointer z-30 bg-transparent hover:bg-white/10"
      >
        <MoreOutlined />
      </button>
    </Dropdown>
  );

  if (variant === 'list') {
    return (
      <div
        data-testid={`canvas-card-${canvas.id}`}
        tabIndex={0}
        role="button"
        onClick={() => onClick(canvas)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(canvas); }}
        className="h-16 px-4 flex items-center border-b border-white/5 hover:bg-white/5 cursor-pointer group/menu"
      >
        <span className="w-12 h-12 rounded-lg shrink-0" style={{ background }} />
        <div className="flex-1 ml-3 min-w-0">
          <InlineRename
            value={canvas.name}
            editing={renaming}
            onEditingChange={setRenaming}
            ariaLabel="重命名画布"
            onConfirm={(next) => onRename(canvas.id, next)}
          />
        </div>
        {canvas.isPlaceholder && <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white/90 mr-4">草稿</span>}
        {canvas.isPublic && !canvas.isPlaceholder && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 mr-4">公开</span>}
        <span className="text-xs text-white/40 mr-4 shrink-0">编辑于 {formatRelativeTime(canvas.updatedAt)}</span>
        {menuButton}
      </div>
    );
  }

  return (
    <div
      data-testid={`canvas-card-${canvas.id}`}
      tabIndex={0}
      role="button"
      onClick={() => onClick(canvas)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(canvas); }}
      className="rounded-2xl bg-[#1F1F1F] hover:bg-[#262626] outline outline-white/[0.08] hover:outline-white/[0.16] -outline-offset-1 transition-all duration-200 p-2 pb-2 cursor-pointer overflow-hidden relative group/menu"
    >
      <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: '4 / 3' }}>
        <div className="absolute inset-0 transition-transform duration-200 group-hover/menu:scale-110" style={{ background }} />
        {canvas.isPlaceholder && (
          <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white/90">草稿</span>
        )}
      </div>
      <div className="px-1 pt-2 pb-2 flex flex-col gap-1">
        <InlineRename
          value={canvas.name}
          editing={renaming}
          onEditingChange={setRenaming}
          ariaLabel="重命名画布"
          onConfirm={(next) => onRename(canvas.id, next)}
        />
        <div className="flex items-center justify-between text-xs text-white/50">
          <Tooltip title={new Date(canvas.updatedAt).toLocaleString()}>
            <span>编辑于 {formatRelativeTime(canvas.updatedAt)}</span>
          </Tooltip>
          {canvas.isPublic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10">公开</span>}
        </div>
      </div>
      <div className="absolute top-4 right-4 opacity-0 group-hover/menu:opacity-100 transition-opacity duration-200">
        {menuButton}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/CanvasCard.test.tsx`
Expected: PASS（9 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/components/InlineRename.tsx apps/web/src/pages/workspace/components/CanvasCard.tsx apps/web/src/pages/workspace/__tests__/CanvasCard.test.tsx
git commit -m "feat(workspace): add canvas card with inline rename and menu"
```

---

### Task 5: FolderCard

**Files:**
- Create: `components/FolderCard.tsx`
- Test: `__tests__/FolderCard.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/FolderCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderCard } from '../components/FolderCard';
import type { FolderViewModel } from '../types';

vi.setSystemTime(new Date('2026-08-18T12:00:00'));

const folder: FolderViewModel = {
  id: 'f1', name: '项目文件夹', parentId: null, workspaceId: 'personal',
  createdAt: '2026-08-18T09:00:00', updatedAt: '2026-08-18T09:00:00',
  canvasCount: 3, thumbnails: ['linear-gradient(red, blue)'],
};

function renderFolder(overrides?: { folder?: Partial<FolderViewModel>; showCount?: boolean; variant?: 'grid' | 'list' }) {
  const props = {
    folder: { ...folder, ...overrides?.folder },
    showCount: overrides?.showCount ?? true,
    variant: overrides?.variant ?? 'grid',
    onClick: vi.fn(),
    onRequestRename: vi.fn(),
    onDelete: vi.fn(),
  };
  return { props, ...render(<FolderCard {...props} />) };
}

describe('FolderCard', () => {
  it('渲染名称、画布数、编辑时间', () => {
    renderFolder();
    expect(screen.getByText('项目文件夹')).toBeInTheDocument();
    expect(screen.getByText('3 个画布')).toBeInTheDocument();
    expect(screen.getByText(/编辑于/)).toBeInTheDocument();
  });

  it('showCount=false（搜索态）不显示画布数', () => {
    renderFolder({ showCount: false });
    expect(screen.queryByText('3 个画布')).not.toBeInTheDocument();
  });

  it('点击卡片触发 onClick', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByTestId('folder-card-f1'));
    expect(props.onClick).toHaveBeenCalled();
  });

  it('菜单「删除」触发 onDelete', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('删除'));
    expect(props.onDelete).toHaveBeenCalledWith(props.folder);
  });

  it('菜单「重命名」触发 onRequestRename（Modal 由页面处理）', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(props.onRequestRename).toHaveBeenCalledWith(props.folder);
  });

  it('hover 铅笔点击触发 onRequestRename（不进入内联编辑）', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByLabelText('重命名文件夹'));
    expect(props.onRequestRename).toHaveBeenCalledWith(props.folder);
    expect(screen.queryByDisplayValue('项目文件夹')).not.toBeInTheDocument();
  });

  it('variant="list" 渲染紧凑行（含菜单与数量）', () => {
    const { props } = renderFolder({ variant: 'list' });
    expect(screen.getByTestId('folder-card-f1').className).toContain('h-16');
    expect(screen.getByText('3 个画布')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(props.onRequestRename).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/FolderCard.test.tsx`
Expected: FAIL — `Cannot find module '../components/FolderCard'`

- [ ] **Step 3: 写实现**

```tsx
// components/FolderCard.tsx（重命名统一走 Modal：铅笔/菜单都只触发 onRequestRename）
import { Dropdown, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, MoreOutlined, FolderOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { FolderViewModel } from '../types';
import { formatRelativeTime } from '../utils/time';
import { FolderStackPreview } from './FolderStackPreview';

interface FolderCardProps {
  folder: FolderViewModel;
  showCount: boolean;
  variant?: 'grid' | 'list';
  onClick: (folder: FolderViewModel) => void;
  onRequestRename: (folder: FolderViewModel) => void;
  onDelete: (folder: FolderViewModel) => void;
}

export function FolderCard({ folder, showCount, variant = 'grid', onClick, onRequestRename, onDelete }: FolderCardProps) {
  const items: MenuProps['items'] = [
    { key: 'rename', label: '重命名', icon: <EditOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined /> },
  ];
  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'rename') onRequestRename(folder);
    if (key === 'delete') onDelete(folder);
  };

  const menuButton = (
    <Dropdown menu={{ items, onClick: onMenuClick }} trigger={['click']}>
      <button
        aria-label="更多操作"
        onClick={(e) => e.stopPropagation()}
        className="p-1.5 rounded-md text-white/80 border-none cursor-pointer z-30 bg-transparent hover:bg-white/10"
      >
        <MoreOutlined />
      </button>
    </Dropdown>
  );

  if (variant === 'list') {
    return (
      <div
        data-testid={`folder-card-${folder.id}`}
        tabIndex={0}
        role="button"
        onClick={() => onClick(folder)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(folder); }}
        className="h-16 px-4 flex items-center border-b border-white/5 hover:bg-white/5 cursor-pointer group/menu"
      >
        <span className="w-12 h-12 flex items-center justify-center bg-white/5 rounded-lg text-white/70 shrink-0">
          <FolderOutlined style={{ fontSize: 20 }} />
        </span>
        <span className="flex-1 ml-3 text-sm font-semibold truncate group-hover/name">{folder.name}</span>
        {showCount && <span className="text-xs text-white/40 mr-4 shrink-0">{folder.canvasCount} 个画布</span>}
        {menuButton}
      </div>
    );
  }

  return (
    <div
      data-testid={`folder-card-${folder.id}`}
      tabIndex={0}
      role="button"
      onClick={() => onClick(folder)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(folder); }}
      className="rounded-2xl bg-[#1F1F1F] hover:bg-[#262626] outline outline-white/[0.08] hover:outline-white/[0.16] -outline-offset-1 transition-all duration-200 p-2 cursor-pointer overflow-hidden relative group/menu"
    >
      <FolderStackPreview thumbnails={folder.thumbnails} />
      <div className="px-2 pt-2 pb-1">
        <span className="group/name flex items-center min-w-0">
          <span className="text-sm font-semibold truncate">{folder.name}</span>
          <button
            aria-label="重命名文件夹"
            className="opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 p-0.5 ml-1 text-white/60 shrink-0 bg-transparent border-none cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onRequestRename(folder); }}
          >
            <EditOutlined style={{ fontSize: 12 }} />
          </button>
        </span>
        <div className="flex items-center justify-between text-xs text-white/50 mt-1">
          <Tooltip title={new Date(folder.updatedAt).toLocaleString()}>
            <span>编辑于 {formatRelativeTime(folder.updatedAt)}</span>
          </Tooltip>
          {showCount && <span className="text-[10px]">{folder.canvasCount} 个画布</span>}
        </div>
      </div>
      <div className="absolute top-4 right-4 opacity-0 group-hover/menu:opacity-100 transition-opacity duration-200">
        {menuButton}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过（含 CanvasCard 回归）**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/FolderCard.test.tsx src/pages/workspace/__tests__/CanvasCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/components/FolderCard.tsx apps/web/src/pages/workspace/__tests__/FolderCard.test.tsx
git commit -m "feat(workspace): add folder card"
```

---

### Task 6: CreateFolderCard + EmptyState + CardGridSkeleton

**Files:**
- Create: `components/CreateFolderCard.tsx`
- Create: `components/EmptyState.tsx`
- Create: `components/CardGridSkeleton.tsx`
- Test: `__tests__/SupportComponents.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/SupportComponents.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateFolderCard } from '../components/CreateFolderCard';
import { EmptyState } from '../components/EmptyState';
import { CardGridSkeleton } from '../components/CardGridSkeleton';

describe('CreateFolderCard', () => {
  it('role=button + aria-label，点击触发回调', () => {
    const onClick = vi.fn();
    render(<CreateFolderCard onClick={onClick} />);
    const el = screen.getByRole('button', { name: '新建文件夹' });
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalled();
  });
  it('渲染「新建文件夹」文字与虚线样式', () => {
    render(<CreateFolderCard onClick={vi.fn()} />);
    expect(screen.getByText('新建文件夹')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('empty-folder 态：文案 + 「新建画布」按钮', () => {
    const onAction = vi.fn();
    render(<EmptyState variant="empty-folder" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '新建画布' }));
    expect(onAction).toHaveBeenCalled();
  });
  it('no-results 态：清除搜索按钮', () => {
    render(<EmptyState variant="no-results" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '清除搜索' })).toBeInTheDocument();
  });
  it('error 态：重试按钮', () => {
    render(<EmptyState variant="error" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
  it('empty-root 态：新建画布引导', () => {
    render(<EmptyState variant="empty-root" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '新建画布' })).toBeInTheDocument();
  });
});

describe('CardGridSkeleton', () => {
  it('渲染 10 个骨架卡', () => {
    const { container } = render(<CardGridSkeleton />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(10);
  });
  it('snapshot 锁定结构', () => {
    const { asFragment } = render(<CardGridSkeleton />);
    expect(asFragment()).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/SupportComponents.test.tsx`
Expected: FAIL — `Cannot find module '../components/CreateFolderCard'`

- [ ] **Step 3: 写实现**

```tsx
// components/CreateFolderCard.tsx
import { FolderAddOutlined } from '@ant-design/icons';

export function CreateFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      aria-label="新建文件夹"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="rounded-2xl border border-dashed border-white/20 hover:border-white/40 bg-transparent hover:bg-white/5 transition-colors p-2 cursor-pointer"
    >
      <div className="w-full rounded-xl flex flex-col items-center justify-center gap-3 bg-white/5" style={{ aspectRatio: '4 / 3' }}>
        <FolderAddOutlined style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)' }} />
        <span className="text-sm text-white/80">新建文件夹</span>
      </div>
      <div className="px-1 pt-2 pb-2 h-[52px]" aria-hidden="true" />
    </div>
  );
}
```

```tsx
// components/EmptyState.tsx
import type { ReactNode } from 'react';
import { Button } from 'antd';
import { FolderOpenOutlined, SearchOutlined, CloudUploadOutlined, RocketOutlined } from '@ant-design/icons';

type Variant = 'empty-folder' | 'no-results' | 'error' | 'empty-root';

const CONFIG: Record<Variant, { icon: ReactNode; title: string; hint: string; action: string }> = {
  'empty-folder': { icon: <FolderOpenOutlined />, title: '文件夹还是空的', hint: '在当前文件夹创建你的下一个画布', action: '新建画布' },
  'no-results': { icon: <SearchOutlined />, title: '未找到匹配项', hint: '换个关键词试试', action: '清除搜索' },
  error: { icon: <CloudUploadOutlined />, title: '加载失败', hint: '网络异常，请重试', action: '重试' },
  'empty-root': { icon: <RocketOutlined />, title: '开始创建你的第一个画布', hint: '或先建一个文件夹来归类画布', action: '新建画布' },
};

export function EmptyState({ variant, onAction }: { variant: Variant; onAction: () => void }) {
  const cfg = CONFIG[variant];
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3" data-testid={`empty-state-${variant}`}>
      <span className="text-5xl text-white/30">{cfg.icon}</span>
      <p className="text-sm text-white/90 m-0">{cfg.title}</p>
      <p className="text-xs text-white/50 m-0">{cfg.hint}</p>
      <Button type="primary" onClick={onAction}>{cfg.action}</Button>
    </div>
  );
}
```

```tsx
// components/CardGridSkeleton.tsx
export function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" data-testid="card-grid-skeleton">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-[#1F1F1F] p-2 animate-pulse">
          <div className="w-full rounded-xl bg-white/10" style={{ aspectRatio: '4 / 3' }} />
          <div className="mt-2 h-4 w-2/3 rounded bg-white/10" />
          <div className="mt-1.5 h-3 w-1/3 rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/SupportComponents.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/components/CreateFolderCard.tsx apps/web/src/pages/workspace/components/EmptyState.tsx apps/web/src/pages/workspace/components/CardGridSkeleton.tsx apps/web/src/pages/workspace/__tests__/SupportComponents.test.tsx
git commit -m "feat(workspace): add create-folder card, empty states, skeleton"
```

---

### Task 7: useWorkspaceData（数据层）

**Files:**
- Create: `hooks/useWorkspaceData.ts`
- Test: `__tests__/useWorkspaceData.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/useWorkspaceData.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspaceData } from '../hooks/useWorkspaceData';

vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('@/api/projectApi', () => ({
  createProject: vi.fn(),
}));
// message 是 antd 组件，直接用真实实现

const { getTemplates } = await import('@/api/templateApi');
const { createProject } = await import('@/api/projectApi');
const { updateTemplate, deleteTemplate } = await import('@/api/templateApi');

const tpl = (id: string, name: string, updatedAt: string) => ({
  id, name, description: '', coverUrl: null, isPublic: false,
  createdAt: updatedAt, updatedAt, importCount: 0,
});

beforeEach(() => {
  vi.mocked(getTemplates).mockResolvedValue({
    templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00'), tpl('c2', '画布 2', '2026-08-18T09:00:00')],
  });
  vi.mocked(updateTemplate).mockResolvedValue(undefined as never);
  vi.mocked(deleteTemplate).mockResolvedValue(undefined as never);
});

describe('useWorkspaceData', () => {
  it('加载画布并按 fixtures 分配初始归属（c1 → folder-demo-1）', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    const c1 = result.current.canvases.find((c) => c.id === 'c1');
    expect(c1?.folderId).toBe('folder-demo-1');
    expect(result.current.folders[0].canvasCount).toBeGreaterThanOrEqual(1);
  });

  it('加载失败 → status=error，可重试', async () => {
    vi.mocked(getTemplates).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.status).toBe('success');
  });

  it('createFolder / renameFolder 本地生效', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => result.current.createFolder('新文件夹'));
    expect(result.current.folders.some((f) => f.name === '新文件夹')).toBe(true);
    const id = result.current.folders.find((f) => f.name === '新文件夹')!.id;
    act(() => result.current.renameFolder(id, '改名'));
    expect(result.current.folders.find((f) => f.id === id)?.name).toBe('改名');
  });

  it('deleteFolder 非空时抛「请先移出画布」', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(() => result.current.deleteFolder('folder-demo-1')).toThrow('请先移出画布');
  });

  it('moveCanvas 更新归属并刷新源/目标文件夹 updatedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => result.current.createFolder('目标'));
    const targetId = result.current.folders.find((f) => f.name === '目标')!.id;
    act(() => result.current.moveCanvas('c2', targetId));
    const moved = result.current.canvases.find((c) => c.id === 'c2');
    expect(moved?.folderId).toBe(targetId);
    expect(result.current.folders.find((f) => f.id === targetId)?.updatedAt).toBe(new Date().toISOString());
    vi.useRealTimers();
  });

  it('renameCanvas 乐观更新，API 失败回滚', async () => {
    vi.mocked(updateTemplate).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.renameCanvas('c1', '新名'); });
    expect(result.current.canvases.find((c) => c.id === 'c1')?.name).toBe('画布 1');
  });

  it('deleteCanvas 乐观删除，API 失败恢复', async () => {
    vi.mocked(deleteTemplate).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.deleteCanvas('c1'); });
    expect(result.current.canvases.find((c) => c.id === 'c1')).toBeDefined();
  });

  it('createCanvas 调 createProject 并插入占位', async () => {
    vi.mocked(createProject).mockResolvedValue({ id: 'p1', name: '新画布' } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    let projectId = '';
    await act(async () => { projectId = await result.current.createCanvas('新画布', 'folder-demo-1'); });
    expect(projectId).toBe('p1');
    const ph = result.current.canvases.find((c) => c.isPlaceholder);
    expect(ph?.id).toBe('placeholder-p1');
    expect(ph?.folderId).toBe('folder-demo-1');
  });

  it('deletePlaceholder 仅移除本地占位，不调 API', async () => {
    vi.mocked(createProject).mockResolvedValue({ id: 'p1', name: 'x' } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.createCanvas('x', null); });
    act(() => result.current.deletePlaceholder('placeholder-p1'));
    expect(result.current.canvases.find((c) => c.id === 'placeholder-p1')).toBeUndefined();
    expect(deleteTemplate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/useWorkspaceData.test.tsx`
Expected: FAIL — `Cannot find module '../hooks/useWorkspaceData'`

- [ ] **Step 3: 写实现**

```typescript
// hooks/useWorkspaceData.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { getTemplates, updateTemplate, deleteTemplate } from '@/api/templateApi';
import { createProject } from '@/api/projectApi';
import type { Canvas, Folder, FolderViewModel } from '../types';
import { MOCK_FOLDERS, buildInitialFolderMap } from '../fixtures';
import { getCanvasGradient } from '../utils/gradient';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  b.updatedAt.localeCompare(a.updatedAt);

export function useWorkspaceData() {
  const [rawCanvases, setRawCanvases] = useState<Canvas[]>([]);
  const [folders, setFolders] = useState<Folder[]>(MOCK_FOLDERS);
  const [folderMap, setFolderMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const data: any = await getTemplates({ type: 'my', limit: 100 });
      const canvases: Canvas[] = (data.templates ?? []).map((t: any) => ({
        id: t.id, name: t.name, coverUrl: t.coverUrl ?? null, isPublic: !!t.isPublic,
        createdAt: t.createdAt, updatedAt: t.updatedAt, folderId: null,
      }));
      setRawCanvases(canvases);
      setFolderMap(buildInitialFolderMap(canvases.map((c) => c.id)));
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // 归属单源合并：本地优先（后端阶段删除 folderMap 即直连真实 folderId）
  const canvases = useMemo(
    () => rawCanvases.map((c) => ({ ...c, folderId: folderMap[c.id] ?? c.folderId })),
    [rawCanvases, folderMap],
  );

  const folderViewModels = useMemo<FolderViewModel[]>(() => {
    return folders.map((f) => {
      const mine = canvases.filter((c) => c.folderId === f.id);
      const thumbnails = [...mine]
        .sort(byUpdatedDesc)
        .slice(0, 3)
        .map((c) => (c.coverUrl ? `url("${c.coverUrl}")` : getCanvasGradient(c.id)));
      return { ...f, canvasCount: mine.length, thumbnails };
    });
  }, [folders, canvases]);

  const touchFolders = useCallback((ids: string[]) => {
    const now = new Date().toISOString();
    setFolders((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, updatedAt: now } : f)));
  }, []);

  const createFolder = useCallback((name: string) => {
    const now = new Date().toISOString();
    setFolders((prev) => [
      ...prev,
      { id: `folder-${Date.now()}`, name, parentId: null, workspaceId: 'personal', createdAt: now, updatedAt: now },
    ]);
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name, updatedAt: new Date().toISOString() } : f)));
  }, []);

  const deleteFolder = useCallback((id: string) => {
    if (canvases.some((c) => c.folderId === id)) throw new Error('请先移出画布');
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, [canvases]);

  const moveCanvas = useCallback((canvasId: string, folderId: string | null) => {
    const source = folderMap[canvasId] ?? null;
    setFolderMap((prev) => {
      const next = { ...prev };
      if (folderId === null) delete next[canvasId];
      else next[canvasId] = folderId;
      return next;
    });
    const touched = [source, folderId].filter((v): v is string => !!v);
    if (touched.length) touchFolders(touched);
  }, [folderMap, touchFolders]);

  const renameCanvas = useCallback(async (id: string, name: string) => {
    const prev = rawCanvases;
    setRawCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await updateTemplate(id, { name });
    } catch {
      setRawCanvases(prev);
      message.error('重命名失败，请重试');
    }
  }, [rawCanvases]);

  const togglePublic = useCallback(async (id: string) => {
    const target = rawCanvases.find((c) => c.id === id);
    if (!target) return;
    const prev = rawCanvases;
    setRawCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, isPublic: !c.isPublic } : c)));
    try {
      await updateTemplate(id, { isPublic: !target.isPublic });
    } catch {
      setRawCanvases(prev);
      message.error('操作失败，请重试');
    }
  }, [rawCanvases]);

  const deleteCanvas = useCallback(async (id: string) => {
    const prev = rawCanvases;
    const sourceFolder = folderMap[id] ?? null;
    setRawCanvases((cs) => cs.filter((c) => c.id !== id));
    try {
      await deleteTemplate(id);
      if (sourceFolder) touchFolders([sourceFolder]); // 成功才级联刷新，失败回滚时不动
    } catch {
      setRawCanvases(prev);
      message.error('删除失败，请重试');
    }
  }, [rawCanvases, folderMap, touchFolders]);

  const createCanvas = useCallback(async (name: string, folderId: string | null) => {
    const project: any = await createProject(name);
    const now = new Date().toISOString();
    setRawCanvases((prev) => [
      { id: `placeholder-${project.id}`, name, coverUrl: null, isPublic: false,
        createdAt: now, updatedAt: now, folderId: null, isPlaceholder: true },
      ...prev,
    ]);
    if (folderId) {
      setFolderMap((prev) => ({ ...prev, [`placeholder-${project.id}`]: folderId }));
      touchFolders([folderId]);
    }
    return project.id as string;
  }, [touchFolders]);

  const deletePlaceholder = useCallback((id: string) => {
    setRawCanvases((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    status, reload,
    folders: folderViewModels, canvases,
    createFolder, renameFolder, deleteFolder,
    moveCanvas, renameCanvas, togglePublic, deleteCanvas,
    createCanvas, deletePlaceholder,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/useWorkspaceData.test.tsx`
Expected: PASS（9 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/hooks/useWorkspaceData.ts apps/web/src/pages/workspace/__tests__/useWorkspaceData.test.tsx
git commit -m "feat(workspace): add workspace data hook"
```

---

### Task 8: useFolderNavigation（URL 同步）

**Files:**
- Create: `hooks/useFolderNavigation.ts`
- Test: `__tests__/useFolderNavigation.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/useFolderNavigation.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { useFolderNavigation } from '../hooks/useFolderNavigation';
import type { Folder } from '../types';

vi.mock('antd', () => ({ message: { info: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const folders: Folder[] = [
  { id: 'f1', name: 'A', parentId: null, workspaceId: 'personal', createdAt: '', updatedAt: '' },
  { id: 'f2', name: 'B', parentId: null, workspaceId: 'personal', createdAt: '', updatedAt: '' },
];

function renderNav(initialUrl = '/works') {
  return renderHook(
    () => {
      const nav = useFolderNavigation(folders, true);
      const [params] = useSearchParams();
      return { ...nav, folderParam: params.get('folder') };
    },
    { wrapper: ({ children }) => <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter> },
  );
}

describe('useFolderNavigation', () => {
  it('默认根目录，path 为空', () => {
    const { result } = renderNav();
    expect(result.current.currentFolderId).toBeNull();
    expect(result.current.path).toEqual([]);
  });

  it('?folder=f1 时定位 f1，path 含该文件夹', () => {
    const { result } = renderNav('/works?folder=f1');
    expect(result.current.currentFolderId).toBe('f1');
    expect(result.current.path.map((f) => f.id)).toEqual(['f1']);
  });

  it('无效 folderId 重置为根目录并清空参数', async () => {
    const { result } = renderNav('/works?folder=nope');
    // 重置发生在 useEffect 中，需 waitFor 等 effect 执行
    await waitFor(() => expect(result.current.currentFolderId).toBeNull());
    expect(result.current.folderParam).toBeNull();
  });

  it('setCurrentFolderId 同步 URL', () => {
    const { result } = renderNav('/works');
    result.current.setCurrentFolderId('f2');
    expect(result.current.folderParam).toBe('f2');
    result.current.setCurrentFolderId(null);
    expect(result.current.folderParam).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/useFolderNavigation.test.tsx`
Expected: FAIL — `Cannot find module '../hooks/useFolderNavigation'`

- [ ] **Step 3: 写实现**

```typescript
// hooks/useFolderNavigation.ts
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { message } from 'antd';
import type { Folder } from '../types';

export function useFolderNavigation(folders: Folder[], loaded: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFolderId = searchParams.get('folder');

  // 无效 folderId fallback：重置根目录并提示
  useEffect(() => {
    if (loaded && currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setSearchParams({}, { replace: true });
      message.info('文件夹不存在');
    }
  }, [loaded, currentFolderId, folders, setSearchParams]);

  const setCurrentFolderId = (id: string | null) => {
    setSearchParams(id ? { folder: id } : {}, { replace: true });
  };

  // 根 → 当前层级链（一期深 1，按递归链写）
  const path = useMemo(() => {
    const chain: Folder[] = [];
    let cur = folders.find((f) => f.id === currentFolderId);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    return currentFolderId && chain.length === 0 ? [] : chain;
  }, [folders, currentFolderId]);

  const valid = !currentFolderId || folders.some((f) => f.id === currentFolderId);
  return { currentFolderId: valid ? currentFolderId : null, setCurrentFolderId, path };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/useFolderNavigation.test.tsx`
Expected: PASS（4 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/hooks/useFolderNavigation.ts apps/web/src/pages/workspace/__tests__/useFolderNavigation.test.tsx
git commit -m "feat(workspace): add folder navigation hook"
```

---

### Task 9: WorkspaceToolbar + WorkspaceBreadcrumb

**Files:**
- Create: `components/WorkspaceToolbar.tsx`
- Create: `components/WorkspaceBreadcrumb.tsx`
- Test: `__tests__/ToolbarBreadcrumb.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/ToolbarBreadcrumb.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkspaceToolbar } from '../components/WorkspaceToolbar';
import { WorkspaceBreadcrumb } from '../components/WorkspaceBreadcrumb';
import type { Folder, ViewMode, FilterKind } from '../types';

vi.mock('antd', async (orig) => {
  const actual = await orig<typeof import('antd')>();
  return { ...actual, message: { ...actual.message, info: vi.fn() } };
});
const { message } = await import('antd');

describe('WorkspaceToolbar', () => {
  function renderToolbar(overrides?: Partial<Parameters<typeof WorkspaceToolbar>[0]>) {
    const props = {
      viewMode: 'grid' as ViewMode,
      onViewModeChange: vi.fn(),
      onSearchChange: vi.fn(),
      filter: 'all' as FilterKind,
      onFilterChange: vi.fn(),
      onCreateCanvas: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<WorkspaceToolbar {...props} />) };
  }

  it('「个人」选中、「团队项目」禁用', () => {
    renderToolbar();
    expect(screen.getByText('个人')).toHaveClass('text-white');
    expect(screen.getByText('团队项目')).toBeDisabled();
  });

  it('搜索输入 300ms 防抖后回调', async () => {
    vi.useFakeTimers();
    const { props } = renderToolbar();
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '关键词' } });
    expect(props.onSearchChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(props.onSearchChange).toHaveBeenCalledWith('关键词');
    vi.useRealTimers();
  });

  it('筛选菜单三种选项', () => {
    renderToolbar();
    fireEvent.click(screen.getByText('显示全部'));
    expect(screen.getByText('仅文件夹')).toBeInTheDocument();
    expect(screen.getByText('仅画布')).toBeInTheDocument();
  });

  it('视图切换触发回调', () => {
    const { props } = renderToolbar();
    fireEvent.click(screen.getByLabelText('List view'));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('导入按钮 toast「即将上线」', () => {
    renderToolbar();
    fireEvent.click(screen.getByLabelText('导入'));
    expect(message.info).toHaveBeenCalledWith('即将上线');
  });

  it('新建画布按钮回调', () => {
    const { props } = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /新建画布/ }));
    expect(props.onCreateCanvas).toHaveBeenCalled();
  });
});

describe('WorkspaceBreadcrumb', () => {
  const f1: Folder = { id: 'f1', name: '文件夹一', parentId: null, workspaceId: 'personal', createdAt: '', updatedAt: '' };

  it('根视图仅显示「工作空间」', () => {
    render(<WorkspaceBreadcrumb path={[]} currentFolderId={null} searchQuery="" onNavigate={vi.fn()} onClearSearch={vi.fn()} />);
    expect(screen.getByText('工作空间')).toBeInTheDocument();
  });

  it('文件夹内显示层级，点击「工作空间」返回根', () => {
    const onNavigate = vi.fn();
    render(<WorkspaceBreadcrumb path={[f1]} currentFolderId="f1" searchQuery="" onNavigate={onNavigate} onClearSearch={vi.fn()} />);
    expect(screen.getByText('文件夹一')).toBeInTheDocument();
    fireEvent.click(screen.getByText('工作空间'));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('搜索态显示搜索词与清除按钮', () => {
    const onClearSearch = vi.fn();
    render(<WorkspaceBreadcrumb path={[f1]} currentFolderId="f1" searchQuery="关键词" onNavigate={vi.fn()} onClearSearch={onClearSearch} />);
    expect(screen.getByText(/关键词/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('清除搜索'));
    expect(onClearSearch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/ToolbarBreadcrumb.test.tsx`
Expected: FAIL — `Cannot find module '../components/WorkspaceToolbar'`

- [ ] **Step 3: 写实现**

```tsx
// components/WorkspaceToolbar.tsx
import { useEffect, useRef, useState } from 'react';
import { Dropdown, Button } from 'antd';
import { SearchOutlined, DownOutlined, AppstoreOutlined, UnorderedListOutlined, UploadOutlined, PlusOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { FilterKind, ViewMode } from '../types';
import { message } from 'antd';

interface WorkspaceToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchChange: (query: string) => void;
  filter: FilterKind;
  onFilterChange: (filter: FilterKind) => void;
  onCreateCanvas: () => void;
}

const FILTER_LABEL: Record<FilterKind, string> = { all: '显示全部', folders: '仅文件夹', canvases: '仅画布' };

export function WorkspaceToolbar({ viewMode, onViewModeChange, onSearchChange, filter, onFilterChange, onCreateCanvas }: WorkspaceToolbarProps) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleSearch = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchChange(value.trim()), 300);
  };

  const filterMenu: MenuProps['items'] = [
    { key: 'all', label: '显示全部' },
    { key: 'folders', label: '仅文件夹' },
    { key: 'canvases', label: '仅画布' },
  ];

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-y-2 justify-between px-8 pb-2">
      <div className="flex gap-2 text-lg items-center">
        <button className="text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer mx-3 py-1.5 bg-transparent">个人</button>
        <button disabled className="text-white/60 mx-3 py-1.5 bg-transparent border-none cursor-not-allowed opacity-60">团队项目</button>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-10 px-3 flex items-center gap-1 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 focus-within:ring-white/20" style={{ width: 160 }}>
          <SearchOutlined className="text-[#646464] shrink-0" />
          <input
            aria-label="搜索"
            type="text" placeholder="搜索" value={text}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 bg-transparent border-none text-sm text-white placeholder:text-[#646464] min-w-0 focus:outline-none"
          />
        </div>
        <Dropdown menu={{ items: filterMenu, onClick: ({ key }) => onFilterChange(key as FilterKind) }} trigger={['click']}>
          <button className="h-10 px-3 flex items-center gap-1 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 hover:bg-white/10 text-white text-sm border-none cursor-pointer">
            {FILTER_LABEL[filter]}
            <DownOutlined style={{ fontSize: 12 }} />
          </button>
        </Dropdown>
        <div className="p-1 flex items-center gap-2 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10">
          <button
            aria-label="Grid view"
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-md border-none cursor-pointer ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            <AppstoreOutlined />
          </button>
          <button
            aria-label="List view"
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-md border-none cursor-pointer ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            <UnorderedListOutlined />
          </button>
        </div>
        <div className="h-6 w-px bg-white/10 mx-1" />
        <Button aria-label="导入" icon={<UploadOutlined />} onClick={() => message.info('即将上线')} style={{ width: 40 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateCanvas}>新建画布</Button>
      </div>
    </div>
  );
}
```

```tsx
// components/WorkspaceBreadcrumb.tsx
import { CloseOutlined } from '@ant-design/icons';
import type { Folder } from '../types';

interface WorkspaceBreadcrumbProps {
  path: Folder[];
  currentFolderId: string | null;
  searchQuery: string;
  onNavigate: (folderId: string | null) => void;
  onClearSearch: () => void;
}

export function WorkspaceBreadcrumb({ path, currentFolderId, searchQuery, onNavigate, onClearSearch }: WorkspaceBreadcrumbProps) {
  if (searchQuery) {
    return (
      <div className="flex items-center gap-2 px-8 py-3 text-[13px]">
        <span className="text-white/90">搜索 “{searchQuery}”</span>
        <button aria-label="清除搜索" onClick={onClearSearch} className="text-white/50 hover:text-white/90 border-none bg-transparent cursor-pointer">
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    );
  }
  return (
    <nav className="flex items-center gap-2 px-8 py-3 text-[13px]" aria-label="面包屑">
      <button onClick={() => onNavigate(null)} className={currentFolderId ? 'text-white/60 hover:text-white/90 bg-transparent border-none cursor-pointer' : 'text-white/90 bg-transparent border-none cursor-default'}>
        工作空间
      </button>
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-2">
          <span className="text-white/30">/</span>
          <button
            onClick={() => onNavigate(f.id)}
            className={i === path.length - 1 ? 'text-white/90 bg-transparent border-none cursor-default' : 'text-white/60 hover:text-white/90 bg-transparent border-none cursor-pointer'}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/ToolbarBreadcrumb.test.tsx`
Expected: PASS（9 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/components/WorkspaceToolbar.tsx apps/web/src/pages/workspace/components/WorkspaceBreadcrumb.tsx apps/web/src/pages/workspace/__tests__/ToolbarBreadcrumb.test.tsx
git commit -m "feat(workspace): add toolbar and breadcrumb"
```

---

### Task 10: 三个 Modal（CreateFolder / CreateCanvas / MoveToFolder）

**Files:**
- Create: `components/CreateFolderModal.tsx`
- Create: `components/CreateCanvasModal.tsx`
- Create: `components/MoveToFolderModal.tsx`
- Test: `__tests__/Modals.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/Modals.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { CreateCanvasModal } from '../components/CreateCanvasModal';
import { MoveToFolderModal } from '../components/MoveToFolderModal';
import type { Folder } from '../types';

const folders: Folder[] = [
  { id: 'f1', name: '文件夹一', parentId: null, workspaceId: 'personal', createdAt: '', updatedAt: '' },
  { id: 'f2', name: '文件夹二', parentId: null, workspaceId: 'personal', createdAt: '', updatedAt: '' },
];

describe('CreateFolderModal', () => {
  it('空名称时确认按钮禁用，输入后点击确认回传名称', () => {
    const onOk = vi.fn();
    render(<CreateFolderModal open onOk={onOk} onCancel={vi.fn()} />);
    const btn = screen.getByRole('button', { name: '确定' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '新文件夹' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOk).toHaveBeenCalledWith('新文件夹');
  });
  it('重命名模式回填 initialName', () => {
    render(<CreateFolderModal open initialName="旧名" onOk={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue('旧名')).toBeInTheDocument();
  });
});

describe('CreateCanvasModal', () => {
  it('含「根目录」与全部文件夹，默认当前文件夹，确认回传', () => {
    const onOk = vi.fn();
    render(<CreateCanvasModal open folders={folders} defaultFolderId="f1" onOk={onOk} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('画布名称'), { target: { value: '新画布' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onOk).toHaveBeenCalledWith('新画布', 'f1');
  });
});

describe('MoveToFolderModal', () => {
  it('当前文件夹禁用并标「当前位置」，选择目标后确认回传', () => {
    const onOk = vi.fn();
    render(<MoveToFolderModal open folders={folders} currentFolderId="f1" onOk={onOk} onCancel={vi.fn()} />);
    expect(screen.getByText('当前位置')).toBeInTheDocument();
    fireEvent.click(screen.getByText('文件夹二'));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onOk).toHaveBeenCalledWith('f2');
  });
  it('可选「根目录」回传 null', () => {
    const onOk = vi.fn();
    render(<MoveToFolderModal open folders={folders} currentFolderId="f1" onOk={onOk} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('根目录（未分组）'));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onOk).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/Modals.test.tsx`
Expected: FAIL — `Cannot find module '../components/CreateFolderModal'`

- [ ] **Step 3: 写实现**

```tsx
// components/CreateFolderModal.tsx
import { useEffect, useState } from 'react';
import { Modal, Input } from 'antd';

interface CreateFolderModalProps {
  open: boolean;
  initialName?: string;
  onOk: (name: string) => void;
  onCancel: () => void;
}

export function CreateFolderModal({ open, initialName, onOk, onCancel }: CreateFolderModalProps) {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(initialName ?? ''); }, [open, initialName]);

  return (
    <Modal
      title={initialName ? '重命名文件夹' : '新建文件夹'}
      open={open}
      okText="确定" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => onOk(name.trim())}
      onCancel={onCancel}
      destroyOnClose
    >
      <Input aria-label="文件夹名称" placeholder="输入文件夹名称" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={() => name.trim() && onOk(name.trim())} />
    </Modal>
  );
}
```

```tsx
// components/CreateCanvasModal.tsx
import { useEffect, useState } from 'react';
import { Modal, Input, Select } from 'antd';
import type { Folder } from '../types';

interface CreateCanvasModalProps {
  open: boolean;
  folders: Folder[];
  defaultFolderId: string | null;
  onOk: (name: string, folderId: string | null) => void;
  onCancel: () => void;
}

export function CreateCanvasModal({ open, folders, defaultFolderId, onOk, onCancel }: CreateCanvasModalProps) {
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  useEffect(() => { if (open) { setName(''); setFolderId(defaultFolderId); } }, [open, defaultFolderId]);

  return (
    <Modal
      title="新建画布"
      open={open}
      okText="确定" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => onOk(name.trim(), folderId)}
      onCancel={onCancel}
      destroyOnClose
    >
      <div className="flex flex-col gap-3">
        <Input aria-label="画布名称" placeholder="输入画布名称" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          aria-label="目标文件夹"
          value={folderId ?? '__root__'}
          onChange={(v) => setFolderId(v === '__root__' ? null : v)}
          options={[
            { value: '__root__', label: '根目录（未分组）' },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </div>
    </Modal>
  );
}
```

```tsx
// components/MoveToFolderModal.tsx
import { useEffect, useState } from 'react';
import { Modal, Button } from 'antd';
import type { Folder } from '../types';

interface MoveToFolderModalProps {
  open: boolean;
  folders: Folder[];
  currentFolderId: string | null; // 画布当前所在文件夹
  onOk: (folderId: string | null) => void;
  onCancel: () => void;
}

export function MoveToFolderModal({ open, folders, currentFolderId, onOk, onCancel }: MoveToFolderModalProps) {
  const [selected, setSelected] = useState<string | null>(currentFolderId);
  useEffect(() => { if (open) setSelected(currentFolderId); }, [open, currentFolderId]);

  const Row = ({ id, label }: { id: string | null; label: string }) => {
    const isCurrent = id === currentFolderId;
    const isSelected = selected === id;
    return (
      <div
        onClick={() => !isCurrent && setSelected(id)}
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer ${isCurrent ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5'} ${isSelected ? 'bg-white/10' : ''}`}
        data-testid={`move-target-${id ?? 'root'}`}
      >
        <span className="text-sm text-white/90">{label}</span>
        {isCurrent && <span className="text-xs text-white/50">当前位置</span>}
      </div>
    );
  };

  return (
    <Modal
      title="移动到文件夹"
      open={open}
      okText="确定" cancelText="取消"
      onOk={() => onOk(selected)}
      onCancel={onCancel}
      destroyOnClose
    >
      <div className="flex flex-col gap-1">
        <Row id={null} label="根目录（未分组）" />
        {folders.map((f) => <Row key={f.id} id={f.id} label={f.name} />)}
      </div>
    </Modal>
  );
}
```

（antd Modal 的 okText「确定」按钮在测试中通过 `getByRole('button', { name: '确定' })` 获取；Select 在 jsdom 下拉交互不稳定，CreateCanvasModal 测试只验证默认值透传，不做下拉展开交互。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/Modals.test.tsx`
Expected: PASS（5 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/components/CreateFolderModal.tsx apps/web/src/pages/workspace/components/CreateCanvasModal.tsx apps/web/src/pages/workspace/components/MoveToFolderModal.tsx apps/web/src/pages/workspace/__tests__/Modals.test.tsx
git commit -m "feat(workspace): add folder/canvas/move modals"
```

---

### Task 11: WorkspacePage 组装

**Files:**
- Create: `WorkspacePage.tsx`
- Test: `__tests__/WorkspacePage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/WorkspacePage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';

vi.mock('@/pages/home/components/Navbar', () => ({ Navbar: () => <div data-testid="navbar" /> }));
vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('@/api/projectApi', () => ({ createProject: vi.fn() }));
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>();
  return { ...actual, useNavigate: vi.fn() };
});

import * as templateApi from '@/api/templateApi';
import * as projectApi from '@/api/projectApi';
import { WorkspacePage } from '../WorkspacePage';

const tpl = (id: string, name: string, updatedAt: string) => ({
  id, name, description: '', coverUrl: null, isPublic: false,
  createdAt: updatedAt, updatedAt, importCount: 0,
});

const navigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(templateApi.getTemplates).mockResolvedValue({
    templates: [
      tpl('c1', '阿尔法画布', '2026-08-18T10:00:00'),
      tpl('c2', '贝塔画布', '2026-08-18T09:00:00'),
      tpl('c3', '伽马画布', '2026-08-18T08:00:00'),
    ],
  } as never);
  vi.mocked(useNavigate).mockReturnValue(navigate);
  vi.mocked(projectApi.createProject).mockResolvedValue({ id: 'p9' } as never);
});

function renderPage(initialUrl = '/works') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <WorkspacePage />
    </MemoryRouter>
  );
}

describe('WorkspacePage', () => {
  it('加载成功渲染：文件夹在前（含预置 2 个）+ 画布在后 + 新建文件夹卡首位', async () => {
    renderPage();
    expect(await screen.findByTestId('folder-card-folder-demo-1')).toBeInTheDocument();
    expect(screen.getByTestId('folder-card-folder-demo-2')).toBeInTheDocument();
    // c1、c2 归属 folder-demo-1；根目录只剩 c3
    expect(screen.getByTestId('canvas-card-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
    // 网格顺序：新建文件夹卡 → 文件夹 → 画布
    const first = document.querySelector('[data-testid="workspace-grid"] > :first-child');
    expect(first).toHaveAttribute('data-testid', 'create-folder-card');
  });

  it('点击文件夹进入子视图，面包屑出现，返回根目录', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('folder-card-folder-demo-1'));
    expect(await screen.findByTestId('canvas-card-c1')).toBeInTheDocument();
    expect(screen.getByText('未命名文件夹')).toBeInTheDocument();
    fireEvent.click(screen.getByText('工作空间'));
    await waitFor(() => expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument());
  });

  it('普通画布点击跳 /works/:id', async () => {
    renderPage('/works?folder=folder-demo-1');
    fireEvent.click(await screen.findByTestId('canvas-card-c1'));
    expect(navigate).toHaveBeenCalledWith('/works/c1');
  });

  it('搜索防抖过滤（全局，跨文件夹）', async () => {
    renderPage();
    const input = await screen.findByLabelText('搜索'); // 先用真实 timers 等初始渲染
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: '阿尔法' } });
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument(); // 防抖内不生效
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId('canvas-card-c1')).toBeInTheDocument(); // c1 在文件夹内也能搜到（全局搜索）
    expect(screen.queryByTestId('folder-card-folder-demo-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-folder-card')).not.toBeInTheDocument(); // 搜索态隐藏新建卡
    vi.useRealTimers();
  });

  it('筛选「仅画布」隐藏文件夹与新建卡', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('显示全部'));
    fireEvent.click(screen.getByText('仅画布'));
    await waitFor(() => expect(screen.queryByTestId('create-folder-card')).not.toBeInTheDocument());
    expect(screen.getByTestId('canvas-card-c3')).toBeInTheDocument();
  });

  it('新建文件夹流程', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('create-folder-card'));
    fireEvent.change(await screen.findByLabelText('文件夹名称'), { target: { value: '我的新文件夹' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByTestId(/folder-card-folder-\d+/i)).toBeInTheDocument();
  });

  it('新建画布流程：createProject + 占位 + 跳转', async () => {
    renderPage('/works?folder=folder-demo-1');
    fireEvent.click(await screen.findByRole('button', { name: /新建画布/ }));
    fireEvent.change(await screen.findByLabelText('画布名称'), { target: { value: '新作品' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p9'));
    expect(await screen.findByTestId('canvas-card-placeholder-p9')).toBeInTheDocument();
  });

  it('移动画布到根目录', async () => {
    renderPage('/works?folder=folder-demo-1');
    const card = await screen.findByTestId('canvas-card-c1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('移动到文件夹'));
    fireEvent.click(await screen.findByText('根目录（未分组）'));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument());
  });

  it('删除非空文件夹 toast 报错', async () => {
    renderPage();
    const card = await screen.findByTestId('folder-card-folder-demo-1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('删除'));
    await waitFor(() => expect(screen.getByTestId('folder-card-folder-demo-1')).toBeInTheDocument()); // 未删除
  });

  it('无效 folderId 重置根目录', async () => {
    renderPage('/works?folder=nope');
    await waitFor(() => expect(screen.getByTestId('canvas-card-c3')).toBeInTheDocument());
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
  });

  it('加载失败显示错误空态，重试成功', async () => {
    vi.mocked(templateApi.getTemplates).mockRejectedValueOnce(new Error('x'));
    renderPage();
    expect(await screen.findByTestId('empty-state-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('canvas-card-c3')).toBeInTheDocument();
  });

  it('list 视图渲染行', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('List view'));
    expect(await screen.findByTestId('workspace-list')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspacePage.test.tsx`
Expected: FAIL — `Cannot find module '../WorkspacePage'`

- [ ] **Step 3: 写实现**

```tsx
// WorkspacePage.tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { message } from 'antd';
import { FolderAddOutlined } from '@ant-design/icons';
import { Navbar } from '@/pages/home/components/Navbar';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { useFolderNavigation } from './hooks/useFolderNavigation';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import { WorkspaceBreadcrumb } from './components/WorkspaceBreadcrumb';
import { CreateFolderCard } from './components/CreateFolderCard';
import { FolderCard } from './components/FolderCard';
import { CanvasCard } from './components/CanvasCard';
import { CreateFolderModal } from './components/CreateFolderModal';
import { CreateCanvasModal } from './components/CreateCanvasModal';
import { MoveToFolderModal } from './components/MoveToFolderModal';
import { EmptyState } from './components/EmptyState';
import { CardGridSkeleton } from './components/CardGridSkeleton';
import type { Canvas, FilterKind, FolderViewModel, ViewMode, WorkspaceItem } from './types';

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

export function WorkspacePage() {
  const navigate = useNavigate();
  const data = useWorkspaceData();
  const nav = useFolderNavigation(data.folders, data.status !== 'loading');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [folderModal, setFolderModal] = useState<{ open: boolean; rename?: FolderViewModel }>({ open: false });
  const [canvasModal, setCanvasModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Canvas | null>(null);

  const items = useMemo<WorkspaceItem[]>(() => {
    let folders = data.folders;
    let canvases = data.canvases;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      folders = folders.filter((f) => f.name.toLowerCase().includes(q));
      canvases = canvases.filter((c) => c.name.toLowerCase().includes(q));
    } else {
      folders = folders.filter((f) => f.parentId === nav.currentFolderId);
      canvases = canvases.filter((c) => c.folderId === nav.currentFolderId);
    }
    if (filter === 'folders') canvases = [];
    if (filter === 'canvases') folders = [];
    return [
      ...[...folders].sort(byUpdatedDesc).map((f) => ({ type: 'folder' as const, data: f })),
      ...[...canvases].sort(byUpdatedDesc).map((c) => ({ type: 'canvas' as const, data: c })),
    ];
  }, [data.folders, data.canvases, searchQuery, filter, nav.currentFolderId]);

  const showCreateFolderCard = !searchQuery && filter !== 'canvases';

  // 统一入口：进入文件夹 = 定位 + 清搜索 + 同步 URL
  const enterFolder = (folderId: string | null) => {
    nav.setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  const onItemClick = (item: WorkspaceItem) => {
    if (data.status === 'loading') return; // 加载中不导航
    if (item.type === 'folder') enterFolder(item.data.id);
    else if (item.data.isPlaceholder) navigate(`/canvas?projectId=${item.data.id.replace('placeholder-', '')}`);
    else navigate(`/works/${item.data.id}`);
  };

  const handleDeleteFolder = (folder: FolderViewModel) => {
    try {
      data.deleteFolder(folder.id);
      message.success('文件夹已删除');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleCreateCanvas = async (name: string, folderId: string | null) => {
    setCanvasModal(false);
    try {
      const projectId = await data.createCanvas(name, folderId);
      navigate(`/canvas?projectId=${projectId}`);
    } catch {
      message.error('创建画布失败，请重试');
    }
  };

  const gridClass = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4';

  const isEmpty = items.length === 0 && !showCreateFolderCard;

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="mx-auto max-w-[1640px] pt-4">
        <WorkspaceToolbar
          viewMode={viewMode} onViewModeChange={setViewMode}
          onSearchChange={setSearchQuery}
          filter={filter} onFilterChange={setFilter}
          onCreateCanvas={() => setCanvasModal(true)}
        />
        <WorkspaceBreadcrumb
          path={nav.path} currentFolderId={nav.currentFolderId}
          searchQuery={searchQuery}
          onNavigate={enterFolder}
          onClearSearch={() => setSearchQuery('')}
        />
        <div className="px-8 pb-10">
          {data.status === 'loading' && <CardGridSkeleton />}
          {data.status === 'error' && <EmptyState variant="error" onAction={data.reload} />}
          {data.status === 'success' && isEmpty && (
            <EmptyState
              variant={searchQuery ? 'no-results' : nav.currentFolderId ? 'empty-folder' : 'empty-root'}
              onAction={searchQuery ? () => setSearchQuery('') : () => setCanvasModal(true)}
            />
          )}
          {data.status === 'success' && !isEmpty && viewMode === 'grid' && (
            <ul className={gridClass} data-testid="workspace-grid">
              {showCreateFolderCard && (
                <li><CreateFolderCard onClick={() => setFolderModal({ open: true })} /></li>
              )}
              {items.map((item) => (
                <li key={item.data.id}>
                  {item.type === 'folder' ? (
                    <FolderCard
                      folder={item.data}
                      showCount={!searchQuery}
                      onClick={() => onItemClick(item)}
                      onRequestRename={(f) => setFolderModal({ open: true, rename: f })}
                      onDelete={handleDeleteFolder}
                    />
                  ) : (
                    <CanvasCard
                      canvas={item.data}
                      onClick={() => onItemClick(item)}
                      onRename={data.renameCanvas}
                      onMove={setMoveTarget}
                      onTogglePublic={data.togglePublic}
                      onDelete={(c) => {
                        if (c.isPlaceholder) data.deletePlaceholder(c.id);
                        else void data.deleteCanvas(c.id);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.status === 'success' && !isEmpty && viewMode === 'list' && (
            <ul className="flex flex-col" data-testid="workspace-list">
              {showCreateFolderCard && (
                <li className="px-4 py-2">
                  <button
                    onClick={() => setFolderModal({ open: true })}
                    className="h-12 w-full flex items-center justify-center gap-2 border border-dashed border-white/20 rounded-lg text-sm text-white/60 bg-transparent cursor-pointer hover:border-white/40"
                  >
                    <FolderAddOutlined /> 新建文件夹
                  </button>
                </li>
              )}
              {items.map((item) => (
                <li key={item.data.id}>
                  {item.type === 'folder' ? (
                    <FolderCard
                      variant="list"
                      folder={item.data}
                      showCount={!searchQuery}
                      onClick={() => onItemClick(item)}
                      onRequestRename={(f) => setFolderModal({ open: true, rename: f })}
                      onDelete={handleDeleteFolder}
                    />
                  ) : (
                    <CanvasCard
                      variant="list"
                      canvas={item.data}
                      onClick={() => onItemClick(item)}
                      onRename={data.renameCanvas}
                      onMove={setMoveTarget}
                      onTogglePublic={data.togglePublic}
                      onDelete={(c) => {
                        if (c.isPlaceholder) data.deletePlaceholder(c.id);
                        else void data.deleteCanvas(c.id);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CreateFolderModal
        open={folderModal.open}
        initialName={folderModal.rename?.name}
        onOk={(name) => {
          if (folderModal.rename) data.renameFolder(folderModal.rename.id, name);
          else data.createFolder(name);
          setFolderModal({ open: false });
        }}
        onCancel={() => setFolderModal({ open: false })}
      />
      <CreateCanvasModal
        open={canvasModal}
        folders={data.folders}
        defaultFolderId={nav.currentFolderId}
        onOk={handleCreateCanvas}
        onCancel={() => setCanvasModal(false)}
      />
      <MoveToFolderModal
        open={!!moveTarget}
        folders={data.folders}
        currentFolderId={moveTarget?.folderId ?? null}
        onOk={(folderId) => { if (moveTarget) data.moveCanvas(moveTarget.id, folderId); setMoveTarget(null); }}
        onCancel={() => setMoveTarget(null)}
      />
    </div>
  );
}
```

说明：list 视图直接复用 `FolderCard variant="list"` / `CanvasCard variant="list"`（Task 4/5 已实现），菜单/重命名能力与 grid 完全一致；文件夹重命名统一走 Modal（`onRequestRename` → `setFolderModal({ open: true, rename })`），InlineRename 仅 CanvasCard 使用。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspacePage.test.tsx`
Expected: PASS（12 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace/WorkspacePage.tsx apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx
git commit -m "feat(workspace): assemble workspace page"
```

---

### Task 12: 路由切换 + 删除旧文件 + 回归验证

**Files:**
- Modify: `apps/web/src/router.tsx:12,25`
- Delete: `apps/web/src/pages/templates/MyTemplatesPage.tsx`
- Delete: `apps/web/src/pages/templates/MyTemplatesPage.test.tsx`
- Delete: `apps/web/src/pages/templates/TemplateCard.tsx`
- Delete: `apps/web/src/pages/templates/EditTemplateDialog.tsx`

- [ ] **Step 1: 确认 TemplateCard/EditTemplateDialog 零外部引用**

Run: `grep -rn "TemplateCard\|EditTemplateDialog" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "pages/templates"`
Expected: 无输出（EditTemplateDialog 已在 spec 阶段确认仅 MyTemplatesPage 引用；TemplateCard 需复验）

- [ ] **Step 2: 修改 router.tsx**

```tsx
// router.tsx diff：
// - import { MyTemplatesPage } from '@/pages/templates/MyTemplatesPage';
// + import { WorkspacePage } from '@/pages/workspace/WorkspacePage';
// ...
// - { path: '/works', element: <MyTemplatesPage /> },
// + { path: '/works', element: <WorkspacePage /> },
```

- [ ] **Step 3: 删除旧文件**

```bash
git rm apps/web/src/pages/templates/MyTemplatesPage.tsx apps/web/src/pages/templates/MyTemplatesPage.test.tsx apps/web/src/pages/templates/TemplateCard.tsx apps/web/src/pages/templates/EditTemplateDialog.tsx
```

- [ ] **Step 4: TypeScript 编译 + 全量测试**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: 无错误

Run: `cd apps/web && pnpm test`
Expected: 全部 PASS（含既有其他页面测试）

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(workspace): switch /works route to WorkspacePage, remove legacy template page"
```

- [ ] **Step 6: 浏览器人工验证（preview 已运行）**

访问 `http://localhost:5173/works`（需登录态），验证：
1. 深色 UI：预置 2 文件夹卡（堆叠缩略图 + 玻璃凹槽）+ 根目录画布 + 新建文件夹卡
2. 点击文件夹进入 → 面包屑 → URL `?folder=` → 刷新仍在文件夹
3. 新建文件夹/画布（跳编辑器）/重命名/移动/删除
4. 搜索防抖、筛选、grid/list 切换
5. 截图对照效果图

---

## Self-Review 结果（评审修订版）

- **Spec 覆盖**：spec §5 类型(T1)、§6 数据流(T2/7/8)、§7 交互(T4/5/9/10/11)、§8 视觉(T3/5/6/9/11)、§9 限制（体现在 T7 实现细节）、§10 测试（各任务用例 + T11 页面级）、§11 破坏性变更(T12)。无缺口。
- **占位符扫描**：无 TBD/TODO（fixtures 的 TODO 注释为 spec 规定的替换标注）；无「错误代码 + 注释补救」段落，所有 Step 3 代码为可直接落地的最终版。
- **架构一致性**：InlineRename 受控签名在 T4 定义、仅 CanvasCard 使用；FolderCard 自始采用 Modal 重命名（`onRequestRename`，T5 定义、T11 直接使用，无跨任务推翻）；list 视图复用卡片组件 `variant="list"`（T4/5 定义、T11 使用），菜单/重命名能力与 grid 一致。
- **类型一致性**：`WorkspaceItem`/`ViewMode`/`FilterKind`/`FolderViewModel`/`Canvas` 全程一致；`getCanvasGradient` 无硬编码旁路。
- **测试健壮性**：fake timers 下先同步查询再切换（T9/T11）；useEffect 驱动的断言用 waitFor（T8）；gradient 断言用 `getAttribute('style')` 子串匹配（T3）；CardGridSkeleton 有 snapshot（T6）。
