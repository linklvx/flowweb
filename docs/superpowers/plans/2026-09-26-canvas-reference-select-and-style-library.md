# Canvas 参考选择模式与风格库 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 spec `docs/superpowers/specs/2026-09-26-canvas-reference-select-and-style-library-design.md`（v4）——功能块 A 画布参考选择模式（横幅/点选/序号 X 角标）+ 功能块 B 风格库全链路（4 新表/用户与 admin API/弹窗/admin 两页/生成集成/快照白名单）。

**Architecture:** A 组纯前端（纯函数→store→组件→接线递进）；B 组后端先行（Prisma→用户侧 service→admin→execution/snapshot）再前端（api→hook→弹窗→选中态→admin 页）。互斥收口：menuStore 三切片互斥 + menuStore→nodeStore 单向跨 store 调用（nodeStore→menuStore 方向由组件层 onClick 收口，避免 ESM 循环 import）。取消使用写 `null`（D16）；D14 非事务三步（D26）。

**Tech Stack:** React 18 + @xyflow/react 12.10.2 + zustand + Tailwind（语义 token）+ NestJS + Prisma/PostgreSQL + MinIO + vitest（web: @testing-library/react；api: @nestjs/testing）。

**工作目录：** web 侧命令在 `D:\flowweb\apps\web`，api 侧在 `D:\flowweb\apps\api`。测试命令：web `npx vitest run <file>`；api `npx vitest run <file>`（apps/api test script = tsc+vitest，单文件跑用 npx vitest run）。

**已知门禁（收尾 Task 18 全跑）：** `pnpm test`（turbo 全量）；`pnpm lint`（web lint-gate：no-color-hex 增量 + no-theme-utility 无 baseline）；`node scripts/css-audit.mjs --slash-gate`（cwd=apps/web）；`pnpm --filter @flowweb/web build`。**硬约束**：斜杠透明度对 var() token 零输出（禁 `bg-overlay-2/50` 类写法）；white/black 工具类仅白名单文件可用；无裸 `text-text-dim`（只有 dim-1/2/3）。

**spec 拍板索引：** D8 角标全部图/D13 点卡=使用/D14+D26 计数=人数+非事务三步/D16 写 null/D19+D25 双 prop 恒显按钮/D20 状态驱动 onClose/D21 显式宽度/D28 删视频回退。B 项登记见 spec §10。

---

## 文件结构总览

**功能块 A（新建 3 + 修改 5）**
```
apps/web/src/pages/canvas/components/
  referenceSelect.ts (+.test.ts)            ← T1 可选判定纯函数
  CanvasReferenceSelectBanner.tsx (+.test.tsx) ← T6 顶部横幅
  nodes/prompt-input/SortableImageItem.tsx   ← T4 序号/X 角标两态
  nodes/prompt-input/ImageThumbnailBar.tsx   ← T5 参考按钮改造+pt-3
apps/web/src/stores/
  nodeStore.ts                               ← T2 referenceSelect 状态
  menuStore.ts                               ← T3 三切片互斥
  nodeStore.test.ts / menuStore.test.ts      ← T2/T3
  HandleAddNodeMenu.test.tsx（components/）   ← T3 补断言
  CanvasView.tsx / page.tsx                  ← T7 接线
```

**功能块 B（后端新建 6 + 修改 4；前端新建 5 + 修改 4）**
```
apps/api/prisma/schema.prisma + seed.ts + migration   ← T8
apps/api/src/modules/styles/
  styles.module.ts / styles.service.ts (+.spec.ts)    ← T9
  styles.controller.ts                                 ← T9
  admin-style.service.ts (+.spec.ts)                   ← T10
  admin-style.controller.ts / admin-style-category.controller.ts ← T10
  dto/style.dto.ts / style-category.dto.ts             ← T10
apps/api/src/modules/execution/execution.service.ts    ← T11
apps/api/src/modules/video-work/snapshot-filter.util.ts(+spec) ← T12
apps/web/src/api/stylesApi.ts (+.test.ts)              ← T13
apps/web/src/pages/canvas/components/style-library/
  useStyleLibrary.ts (+.test.ts)                       ← T14
  StyleLibraryModal.tsx (+.test.tsx) / StyleCard.tsx / StyleDetailPreview.tsx ← T15
  styleThumbCache.ts                                   ← T16
apps/web/src/stores/nodeStore.ts（类型）+ ImageThumbnailBar.tsx ← T16
apps/web/src/pages/admin/ AdminLayout.tsx / router.tsx /
  pages/StyleCategoriesPage.tsx / pages/StyleContentPage.tsx    ← T17
apps/web/src/api/adminApi.ts / router.admin.test.tsx / AdminLayout.test.tsx ← T17
```

---

### Task 1: referenceSelect 纯函数（可选判定）

**Files:**
- Create: `apps/web/src/pages/canvas/components/referenceSelect.ts`
- Create: `apps/web/src/pages/canvas/components/referenceSelect.test.ts`

- [ ] **Step 1.1: 写失败测试**

创建 `referenceSelect.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { decideReferencePick, REFERENCE_SOURCE_TYPES } from './referenceSelect';

const target = (over: Partial<Parameters<typeof decideReferencePick>[1]> = {}) => ({
  id: 'n2', type: 'imageGen', data: { fileId: 'f1' }, ...over,
}) as Parameters<typeof decideReferencePick>[1];

describe('decideReferencePick', () => {
  it('合法图片节点 → add（fileId 主图）', () => {
    expect(decideReferencePick('n1', target(), [], 9)).toEqual({ kind: 'add', fileId: 'f1' });
  });

  it('fileId 缺失时回退 referenceImage（仅上传未生成的节点）', () => {
    expect(decideReferencePick('n1', target({ data: { referenceImage: 'r1' } }), [], 9))
      .toEqual({ kind: 'add', fileId: 'r1' });
  });

  it('两者皆无 / 发起节点自身 / 非图片类节点（videoGen/group/text）→ ignore', () => {
    expect(decideReferencePick('n1', target({ data: {} }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n2', target(), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: 'videoGen' }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: 'group' }), [], 9).kind).toBe('ignore');
    expect(decideReferencePick('n1', target({ type: undefined }), [], 9).kind).toBe('ignore');
  });

  it('fileId 已在参考图 → ignore（去重）', () => {
    expect(decideReferencePick('n1', target(), ['f1'], 9).kind).toBe('ignore');
  });

  it('满 maxCount → full（横幅提示路径）', () => {
    expect(decideReferencePick('n1', target({ data: { fileId: 'f9' } }), ['a', 'b'], 2))
      .toEqual({ kind: 'full', fileId: 'f9' });
  });

  it('REFERENCE_SOURCE_TYPES = imageGen/imageExtGen', () => {
    expect([...REFERENCE_SOURCE_TYPES].sort()).toEqual(['imageExtGen', 'imageGen']);
  });
});
```

- [ ] **Step 1.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/referenceSelect.test.ts`（cwd=apps/web）
Expected: FAIL（模块不存在）。

- [ ] **Step 1.3: 实现**

创建 `referenceSelect.ts`：

```ts
/** 画布参考选择——可选判定纯函数（spec §3.3）。
 * 主图 = data.fileId ?? data.referenceImage（与 ImageGenNode.tsx:82-87 展示解析同源）。 */
export const REFERENCE_SOURCE_TYPES = new Set(['imageGen', 'imageExtGen']);

export interface ReferencePickNodeLike {
  id: string;
  type?: string;
  data?: { fileId?: string | null; referenceImage?: string | null } | null;
}

export type ReferencePickResult =
  | { kind: 'add'; fileId: string }
  | { kind: 'full'; fileId: string }
  | { kind: 'ignore' };

export function decideReferencePick(
  sourceNodeId: string,
  targetNode: ReferencePickNodeLike,
  currentImageIds: string[],
  maxCount: number,
): ReferencePickResult {
  if (targetNode.id === sourceNodeId) return { kind: 'ignore' };
  if (!targetNode.type || !REFERENCE_SOURCE_TYPES.has(targetNode.type)) return { kind: 'ignore' };
  const fileId = targetNode.data?.fileId ?? targetNode.data?.referenceImage;
  if (!fileId) return { kind: 'ignore' };
  if (currentImageIds.includes(fileId)) return { kind: 'ignore' };
  if (currentImageIds.length >= maxCount) return { kind: 'full', fileId };
  return { kind: 'add', fileId };
}
```

- [ ] **Step 1.4: 跑绿**

Run: `npx vitest run src/pages/canvas/components/referenceSelect.test.ts`
Expected: 全 PASS。

- [ ] **Step 1.5: Commit**

```bash
git add src/pages/canvas/components/referenceSelect.ts src/pages/canvas/components/referenceSelect.test.ts
git commit -m "feat(web): 参考选择可选判定纯函数——类型守卫/fileId??referenceImage 主图/自身排除/去重/满员三分支（spec §3.3）"
```

---

### Task 2: nodeStore——referenceSelect 状态 + 编辑/变换模式联动退出 + 满员提示

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`（NodeState 接口 :294 起加 3 声明；store 实现加字段与 4 个 action；:360-372 两个 setActive* 各加一行联动）
- Modify: `apps/web/src/stores/nodeStore.test.ts`（文件尾追加 describe）

- [ ] **Step 2.1: 写失败测试**

在 `nodeStore.test.ts` 文件末尾追加（import 区按既有文件补 `useNodeStore` 已有则不重复）：

```ts
describe('referenceSelect（画布参考选择模式，spec §3.1）', () => {
  beforeEach(() => {
    useNodeStore.setState({ referenceSelect: null, activeEditNodeId: null, activeTransformNodeId: null });
  });

  it('startReferenceSelect 置状态；exitReferenceSelect 清空', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    expect(useNodeStore.getState().referenceSelect).toEqual({ sourceNodeId: 'img1', notice: null });
    useNodeStore.getState().exitReferenceSelect();
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('setActiveEditNodeId(非null) 自动退出选择模式（编辑模式互斥）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().setActiveEditNodeId('img1');
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('setActiveTransformNodeId(非null) 同样退出', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().setActiveTransformNodeId('img1');
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('setActiveEditNodeId(null) 不触发退出（仅进入时互斥）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().setActiveEditNodeId(null);
    expect(useNodeStore.getState().referenceSelect).not.toBeNull();
  });

  it('flashReferenceNotice 设 notice 并 2.2s 后自动清（vi.useFakeTimers）', () => {
    vi.useFakeTimers();
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().flashReferenceNotice('最多 9 张参考图');
    expect(useNodeStore.getState().referenceSelect?.notice).toBe('最多 9 张参考图');
    vi.advanceTimersByTime(2300);
    expect(useNodeStore.getState().referenceSelect?.notice).toBeNull();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2.2: 跑红**

Run: `npx vitest run src/stores/nodeStore.test.ts`
Expected: 新 describe FAIL（referenceSelect undefined / action 不存在）。

- [ ] **Step 2.3: 实现 nodeStore**

1. `NodeState` 接口（:294 起，`activeTransformNodeId: string | null;` 之后）加：

```ts
  referenceSelect: { sourceNodeId: string; notice: string | null } | null;
  startReferenceSelect: (nodeId: string) => void;
  exitReferenceSelect: () => void;
  flashReferenceNotice: (text: string) => void;
```

2. store 实现对象（`activeTransformNodeId: null,` 初始值旁）加字段 `referenceSelect: null,`，并在 `setActiveTransformNodeId` / `setActiveEditNodeId` 两个实现（:360-372）的 `if` 守卫之后、`set(...)` 之前各插一行：

```ts
    if (id !== null && get().referenceSelect) set({ referenceSelect: null }); // 编辑/变换模式进入即退出参考选择（spec §3.1）
```

3. 新增三个 action（放在 `setActiveEditNodeId` 实现之后）：

```ts
  startReferenceSelect: (nodeId) => set({ referenceSelect: { sourceNodeId: nodeId, notice: null } }),
  exitReferenceSelect: () => set({ referenceSelect: null }),
  flashReferenceNotice: (text) => {
    set((s) => (s.referenceSelect ? { referenceSelect: { ...s.referenceSelect, notice: text } } : s));
    if (_referenceNoticeTimer) clearTimeout(_referenceNoticeTimer);
    _referenceNoticeTimer = setTimeout(() => {
      set((s) => (s.referenceSelect ? { referenceSelect: { ...s.referenceSelect, notice: null } } : s));
    }, 2200);
  },
```

4. 文件模块级（store create 之前，`_editOverlayDragging` 类似位置）加：

```ts
let _referenceNoticeTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2.4: 跑绿**

Run: `npx vitest run src/stores/nodeStore.test.ts`
Expected: 全 PASS（含既有用例）。

- [ ] **Step 2.5: Commit**

```bash
git add src/stores/nodeStore.ts src/stores/nodeStore.test.ts
git commit -m "feat(web): nodeStore referenceSelect 模式状态——start/exit/flashReferenceNotice（2.2s 自动清）+进入编辑/变换模式联动退出（spec §3.1）"
```

---

### Task 3: menuStore——styleLibrary 第三切片 + 三向互斥 + toggle 修 + 跨 store 退出参考模式

**Files:**
- Modify: `apps/web/src/stores/menuStore.ts`（全量替换，42 行小文件）
- Modify: `apps/web/src/stores/menuStore.test.ts`（beforeEach 补初值 + 追加用例）
- Modify: `apps/web/src/pages/canvas/components/HandleAddNodeMenu.test.tsx`（:80 用例补断言）

依赖方向（防 ESM 循环 import）：menuStore → nodeStore 单向（menuStore 内 `useNodeStore.getState().exitReferenceSelect()`）；nodeStore **不** import menuStore——「进入参考选择时关风格库」由 Task 5 的组件层 onClick 收口（风格库开着时背板挡住按钮，该方向实际不可达，组件层一行是保险）。

- [ ] **Step 3.1: 写失败测试**

1. `menuStore.test.ts` 的 beforeEach（:5-7）改为：

```ts
  beforeEach(() => {
    useMenuStore.setState({ isOpen: false, position: undefined, triggerEl: null, lastMousePos: { x: 0, y: 0 }, handleMenu: undefined, styleLibrary: null });
  });
```

2. 文件末尾追加：

```ts
  describe('styleLibrary 第三切片与三向互斥（spec §4.1）', () => {
    it('openStyleLibrary 置切片并清 isOpen/handleMenu', () => {
      useMenuStore.setState({ isOpen: true, position: { x: 1, y: 1 }, handleMenu: { x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } } as any });
      useMenuStore.getState().openStyleLibrary('img1');
      expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'img1' });
      expect(useMenuStore.getState().isOpen).toBe(false);
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
    });

    it('open 清 styleLibrary 与 handleMenu（既有语义保持）', () => {
      useMenuStore.setState({ styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().open();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
    });

    it('openHandleMenu 清 styleLibrary（既有语义保持）', () => {
      useMenuStore.setState({ styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } });
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('closeStyleLibrary 清切片', () => {
      useMenuStore.getState().openStyleLibrary('img1');
      useMenuStore.getState().closeStyleLibrary();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('toggle 由关变开时清 handleMenu 与 styleLibrary（修既有缺陷，spec §4.1）', () => {
      useMenuStore.setState({ isOpen: false, handleMenu: { x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } } as any, styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().toggle();
      expect(useMenuStore.getState().isOpen).toBe(true);
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('三个 open 均跨 store 调 exitReferenceSelect（menuStore→nodeStore 单向）', () => {
      const exitSpy = vi.spyOn(useNodeStore.getState(), 'exitReferenceSelect');
      useMenuStore.getState().open();
      useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } });
      useMenuStore.getState().openStyleLibrary('img1');
      useMenuStore.getState().toggle(); // 由开变关，不触发
      expect(exitSpy).toHaveBeenCalledTimes(3);
      exitSpy.mockRestore();
    });
  });
```

3. 文件顶部 import 补：`import { vi } from 'vitest';`（若无）与 `import { useNodeStore } from './nodeStore';`。

- [ ] **Step 3.2: 跑红**

Run: `npx vitest run src/stores/menuStore.test.ts`
Expected: 新用例 FAIL（styleLibrary/action 不存在；spy 断言 0 次）。

- [ ] **Step 3.3: 实现 menuStore（全量替换）**

```ts
import { create } from 'zustand';
import { useNodeStore } from './nodeStore';

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
  styleLibrary: { nodeId: string } | null;
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  updateMousePos: (pos: { x: number; y: number }) => void;
  open: (pos?: { x: number; y: number }) => void;
  close: () => void;
  toggle: () => void;
  openHandleMenu: (m: HandleMenuState) => void;
  closeHandleMenu: () => void;
  openStyleLibrary: (nodeId: string) => void;
  closeStyleLibrary: () => void;
}

export const useMenuStore = create<MenuState>((set, get) => {
  // 三个 open 统一收口：清其余两切片 + 退出画布参考选择模式（spec §4.1；
  // 单向依赖 nodeStore——反向由组件层 onClick 收口防 ESM 循环）
  const exitRefSelect = () => { useNodeStore.getState().exitReferenceSelect(); };
  return {
    isOpen: false,
    position: undefined,
    triggerEl: null,
    lastMousePos: { x: 0, y: 0 },
    handleMenu: undefined,
    styleLibrary: null,
    setTriggerEl: (el) => set({ triggerEl: el }),
    updateMousePos: (pos) => set({ lastMousePos: pos }),
    open: (pos) => { exitRefSelect(); set({ isOpen: true, position: pos, handleMenu: undefined, styleLibrary: null }); },
    close: () => set({ isOpen: false, position: undefined }),
    toggle: () => {
      if (get().isOpen) { set({ isOpen: false, position: undefined }); return; }
      exitRefSelect();
      set({ isOpen: true, handleMenu: undefined, styleLibrary: null });
    },
    openHandleMenu: (m) => { exitRefSelect(); set({ handleMenu: m, isOpen: false, position: undefined, styleLibrary: null }); },
    closeHandleMenu: () => set({ handleMenu: undefined }),
    openStyleLibrary: (nodeId) => { exitRefSelect(); set({ styleLibrary: { nodeId }, isOpen: false, position: undefined, handleMenu: undefined }); },
    closeStyleLibrary: () => set({ styleLibrary: null }),
  };
});
```

- [ ] **Step 3.4: 跑绿 + HandleAddNodeMenu.test 补断言**

Run: `npx vitest run src/stores/menuStore.test.ts`
Expected: 全 PASS。

在 `HandleAddNodeMenu.test.tsx` 的「menuStore 双向互斥」用例（:80）末尾追加断言（该用例名同步改为「menuStore 三向互斥…」）：

```tsx
    // 三切片（spec §4.1）：openStyleLibrary 清 isOpen/handleMenu，open/openHandleMenu 清 styleLibrary
    useMenuStore.getState().openStyleLibrary('img9');
    expect(useMenuStore.getState().isOpen).toBe(false);
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
    useMenuStore.getState().open({ x: 3, y: 3 });
    expect(useMenuStore.getState().styleLibrary).toBeNull();
```

Run: `npx vitest run src/pages/canvas/components/HandleAddNodeMenu.test.tsx`
Expected: 全 PASS。

- [ ] **Step 3.5: 全量回归 + Commit**

Run: `npx vitest run`（cwd=apps/web）
Expected: 全绿（AddNodeMenu/page 等消费 menuStore 的既有测试若因新字段失败，按其 mock 模式补 `styleLibrary: null` 初值）。

```bash
git add src/stores/menuStore.ts src/stores/menuStore.test.ts src/pages/canvas/components/HandleAddNodeMenu.test.tsx
git commit -m "feat(web): menuStore styleLibrary 第三切片——三向互斥（open/openHandleMenu/openStyleLibrary 各清其余+跨 store 退出参考选择）+toggle 由关变开清其余（修既有缺陷）"
```

---

### Task 4: SortableImageItem——序号/X 角标两态 + overflow 下移防裁切

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx`

要点（spec §3.4/D8/B18）：`index?: number` prop；角标挂外层 relative 容器（一半悬外），内层新容器承接 `overflow-hidden` 圆角裁切；两态复用既有本地 `hovered`（原生 mouseover/out）；uploading/error 态角标仍显示（z-10）；X 按钮从 StatusOverlay 的 success 分支移除，由角标接管删除。同文件已在 no-theme-utility 白名单（allow:['bg','text']），角标沿用 bg-black/text-white 零登记成本。

- [ ] **Step 4.1: 写失败测试**

在 `SortableImageItem.test.tsx` 的 describe 末尾追加（import 区补 `fireEvent` 若无）：

```tsx
  // ---- 序号/X 角标两态（spec §3.4，D8）----
  it('9. 传 index 时常态渲染序号角标（index+1），一半悬外（translate 50%,-50%）', () => {
    render(<SortableImageItem image={baseImage} index={2} onDelete={onDelete} onClick={onClick} />);
    const badge = screen.getByTestId('ref-badge-index');
    expect(badge.textContent).toBe('3');
    expect(badge.parentElement?.style.transform).toBe('translate(50%, -50%)');
  });

  it('10. hover 后角标变 X，点击调 onDelete；移出还原序号', () => {
    const { container } = render(<SortableImageItem image={baseImage} index={0} onDelete={onDelete} onClick={onClick} />);
    const item = container.querySelector('.group') as Element;
    fireEvent.mouseOver(item, { relatedTarget: document.body });
    fireEvent.click(screen.getByTestId('ref-badge-x'));
    expect(onDelete).toHaveBeenCalledWith(baseImage.id);
    fireEvent.mouseOut(item, { relatedTarget: document.body });
    expect(screen.getByTestId('ref-badge-index')).toBeInTheDocument();
  });

  it('11. uploading 态序号角标仍显示（z 高于进度蒙层，B18）', () => {
    render(<SortableImageItem image={{ ...baseImage, status: 'uploading', progress: 42 }} index={0} onDelete={onDelete} onClick={onClick} />);
    expect(screen.getByTestId('ref-badge-index').textContent).toBe('1');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('12. 不传 index 时不渲染角标（MultiImageConfigPanel 同名组件不受影响的语义护栏）', () => {
    render(<SortableImageItem image={baseImage} onDelete={onDelete} onClick={onClick} />);
    expect(screen.queryByTestId('ref-badge-index')).not.toBeInTheDocument();
  });
```

同时把既有用例 #3（:60-67）与 #7（:112-120）中 `screen.getByText('×')` 改为两态路径：

```tsx
  it('3. success state shows delete button (×)（hover 后角标变 X）', () => {
    const { container } = render(<SortableImageItem image={baseImage} index={0} onDelete={onDelete} onClick={onClick} />);
    fireEvent.mouseOver(container.querySelector('.group') as Element, { relatedTarget: document.body });
    expect(screen.getByTestId('ref-badge-x')).toBeInTheDocument();
  });

  it('7. clicking delete button calls onDelete(image.id)', () => {
    const { container } = render(<SortableImageItem image={baseImage} index={0} onDelete={onDelete} onClick={onClick} />);
    fireEvent.mouseOver(container.querySelector('.group') as Element, { relatedTarget: document.body });
    fireEvent.click(screen.getByTestId('ref-badge-x'));
    expect(onDelete).toHaveBeenCalledWith(baseImage.id);
  });
```

（既有用例 1/2/4/5/6/8 不动——#2 的进度蒙层、#5/#6 的点击行为在新 DOM 下语义不变。）

- [ ] **Step 4.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx`
Expected: 新用例 9-12 FAIL；改造后的 #3/#7 FAIL（无角标 testid）。

- [ ] **Step 4.3: 实现**

`SortableImageItem.tsx` 三处改动：

1. props 加 `index?: number;`（:7-11 接口）并解构；
2. `StatusOverlay` 的 `if (status === 'success' && !isDragging)` 分支（:42-52）**整段删除**（X 由角标接管；uploading/error 蒙层保留）；
3. JSX（:120-142）替换为：

```tsx
  return (
    <>
      <div
        ref={setRef}
        style={style}
        {...attributes}
        {...listeners}
        className="w-[50px] h-[50px] flex-shrink-0 cursor-pointer relative group"
      >
        {/* 内层承接圆角裁切——角标挂外层一半悬外不被裁（spec §3.4 防裁切第 1 层；第 2 层=工具行 pt-3 在 Task 5） */}
        <div className="w-full h-full rounded-md overflow-hidden border border-[#2A2A34]">
          <img
            src={url}
            alt={name}
            className="w-full h-full object-cover"
            onClick={handleClick}
          />
        </div>

        {(status === 'uploading' || status === 'error') && (
          <StatusOverlay status={status} progress={progress} isDragging={isDragging} onDelete={handleDelete} />
        )}

        {typeof index === 'number' && (
          <div
            data-testid={hovered && status === 'success' && !isDragging ? 'ref-badge-x-wrap' : 'ref-badge-index-wrap'}
            className="absolute top-0 right-0 z-10"
            style={{ transform: 'translate(50%, -50%)' }}
          >
            {hovered && status === 'success' && !isDragging ? (
              <button
                data-testid="ref-badge-x"
                onClick={handleDelete}
                aria-label="删除图片"
                className="w-[18px] h-[18px] bg-black text-white rounded-full flex items-center justify-center text-[11px]"
              >
                ×
              </button>
            ) : (
              <span
                data-testid="ref-badge-index"
                className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-black/70 px-1 text-[10px] font-medium text-white"
              >
                {index + 1}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Preview popup —— 保持不动（:144-168 原样） */}
      {hovered && status === 'success' && containerRef.current && ( /* …原 portal JSX 原样保留… */ )}
    </>
  );
```

（预览 portal 段原样保留；StatusOverlay 组件签名不变，仅剩 uploading/error 两个分支生效。）

- [ ] **Step 4.4: 跑绿**

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx`
Expected: 全 PASS（含既有 1/2/4/5/6/8）。

- [ ] **Step 4.5: Commit**

```bash
git add src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx
git commit -m "feat(web): 参考图序号/X 角标两态——index prop+一半悬外角标（hover 复用原生 hovered 态变 X 删除）+overflow 下移内层防裁切+uploading 态角标仍显示（spec §3.4/D8/B18）"
```

---

### Task 5: ImageThumbnailBar——参考按钮=模式入口恒显 + 删 file input + pt-3 + 风格按钮开库

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`

要点（spec §3.1/D19）：参考按钮脱离 `showUploadButton` 门控**恒显**（语义=模式入口）；删除隐藏 file input/`handleUploadClick`/`handleFileChange`（拖拽 handleDrop/processUpload 保留）；图标换「卡片选择」（与横幅同款）；`pt-3` 防外层裁切（**spike 步骤先跑**）；风格按钮 onClick → `openStyleLibrary(nodeId)`（menuStore Task 3 已就绪；进入参考选择时关风格库的组件层收口也在此）。

- [ ] **Step 5.1: spike——pt-3 三面板布局影响（B22，浏览器 5 分钟）**

启动 dev server（`pnpm dev`，apps/web），在任一画布放一个图片节点（无主图、单选见图 5 面板），肉眼确认：工具行加 `pt-3` 后条高 +12px、面板不溢出、风格/参考 56px 按钮与 50px 缩略图垂直对齐可接受。不可接受则回到本任务调整（如 pt-2.5+角标 16px 组合）并把结论登记 spec §3.4。spike 通过后继续。

- [ ] **Step 5.2: 写失败测试**

`ImageThumbnailBar.test.tsx` 改造（先红）：

1. **#3**（:122-135）改为「参考按钮恒显（满员不隐藏，D19）」：

```tsx
  it('3. 参考 button 仍渲染 when images.length >= maxCount（模式入口恒显，D19）', () => {
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
    expect(screen.getByTestId('upload-button')).toBeInTheDocument();
  });
```

2. **#7**（:223-263）触发方式由 file-input change 改为 drop（上传路径仅剩拖拽/粘贴，D2）：

```tsx
  it('7. drop upload complete calls onImageUploaded(imageId) for each uploaded image', async () => {
    const uploadedItems: ImageItem[] = [
      { id: 'new-1', url: 'url-new-1', name: 'new-1.jpg', status: 'success' },
      { id: 'new-2', url: 'url-new-2', name: 'new-2.jpg', status: 'success' },
    ];
    mockUploadBatchImages.mockResolvedValue(uploadedItems);

    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
        maxCount={9}
      />,
    );

    const container = screen.getByTestId('thumbnail-bar');
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    fireEvent(container, dropEvent);

    await waitFor(() => {
      expect(onImageUploaded).toHaveBeenCalledTimes(2);
    });
    expect(onChange).toHaveBeenCalledWith([...baseImages, ...uploadedItems]);
  });
```

3. **#8**（:265-295）disabled 断言改为「disabled 时参考/风格按钮仍渲染（恒显）」：把 `expect(screen.queryByTestId('upload-button')).not.toBeInTheDocument();` 删除，改为 `expect(screen.getByTestId('upload-button')).toBeInTheDocument();`（drop 不触发上传的断言保留）。

4. **#12**（:347-361）改为模式入口：

```tsx
  it('12. clicking 参考 button enters canvas reference select mode（不再触发 file input）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    fireEvent.click(screen.getByTestId('upload-button'));
    expect(useNodeStore.getState().referenceSelect).toEqual({ sourceNodeId: 'node-1', notice: null });
    useNodeStore.getState().exitReferenceSelect();
  });
```

5. **#14**（:386-402）改为卡片选择图标断言：

```tsx
  it('14. 参考 button 图标为卡片选择（三层叠卡 stroke，替换 + 号上传语义）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    const svg = screen.getByTestId('upload-button').querySelector('svg');
    expect(svg?.getAttribute('data-icon')).toBe('card-select');
  });
```

6. **新增 #16/#17**（文件末尾追加）：

```tsx
  it('16. 风格 button opens style library（menuStore.styleLibrary）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '风格' }));
    expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'node-1' });
    useMenuStore.getState().closeStyleLibrary();
  });

  it('17. 点击参考按钮时先关风格库（组件层收口互斥，nodeStore→menuStore 方向）', () => {
    render(
      <ImageThumbnailBar
        nodeId="node-1"
        images={baseImages}
        onChange={onChange}
        onImageClick={onImageClick}
        onImageUploaded={onImageUploaded}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '风格' }));
    fireEvent.click(screen.getByTestId('upload-button'));
    expect(useMenuStore.getState().styleLibrary).toBeNull();
    expect(useNodeStore.getState().referenceSelect).not.toBeNull();
    useNodeStore.getState().exitReferenceSelect();
  });
```

7. import 区补 `import { useNodeStore } from '@/stores/nodeStore';`、`import { useMenuStore } from '@/stores/menuStore';`；文件顶部 beforeEach 若无 store 重置则加 `beforeEach(() => { useNodeStore.getState().exitReferenceSelect(); useMenuStore.getState().closeStyleLibrary(); });`。

- [ ] **Step 5.3: 跑红**

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`
Expected: #3/#7/#12/#14/#16/#17 FAIL（现状 #3 旧断言先被新代码打死、新断言红）。

- [ ] **Step 5.4: 实现 ImageThumbnailBar.tsx**

1. import 区：删 `useRef`（若仅 fileInputRef 使用）、加 `import { useNodeStore } from '@/stores/nodeStore';`、`import { useMenuStore } from '@/stores/menuStore';`；
2. 删除 `fileInputRef`、`handleUploadClick`、`handleFileChange`（:42、:92-94、:82-85）与 JSX 中的 `<input ... data-testid="file-input">`（:133-141）；
3. `showUploadButton` 变量删除；参考按钮 JSX（:118-143 的 `{showUploadButton && (...)}` 包裹解除，按钮本身移出条件），按钮改为：

```tsx
      {/* 参考按钮 = 画布选择模式入口（spec §3.1/D19：恒显、图标=卡片选择；进入时组件层关闭风格库——nodeStore→menuStore 方向收口防 ESM 循环） */}
      <button
        data-testid="upload-button"
        aria-label="参考"
        onClick={() => {
          useMenuStore.getState().closeStyleLibrary();
          useNodeStore.getState().startReferenceSelect(nodeId);
        }}
        className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-overlay-2 transition-colors hover:bg-overlay-3 focus:outline-none shadow-none outline-none"
      >
        <svg data-icon="card-select" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <path d="M6.5 17.5H14A3.5 3.5 0 0 0 17.5 14V6.5" />
          <path d="M6.5 6.5h3v3h-3z" fill="currentColor" stroke="none" />
        </svg>
        <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">参考</span>
      </button>
```

4. 风格按钮（:106-116）加 onClick：`onClick={() => useMenuStore.getState().openStyleLibrary(nodeId)}`（aria-label/样式不动）；
5. 容器 div（:99-105）className 首项 `flex items-center gap-2 overflow-x-auto pb-1` → `flex items-center gap-2 overflow-x-auto pt-3 pb-1`（防裁切第 2 层，spec §3.4）；
6. `SortableImageItem` 渲染处（:151-158）传 `index={images.findIndex((img) => img.id === image.id)}`——直接 map 下标更简：`{images.map((image, idx) => (<SortableImageItem key={image.id} index={idx} ... />))}`。

- [ ] **Step 5.5: 跑绿 + 全量回归**

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/`（含 ImageConfigPanel/VideoConfigPanel 面板测试——它们 mock 掉本组件不受影响；PromptInput.test 若断言 file-input 需同步检查）
Expected: 全 PASS。

Run: `npx vitest run`（cwd=apps/web）
Expected: 全绿。

- [ ] **Step 5.6: Commit**

```bash
git add src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx
git commit -m "feat(web): 参考按钮=画布选择模式入口——恒显脱离 maxCount 门控+卡片选择图标+删 file input（拖拽/粘贴保留）+pt-3 防裁切+风格按钮开风格库（组件层互斥收口）（spec §3.1/D19/D2）"
```

---

### Task 6: CanvasReferenceSelectBanner——顶部横幅

**Files:**
- Create: `apps/web/src/pages/canvas/components/CanvasReferenceSelectBanner.tsx`
- Create: `apps/web/src/pages/canvas/components/CanvasReferenceSelectBanner.test.tsx`

要点（spec §3.2）：absolute 顶部居中（ReactFlow 子级、不随 viewport 变换）；`role="status"` 在文案 span；Esc=纯退出；「返回节点」=退出+滚动+选中（`setCenter` 用 RF `internals.positionAbsolute ?? position`）；notice 由 store flash 驱动。

- [ ] **Step 6.1: 写失败测试**

创建 `CanvasReferenceSelectBanner.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasReferenceSelectBanner } from './CanvasReferenceSelectBanner';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(vi.fn(), {
    getState: () => ({ selectNode: vi.fn() }),
  }),
}));

const setCenter = vi.fn();
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ setCenter }),
}));

describe('CanvasReferenceSelectBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeStore.setState({
      referenceSelect: null,
      nodes: { img1: { id: 'img1', type: 'imageGen', position: { x: 100, y: 200 }, data: {} } } as any,
    });
  });

  it('模式未激活不渲染', () => {
    render(<CanvasReferenceSelectBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('激活时渲染图标+文案(status)+返回节点+退出', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    render(<CanvasReferenceSelectBanner />);
    expect(screen.getByRole('status').textContent).toBe('从画布选择参考');
    expect(screen.getByRole('button', { name: '返回节点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出' })).toBeInTheDocument();
  });

  it('notice 替换文案（满员提示）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().flashReferenceNotice('最多 9 张参考图');
    render(<CanvasReferenceSelectBanner />);
    expect(screen.getByRole('status').textContent).toBe('最多 9 张参考图');
  });

  it('退出按钮 / Esc → 纯退出（不选中）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    render(<CanvasReferenceSelectBanner />);
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(useNodeStore.getState().referenceSelect).toBeNull();
    useNodeStore.getState().startReferenceSelect('img1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('返回节点 → 退出+setCenter 到节点中心+selectNode', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    // 节点宽高走 measured 兜底 0——setCenter 断言用 (100, 200)
    useNodeStore.setState({
      nodes: { img1: { id: 'img1', type: 'imageGen', position: { x: 100, y: 200 }, data: {}, measured: { width: 200, height: 150 } } } as any,
    });
    render(<CanvasReferenceSelectBanner />);
    fireEvent.click(screen.getByRole('button', { name: '返回节点' }));
    expect(useNodeStore.getState().referenceSelect).toBeNull();
    expect(setCenter).toHaveBeenCalledWith(200, 275, expect.anything());
    expect(useCanvasStore.getState().selectNode).toHaveBeenCalledWith('img1');
  });
});
```

- [ ] **Step 6.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/CanvasReferenceSelectBanner.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 6.3: 实现**

创建 `CanvasReferenceSelectBanner.tsx`：

```tsx
import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

/** 画布参考选择模式横幅（spec §3.2）——挂 ReactFlow 子级（absolute 顶部居中，不随 viewport 变换）。 */
export function CanvasReferenceSelectBanner() {
  const referenceSelect = useNodeStore((s) => s.referenceSelect);
  const { setCenter } = useReactFlow();

  useEffect(() => {
    if (!referenceSelect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useNodeStore.getState().exitReferenceSelect();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [referenceSelect]);

  if (!referenceSelect) return null;

  const handleReturn = () => {
    const { sourceNodeId } = referenceSelect;
    const node = useNodeStore.getState().nodes[sourceNodeId] as any;
    useNodeStore.getState().exitReferenceSelect();
    if (node) {
      const abs = node.internals?.positionAbsolute ?? node.position ?? { x: 0, y: 0 };
      const w = node.measured?.width ?? node.width ?? 0;
      const h = node.measured?.height ?? node.height ?? 0;
      setCenter(abs.x + w / 2, abs.y + h / 2, { duration: 300 });
      useCanvasStore.getState().selectNode?.(sourceNodeId);
    }
  };

  return (
    <div
      data-testid="canvas-reference-banner"
      className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2"
      style={{
        backgroundColor: 'var(--canvas-controls-bg)',
        border: '1px solid var(--canvas-controls-border)',
        boxShadow: 'var(--canvas-shadow-dropdown)',
      }}
    >
      <span aria-hidden="true" className="flex size-6 items-center justify-center text-text-dim-2">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <path d="M6.5 17.5H14A3.5 3.5 0 0 0 17.5 14V6.5" />
          <path d="M6.5 6.5h3v3h-3z" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span role="status" className="whitespace-nowrap text-[13px] text-text">
        {referenceSelect.notice ?? '从画布选择参考'}
      </span>
      <button
        type="button"
        onClick={handleReturn}
        className="rounded-lg px-2.5 py-1 text-[13px] text-text transition-colors hover:bg-overlay-2"
      >
        返回节点
      </button>
      <button
        type="button"
        onClick={() => useNodeStore.getState().exitReferenceSelect()}
        className="rounded-lg px-2.5 py-1 text-[13px] text-text-dim-2 transition-colors hover:bg-overlay-2 hover:text-text"
      >
        退出
      </button>
    </div>
  );
}
```

- [ ] **Step 6.4: 跑绿**

Run: `npx vitest run src/pages/canvas/components/CanvasReferenceSelectBanner.test.tsx`
Expected: 全 PASS。

- [ ] **Step 6.5: Commit**

```bash
git add src/pages/canvas/components/CanvasReferenceSelectBanner.tsx src/pages/canvas/components/CanvasReferenceSelectBanner.test.tsx
git commit -m "feat(web): 画布参考选择顶部横幅——图标/文案(status)/返回节点(setCenter+选中)/退出/Esc，notice 满员提示，controls-bg/border/dropdown token（spec §3.2）"
```

---

### Task 7: CanvasView + page.tsx 接线（双 prop / onNodeClick 分支 / deleteKeyCode / Tab gate / 挂横幅）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`
- Modify: `apps/web/src/pages/canvas/page.tsx`

薄接线任务（决策已纯函数化 Task 1、状态已 store 化 Task 2/6）：ReactFlow 真实手势下 onNodeClick 与拖拽抑制由 tsc + 全量回归 + Task 18 人工验收承保（先例：image-node-panel-redesign Task 9 同款定位）。

- [ ] **Step 7.1: CanvasView 接线**

1. import 区补：`import { decideReferencePick } from './referenceSelect';`、`import { CanvasReferenceSelectBanner } from './CanvasReferenceSelectBanner';`、`import { getMediaUrl } from '@/api/mediaApi';`（`useNodeStore` 已有）。
2. 组件体（:105 `isLocked` 之后）加：

```tsx
  const referenceSelect = useNodeStore((s) => s.referenceSelect);
  const inRefSelect = referenceSelect !== null;
```

3. `onNodeClick`（:200-209）在函数体最前面插分支：

```tsx
    // 画布参考选择模式（spec §3.3/D25）：elementsSelectable=false 已保发起节点选中，此处只做拾取
    if (ns.referenceSelect) {
      void handleReferencePick(ns.referenceSelect.sourceNodeId, node);
      return;
    }
```

4. `onNodeClick` 定义之前加拾取函数（`useCallback`）：

```tsx
  const handleReferencePick = useCallback(async (sourceNodeId: string, targetNode: any) => {
    const store = useNodeStore.getState();
    const source = store.nodes[sourceNodeId];
    const currentImages = source?.data?.allImages ?? [];
    const decision = decideReferencePick(sourceNodeId, targetNode, currentImages.map((i: { id: string }) => i.id), 9);
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'full') {
      store.flashReferenceNotice('最多 9 张参考图');
      return;
    }
    try {
      const { url } = await getMediaUrl(decision.fileId); // presign（spec §3.3；ImageItem.url 本就是 presign 结果）
      const name = (targetNode?.data?.mediaName as string) || '参考图';
      const latest = (useNodeStore.getState().nodes[sourceNodeId]?.data?.allImages ?? []) as { id: string }[];
      useNodeStore.getState().updatePromptImages(sourceNodeId, [
        ...latest,
        { id: decision.fileId, url, name, status: 'success' as const },
      ]);
    } catch {
      // presign 失败该次忽略（spec §3.3）
    }
  }, []);
```

（`ImageItem` 形状按 `@/stores/nodeStore` 既有类型；若 tsc 要求 name/progress 可选字段按其接口补齐。）

5. ReactFlow props（:425/:434/:436）三处改：

```tsx
        deleteKeyCode={editorOpen || inRefSelect ? [] : ['Backspace', 'Delete']}
```
```tsx
        nodesDraggable={inRefSelect ? false : !isLocked}
        nodesFocusable={!isLocked}
        elementsSelectable={inRefSelect ? false : !isLocked}
```

6. ReactFlow 子级（`<CanvasToolbar ...>` 同级，组件内既有 children 区）挂 `<CanvasReferenceSelectBanner />`。

- [ ] **Step 7.2: page.tsx Tab gate**

`CanvasKeyboardHandler` 的 handleKeyDown（:336-339 早退区）`if (useVideoEditorStore.getState().open) return;` 之后补一行：

```tsx
      if (useNodeStore.getState().referenceSelect) return; // 参考选择模式禁画布快捷键（含 Tab→AddNodeMenu，spec §3.1）
```

（`useNodeStore` 已在 page.tsx import；若无需补 import。）

- [ ] **Step 7.3: 验证**

Run: `npx vitest run src/pages/canvas/components/CanvasView.test.tsx src/pages/canvas/page.test.tsx && npx tsc -b --pretty false | head -20`
Expected: 既有测试全 PASS；tsc 无新增报错（CanvasView.test 的 nodeStore mock 若缺 referenceSelect 键，按其既有 mock 模式补 `referenceSelect: null`）。

- [ ] **Step 7.4: Commit**

```bash
git add src/pages/canvas/components/CanvasView.tsx src/pages/canvas/page.tsx
git commit -m "feat(web): 参考选择模式接线——nodesDraggable+elementsSelectable 双 prop（D25）/onNodeClick 拾取分支（presign 异步+读最新写回）/deleteKeyCode 置空/Tab 键 gate/挂横幅（spec §3.3）"
```

---

### Task 8: Prisma——4 新表 + User 反向关系 + migration + seed.ts 分类种子

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（User :41 后加 2 行；文件末尾加 4 模型）
- Modify: `apps/api/prisma/seed.ts`（main 末尾追加分类种子）

- [ ] **Step 8.1: schema 修改**

1. `User` 模型 `videoProjects VideoProject[]`（:41）之后加：

```prisma
  styleFavorites        StyleFavorite[]
  styleRecentUsages     StyleRecentUsage[]
```

2. schema 文件末尾追加（spec §5 定稿——索引拆两条/方向对齐 ORDER BY/join 表 @id+@@unique/Cascade）：

```prisma
model StyleCategory {
  id        String        @id @default(cuid())
  name      String        @unique
  sortOrder Int           @default(0)
  active    Boolean       @default(true)
  createdAt DateTime      @default(now())
  styles    Style[]
  @@index([active, sortOrder])
}

model Style {
  id           String             @id @default(cuid())
  name         String
  category     StyleCategory      @relation(fields: [categoryId], references: [id])
  categoryId   String
  coverKey     String
  authorName   String?
  isCommercial Boolean            @default(false)
  promptText   String
  sortOrder    Int                @default(0)
  active       Boolean            @default(true)
  usageCount   Int                @default(0)
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt
  favorites    StyleFavorite[]
  recents      StyleRecentUsage[]
  @@index([active, sortOrder, usageCount(sort: Desc), id])
  @@index([categoryId, active])
}

model StyleFavorite {
  id        String   @id @default(cuid())
  userId    String
  styleId   String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  style     Style    @relation(fields: [styleId], references: [id], onDelete: Cascade)
  @@unique([userId, styleId])
  @@index([userId, createdAt])
}

model StyleRecentUsage {
  id         String   @id @default(cuid())
  userId     String
  styleId    String
  lastUsedAt DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
  style      Style    @relation(fields: [styleId], references: [id], onDelete: Cascade)
  @@unique([userId, styleId])
  @@index([userId, lastUsedAt])
}
```

- [ ] **Step 8.2: validate + migrate**

Run（cwd=apps/api）:
```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name add-style-tables
```
Expected: validate 通过；migration 生成（本地时间戳目录，纯 DDL 零 INSERT——spec D18）并应用。若 migrate 需 CREATEDB 授权按仓内惯例（flowweb_db_migration_env 记忆）一次性授权。

- [ ] **Step 8.3: seed.ts 分类种子**

`seed.ts` 的 `main()` 末尾（关闭 prisma 连接之前）追加：

```ts
  // ====== 风格库初始分类（spec §5，固定 id 幂等 upsert） ======
  const STYLE_CATEGORIES: Array<{ id: string; name: string; sortOrder: number }> = [
    { id: 'seed-style-cat-1', name: '摄影写真', sortOrder: 1 },
    { id: 'seed-style-cat-2', name: '电商营销', sortOrder: 2 },
    { id: 'seed-style-cat-3', name: '动漫游戏', sortOrder: 3 },
    { id: 'seed-style-cat-4', name: '风格插画', sortOrder: 4 },
    { id: 'seed-style-cat-5', name: '平面设计', sortOrder: 5 },
    { id: 'seed-style-cat-6', name: '建筑及室内设计', sortOrder: 6 },
    { id: 'seed-style-cat-7', name: '创意玩法', sortOrder: 7 },
    { id: 'seed-style-cat-8', name: '文创周边', sortOrder: 8 },
    { id: 'seed-style-cat-9', name: '小说推文', sortOrder: 9 },
  ];
  for (const c of STYLE_CATEGORIES) {
    await prisma.styleCategory.upsert({ where: { id: c.id }, update: {}, create: c });
  }
```

- [ ] **Step 8.4: 跑 seed 验证**

Run（cwd=apps/api）: `pnpm exec prisma db seed`
Expected: 无错；`pnpm exec prisma studio` 或 psql 抽查 styleCategory 9 行（可选）。

- [ ] **Step 8.5: api 侧类型回归**

Run: `pnpm test`（cwd=apps/api）
Expected: 全绿（既有 prisma 相关测试不破坏）。

- [ ] **Step 8.6: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts prisma/migrations
git commit -m "feat(api): 风格库 4 新表——StyleCategory/Style(+coverKey+双索引方向对齐 ORDER BY)/StyleFavorite/StyleRecentUsage(@id+@@unique+Cascade)+User 反向关系+seed 9 分类（spec §5/D18/D26）"
```

---

### Task 9: styles 用户侧——service + controller（列表/分类/详情/收藏/use）

**Files:**
- Create: `apps/api/src/modules/styles/styles.service.ts`
- Create: `apps/api/src/modules/styles/styles.controller.ts`
- Create: `apps/api/src/modules/styles/styles.service.spec.ts`

要点（spec §6.1/D14/D23/D26）：非事务三步 use；favorite createMany skipDuplicates/deleteMany；favorited 批量；presign coverUrl（minio.generatePresignedGetUrl 3600）；404 钉死；排序含 id tiebreaker。

- [ ] **Step 9.1: 写失败测试**

创建 `styles.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StylesService } from './styles.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

const mkPrisma = () => ({
  styleCategory: { findMany: vi.fn() },
  style: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  styleFavorite: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  styleRecentUsage: {
    create: vi.fn(),
    update: vi.fn(),
  },
});

const mkMinio = () => ({ generatePresignedGetUrl: vi.fn().mockResolvedValue('/signed.png') });

describe('StylesService', () => {
  let service: StylesService;
  let prisma: ReturnType<typeof mkPrisma>;
  let minio: ReturnType<typeof mkMinio>;

  beforeEach(async () => {
    prisma = mkPrisma();
    minio = mkMinio();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StylesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get(StylesService);
  });

  describe('listCategories', () => {
    it('active 分类按 sortOrder asc', async () => {
      prisma.styleCategory.findMany.mockResolvedValue([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]);
      const out = await service.listCategories();
      expect(prisma.styleCategory.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(out).toEqual([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]);
    });
  });

  describe('list', () => {
    it('tab=all：active 过滤+排序含 id tiebreaker+favorited 批量+presign', async () => {
      prisma.style.findMany.mockResolvedValue([
        { id: 's1', name: 'A', coverKey: 'k1', authorName: null, isCommercial: true, usageCount: 3, promptText: 'p1', active: true },
      ]);
      prisma.styleFavorite.findMany.mockResolvedValue([{ styleId: 's1' }]);
      const out = await service.list('u1', { tab: 'all', page: 1, pageSize: 20 });
      expect(prisma.style.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ active: true }),
        orderBy: [{ sortOrder: 'asc' }, { usageCount: 'desc' }, { id: 'asc' }],
      }));
      expect(out.items[0]).toMatchObject({ id: 's1', coverUrl: '/signed.png', favorited: true, promptText: 'p1' });
      expect(prisma.styleFavorite.findMany).toHaveBeenCalledWith({ where: { userId: 'u1', styleId: { in: ['s1'] } }, select: { styleId: true } });
    });

    it('tab=favorites：join 收藏+active 过滤+createdAt desc,id asc', async () => {
      prisma.style.findMany.mockResolvedValue([]);
      await service.list('u1', { tab: 'favorites', page: 1, pageSize: 20 });
      expect(prisma.style.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ active: true, favorites: { some: { userId: 'u1' } } }),
        orderBy: [{ favorites: { _count: 'desc' } }, { id: 'asc' }],
      }));
    });
  });

  describe('getById', () => {
    it('不存在/停用 → 404（钉死语义，spec §4.5）', async () => {
      prisma.style.findFirst.mockResolvedValue(null);
      await expect(service.getById('u1', 'sx')).rejects.toThrow(NotFoundException);
    });
  });

  describe('favorite', () => {
    it('favorited=true → createMany skipDuplicates（幂等无 P2002）', async () => {
      prisma.styleFavorite.createMany.mockResolvedValue({ count: 1 });
      const out = await service.favorite('u1', 's1', true);
      expect(prisma.styleFavorite.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u1', styleId: 's1' }], skipDuplicates: true,
      });
      expect(out).toEqual({ favorited: true });
    });

    it('favorited=false → deleteMany（0 行不抛）', async () => {
      prisma.styleFavorite.deleteMany.mockResolvedValue({ count: 0 });
      const out = await service.favorite('u1', 's1', false);
      expect(out).toEqual({ favorited: false });
    });
  });

  describe('use（D26 非事务三步）', () => {
    it('首次：create 成功 → updateMany 计数（where 折进 active）', async () => {
      prisma.style.findFirst.mockResolvedValue({ id: 's1', active: true, coverKey: 'k' });
      prisma.styleRecentUsage.create.mockResolvedValue({});
      const out = await service.use('u1', 's1');
      expect(prisma.styleRecentUsage.create).toHaveBeenCalledWith({ data: { userId: 'u1', styleId: 's1' } });
      expect(prisma.style.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', active: true }, data: { usageCount: { increment: 1 } },
      });
      expect(out.style.id).toBe('s1');
    });

    it('重复使用：create 撞 P2002 → 退化 update lastUsedAt，不计数', async () => {
      prisma.style.findFirst.mockResolvedValue({ id: 's1', active: true, coverKey: 'k' });
      prisma.styleRecentUsage.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await service.use('u1', 's1');
      expect(prisma.styleRecentUsage.update).toHaveBeenCalledWith({
        where: { userId_styleId: { userId: 'u1', styleId: 's1' } },
        data: { lastUsedAt: expect.any(Date) },
      });
      expect(prisma.style.updateMany).not.toHaveBeenCalled();
    });

    it('停用/不存在 → 404', async () => {
      prisma.style.findFirst.mockResolvedValue(null);
      await expect(service.use('u1', 'sx')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 9.2: 跑红**

Run: `npx vitest run src/modules/styles/styles.service.spec.ts`（cwd=apps/api）
Expected: FAIL（模块不存在）。

- [ ] **Step 9.3: 实现 styles.service.ts**

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

export interface StyleListItem {
  id: string; name: string; coverUrl: string; authorName: string | null;
  isCommercial: boolean; usageCount: number; promptText: string; favorited: boolean;
}

const PAGE_SIZE_MAX = 50;

@Injectable()
export class StylesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  listCategories() {
    return this.prisma.styleCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  }

  async list(
    userId: string,
    q: { tab: string; categoryId?: string; search?: string; commercialOnly?: boolean; page?: number; pageSize?: number },
  ): Promise<{ items: StyleListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(q.pageSize) || 20));

    const where: any = { active: true };
    if (q.tab === 'favorites') where.favorites = { some: { userId } };
    if (q.tab === 'recent') where.recents = { some: { userId } };
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.commercialOnly) where.isCommercial = true;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { authorName: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    // 排序含 id tiebreaker（spec §4.2——偏移分页需稳定序）
    const orderBy =
      q.tab === 'favorites'
        ? [{ favorites: { _count: 'desc' as const } }, { id: 'asc' as const }]
        : q.tab === 'recent'
          ? [{ recents: { _count: 'desc' as const } }, { id: 'asc' as const }]
          : [{ sortOrder: 'asc' as const }, { usageCount: 'desc' as const }, { id: 'asc' as const }];

    const [rows, total] = await Promise.all([
      this.prisma.style.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.style.count({ where }),
    ]);

    const favs = await this.prisma.styleFavorite.findMany({
      where: { userId, styleId: { in: rows.map((r) => r.id) } },
      select: { styleId: true },
    });
    const favSet = new Set(favs.map((f) => f.styleId));

    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id, name: r.name, authorName: r.authorName, isCommercial: r.isCommercial,
        usageCount: r.usageCount, promptText: r.promptText,
        coverUrl: await this.minio.generatePresignedGetUrl(r.coverKey, 3600),
        favorited: favSet.has(r.id),
      })),
    );
    return { items, total, page, pageSize };
  }

  /** 停用/不存在一律 404（钉死语义，spec §4.5——前端映射为「无风格」）。 */
  async getById(userId: string, id: string): Promise<StyleListItem & { coverKey: string }> {
    const style = await this.prisma.style.findFirst({ where: { id, active: true } });
    if (!style) throw new NotFoundException('风格不存在');
    const fav = await this.prisma.styleFavorite.findUnique({
      where: { userId_styleId: { userId, styleId: id } },
      select: { styleId: true },
    });
    return {
      id: style.id, name: style.name, authorName: style.authorName,
      isCommercial: style.isCommercial, usageCount: style.usageCount, promptText: style.promptText,
      coverKey: style.coverKey,
      coverUrl: await this.minio.generatePresignedGetUrl(style.coverKey, 3600),
      favorited: Boolean(fav),
    };
  }

  /** 幂等 toggle：createMany skipDuplicates / deleteMany 双向不抛（spec D26）。 */
  async favorite(userId: string, styleId: string, favorited: boolean): Promise<{ favorited: boolean }> {
    if (favorited) {
      await this.prisma.styleFavorite.createMany({ data: [{ userId, styleId }], skipDuplicates: true });
    } else {
      await this.prisma.styleFavorite.deleteMany({ where: { userId, styleId } });
    }
    return { favorited };
  }

  /** use 三步非事务（D26：PG 事务 aborted 无 savepoint，事务内 catch P2002 必炸）。计数=首次使用人数（D14）。 */
  async use(userId: string, styleId: string) {
    const style = await this.prisma.style.findFirst({ where: { id: styleId, active: true } });
    if (!style) throw new NotFoundException('风格不存在');

    let isFirstUse = false;
    try {
      await this.prisma.styleRecentUsage.create({ data: { userId, styleId } });
      isFirstUse = true;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      await this.prisma.styleRecentUsage.update({
        where: { userId_styleId: { userId, styleId } },
        data: { lastUsedAt: new Date() },
      });
    }
    if (isFirstUse) {
      await this.prisma.style.updateMany({
        where: { id: styleId, active: true },
        data: { usageCount: { increment: 1 } },
      });
    }
    return this.getById(userId, styleId);
  }
}
```

（注：favorites/recent 的排序若用 `_count` 不符合"收藏时间/lastUsedAt 倒序"，执行时以实际可编译语义为准改为 `orderBy: [{ favorites: { _count: 'desc' } }]` 或在 include 后数组排序——**执行者裁定**：目标是稳定倒序 + id tiebreaker，测试断言随之同步。）

- [ ] **Step 9.4: 实现 styles.controller.ts**

```ts
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { StylesService } from './styles.service';

@Controller('api/styles')
export class StylesController {
  constructor(@Inject(StylesService) private readonly service: StylesService) {}

  @Get('categories')
  listCategories() { return this.service.listCategories(); }

  @Get()
  list(@Req() req: any, @Query('tab') tab = 'all', @Query('categoryId') categoryId?: string,
       @Query('search') search?: string, @Query('commercialOnly') commercialOnly?: string,
       @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.service.list(req.user.id, {
      tab, categoryId, search,
      commercialOnly: commercialOnly === 'true',
      page: Number(page), pageSize: Number(pageSize),
    });
  }

  @Get(':id')
  getById(@Req() req: any, @Param('id') id: string) { return this.service.getById(req.user.id, id); }

  @Post(':id/favorite')
  favorite(@Req() req: any, @Param('id') id: string, @Body() dto: { favorited: boolean }) {
    return this.service.favorite(req.user.id, id, dto.favorited);
  }

  @Post(':id/use')
  use(@Req() req: any, @Param('id') id: string) { return this.service.use(req.user.id, id); }
}
```

（登录态由全局 AuthGuard 自动生效——/api/styles 不在 PUBLIC_PREFIXES，勿加；路由顺序 `:id` 在静态段之后无冲突。）

- [ ] **Step 9.5: 跑绿**

Run: `npx vitest run src/modules/styles/styles.service.spec.ts`
Expected: 全 PASS（favorites/recent 排序断言若按 Step 9.3 注裁定调整，同步改测试）。

- [ ] **Step 9.6: Commit**

```bash
git add src/modules/styles/styles.service.ts src/modules/styles/styles.service.spec.ts src/modules/styles/styles.controller.ts
git commit -m "feat(api): styles 用户侧——三 tab 列表(id tiebreaker+favorited 批量+presign coverUrl)/分类/404 钉死/收藏双幂等(use skipDuplicates+deleteMany)/use 非事务三步首次计数（spec §6.1/D14/D23/D26）"
```

---

### Task 10: admin 后端——分类 CRUD（删除保护 400）+ 风格 CRUD + upload-cover + module 注册

**Files:**
- Create: `apps/api/src/modules/styles/admin-style.service.ts`（含分类+风格+上传，一个 service 承载）
- Create: `apps/api/src/modules/styles/admin-style-category.controller.ts`
- Create: `apps/api/src/modules/styles/admin-style.controller.ts`
- Create: `apps/api/src/modules/styles/dto/style-category.dto.ts`、`dto/style.dto.ts`
- Create: `apps/api/src/modules/styles/admin-style.service.spec.ts`
- Create: `apps/api/src/modules/styles/styles.module.ts`
- Modify: `apps/api/src/app.module.ts`（imports 加 StylesModule）

- [ ] **Step 10.1: 写失败测试**

创建 `admin-style.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminStyleService } from './admin-style.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

const mkPrisma = () => ({
  styleCategory: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  style: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
});
const mkMinio = () => ({
  buildKey: vi.fn().mockReturnValue('uploads/system/2026/x.png'),
  upload: vi.fn(),
  generatePresignedGetUrl: vi.fn().mockResolvedValue('/signed.png'),
  delete: vi.fn(),
});

describe('AdminStyleService', () => {
  let service: AdminStyleService;
  let prisma: ReturnType<typeof mkPrisma>;
  let minio: ReturnType<typeof mkMinio>;

  beforeEach(async () => {
    prisma = mkPrisma(); minio = mkMinio();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStyleService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get(AdminStyleService);
  });

  it('createCategory：重名 → 400 中文提示（folder.service 先例）', async () => {
    prisma.styleCategory.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(service.createCategory({ name: '摄影写真' })).rejects.toThrow('分类已存在');
  });

  it('deleteCategory：下有风格（count>0）→ 400 阻止（material-library/services/folder.service.ts:93-94 先例）', async () => {
    prisma.styleCategory.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.style.count.mockResolvedValue(2);
    await expect(service.deleteCategory('c1')).rejects.toThrow(BadRequestException);
    expect(prisma.styleCategory.delete).not.toHaveBeenCalled();
  });

  it('deleteCategory：无风格 → 删除成功', async () => {
    prisma.styleCategory.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.style.count.mockResolvedValue(0);
    prisma.styleCategory.delete.mockResolvedValue({});
    await service.deleteCategory('c1');
    expect(prisma.styleCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('uploadCover：png magic-number 通过 → buildKey('uploaded','system')+upload+返回 key（video-work.service.ts:372-382 先例）', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const out = await service.uploadCover(png, 'image/png');
    expect(out).toEqual({ key: 'uploads/system/2026/x.png' });
    expect(minio.upload).toHaveBeenCalled();
  });

  it('uploadCover：非图片字节 → 400', async () => {
    await expect(service.uploadCover(Buffer.from('not-image'), 'text/plain')).rejects.toThrow('仅支持');
  });

  it('updateStyle：不存在 → 404', async () => {
    prisma.style.findUnique.mockResolvedValue(null);
    await expect(service.updateStyle('sx', {})).rejects.toThrow(NotFoundException);
  });

  it('deleteStyle：连带清封面对象（home-banner remove 先例）', async () => {
    prisma.style.findUnique.mockResolvedValue({ id: 's1', coverKey: 'k1' });
    prisma.style.delete.mockResolvedValue({});
    await service.deleteStyle('s1');
    expect(minio.delete).toHaveBeenCalledWith('k1');
    expect(prisma.style.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('listStyles：分页+分类/搜索过滤', async () => {
    prisma.style.findMany.mockResolvedValue([]);
    prisma.style.count.mockResolvedValue(0);
    await service.listStyles({ categoryId: 'c1', search: 'x', page: 1, pageSize: 20 });
    expect(prisma.style.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ categoryId: 'c1', OR: expect.any(Array) }),
      skip: 0, take: 20,
    }));
  });
});
```

- [ ] **Step 10.2: 跑红**

Run: `npx vitest run src/modules/styles/admin-style.service.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 10.3: 实现 DTO**

`dto/style-category.dto.ts`：

```ts
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateStyleCategoryDto {
  @IsString() @MaxLength(30) name!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateStyleCategoryDto {
  @IsOptional() @IsString() @MaxLength(30) name?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

`dto/style.dto.ts`：

```ts
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateStyleDto {
  @IsString() @MaxLength(60) name!: string;
  @IsString() categoryId!: string;
  @IsString() coverKey!: string;
  @IsOptional() @IsString() @MaxLength(60) authorName?: string;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsString() @MaxLength(2000) promptText!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateStyleDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() coverKey?: string;
  @IsOptional() @IsString() @MaxLength(60) authorName?: string;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) promptText?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class FavoriteDto {
  @Type(() => Boolean) favorited!: boolean;
}
```

- [ ] **Step 10.4: 实现 admin-style.service.ts**

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import type { CreateStyleCategoryDto, UpdateStyleCategoryDto } from './dto/style-category.dto';
import type { CreateStyleDto, UpdateStyleDto } from './dto/style.dto';

@Injectable()
export class AdminStyleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  // ==== 分类 ====
  listCategories() {
    return this.prisma.styleCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createCategory(dto: CreateStyleCategoryDto) {
    const dup = await this.prisma.styleCategory.findUnique({ where: { name: dto.name } });
    if (dup) throw new BadRequestException('分类已存在');
    return this.prisma.styleCategory.create({ data: { name: dto.name, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true } });
  }

  async updateCategory(id: string, dto: UpdateStyleCategoryDto) {
    const existing = await this.prisma.styleCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.styleCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.styleCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    const styleCount = await this.prisma.style.count({ where: { categoryId: id } });
    // 删除保护 400（先例 modules/material-library/services/folder.service.ts:93-94）
    if (styleCount > 0) throw new BadRequestException('该分类下存在风格，请先清空后再删除');
    return this.prisma.styleCategory.delete({ where: { id } });
  }

  // ==== 风格内容 ====
  async listStyles(q: { categoryId?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize) || 20));
    const where: any = {};
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { authorName: { contains: q.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.style.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { category: { select: { name: true } } } }),
      this.prisma.style.count({ where }),
    ]);
    return {
      items: await Promise.all(items.map(async (s) => ({ ...s, coverUrl: await this.minio.generatePresignedGetUrl(s.coverKey, 3600) }))),
      total, page, pageSize,
    };
  }

  async createStyle(dto: CreateStyleDto) {
    return this.prisma.style.create({
      data: {
        name: dto.name, categoryId: dto.categoryId, coverKey: dto.coverKey,
        authorName: dto.authorName ?? null, isCommercial: dto.isCommercial ?? false,
        promptText: dto.promptText, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true,
      },
    });
  }

  async updateStyle(id: string, dto: UpdateStyleDto) {
    const existing = await this.prisma.style.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('风格不存在');
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'categoryId', 'authorName', 'isCommercial', 'promptText', 'sortOrder', 'active'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    const coverChanged = dto.coverKey !== undefined && dto.coverKey !== existing.coverKey;
    if (coverChanged) data.coverKey = dto.coverKey;
    const updated = await this.prisma.style.update({ where: { id }, data });
    if (coverChanged) await this.minio.delete(existing.coverKey).catch(() => {}); // 换图清旧对象，失败不阻断（banner 先例）
    return updated;
  }

  async deleteStyle(id: string) {
    const existing = await this.prisma.style.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('风格不存在');
    await this.minio.delete(existing.coverKey); // 先删对象再删行（banner remove 先例；Cascade 清收藏/最近由 FK 承担）
    return this.prisma.style.delete({ where: { id } });
  }

  // ==== 封面上传（admin-video-work.controller.ts:30-42 + video-work.service.ts:372-382 先例） ====
  async uploadCover(buffer: Buffer, _mimetype: string): Promise<{ key: string }> {
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
    if (!ext) throw new BadRequestException('仅支持 png/jpg/webp');
    const key = this.minio.buildKey('uploaded', 'system', { ext });
    await this.minio.upload(key, buffer, _mimetype);
    return { key };
  }
}
```

- [ ] **Step 10.5: 实现两个 admin controller + module**

`admin-style-category.controller.ts`：

```ts
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UsePipes, ValidationPipe } from '@nestjs/common';
import { AdminStyleService } from './admin-style.service';
import { CreateStyleCategoryDto, UpdateStyleCategoryDto } from './dto/style-category.dto';

@Controller('api/admin/style-categories')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 仓内无全局 pipe（先例 admin-home-banner.controller.ts:12）
export class AdminStyleCategoryController {
  constructor(@Inject(AdminStyleService) private readonly service: AdminStyleService) {}

  @Get() list() { return this.service.listCategories(); }
  @Post() create(@Body() dto: CreateStyleCategoryDto) { return this.service.createCategory(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateStyleCategoryDto) { return this.service.updateCategory(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.deleteCategory(id); }
}
```

`admin-style.controller.ts`（upload-cover 静态段在 `:id` 之前，video-work 红线）：

```ts
import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminStyleService } from './admin-style.service';
import { CreateStyleDto, UpdateStyleDto } from './dto/style.dto';

@Controller('api/admin/styles')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminStyleController {
  constructor(@Inject(AdminStyleService) private readonly service: AdminStyleService) {}

  @Post('upload-cover')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) return cb(new BadRequestException('仅支持 jpg/png/webp'), false);
      cb(null, true);
    },
  }))
  async uploadCover(@UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string }) {
    if (!file) throw new BadRequestException('file is required');
    return this.service.uploadCover(file.buffer, file.mimetype);
  }

  @Get() list(@Query('categoryId') categoryId?: string, @Query('search') search?: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.service.listStyles({ categoryId, search, page: Number(page), pageSize: Number(pageSize) });
  }
  @Post() create(@Body() dto: CreateStyleDto) { return this.service.createStyle(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateStyleDto) { return this.service.updateStyle(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.deleteStyle(id); }
}
```

`styles.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { StylesController } from './styles.controller';
import { StylesService } from './styles.service';
import { AdminStyleCategoryController } from './admin-style-category.controller';
import { AdminStyleController } from './admin-style.controller';
import { AdminStyleService } from './admin-style.service';

@Module({
  controllers: [StylesController, AdminStyleCategoryController, AdminStyleController],
  providers: [StylesService, AdminStyleService],
})
export class StylesModule {}
```

`app.module.ts`：import 区加 `import { StylesModule } from './modules/styles/styles.module';`，imports 数组 `HomeBannerModule,`（:58）后加 `StylesModule,`。

- [ ] **Step 10.6: 跑绿 + api 全量**

Run: `npx vitest run src/modules/styles/ && pnpm test`（cwd=apps/api）
Expected: styles 两份 spec 全 PASS；全量绿。

- [ ] **Step 10.7: Commit**

```bash
git add src/modules/styles/ src/app.module.ts
git commit -m "feat(api): styles admin——分类 CRUD(重名 400+删除保护 400)/风格 CRUD(换图清旧对象)/upload-cover(magic-number+buildKey 先例)+StylesModule 注册（spec §6.2/D17）"
```

---

### Task 11: execution.service——面板 prompt 断链接通 + 风格两处注入 + 视频回退删除

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts`（:75 组装、:110-124 视频分支、:164-174 兜底分支、循环前批量取风格）
- Modify: `apps/api/src/modules/execution/execution.service.spec.ts`（mock 补 style 键 + 新用例）
- Modify: `apps/api/src/modules/execution/execution.service.nodeIds.spec.ts`（mock 同补）

- [ ] **Step 11.1: mock 补键（两份 spec，先铺路——spec §9.2 因果：现有 fixture 无 styleId 短路不发查询不会红，补键为新用例）**

`execution.service.spec.ts` :27-30 与 `execution.service.nodeIds.spec.ts` :26-27 的 prisma 字面量补：

```ts
      style: { findMany: vi.fn().mockResolvedValue([]) },
```

跑既有：`npx vitest run src/modules/execution/execution.service.spec.ts src/modules/execution/execution.service.nodeIds.spec.ts` → 全 PASS（不回归）。

- [ ] **Step 11.2: 写失败测试**

`execution.service.spec.ts` 末尾追加（在顶层 describe 内）：

```ts
  describe('风格拼接与面板 prompt 断链（spec §7.1/§7.2，D12/D28）', () => {
    it('D12：独立图片节点（无上游文本）data.prompt.text 进 prompt', async () => {
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: [], imageUrl: undefined });
      await service.execute({} as any, 'p1', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '面板词' }));
    });

    it('风格拼接：styleId → 批量 findMany 取 active promptText，join(", ") 到 prompt', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: '上游词' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute({} as any, 'p1', 'u1');
      expect(prisma.style.findMany).toHaveBeenCalledWith({ where: { id: { in: ['st1'] } } });
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词, 风格词' }));
    });

    it('inactive/不存在风格 → 忽略不阻塞（B1）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: false, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute({} as any, 'p1', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词' }));
    });

    it('视频分支：finalPrompt 拼风格 + 面板清空 prompt 不传对象（D28 删回退）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词V' }]);
      topology.sort.mockReturnValue([
        { id: 'n3', type: 'videoGen', data: { model: 'vm', styleId: 'st1', prompt: { text: '', html: '' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: [], imageUrl: undefined });
      await service.execute({} as any, 'p1', 'u1');
      const arg = apiCaller.callVideoGen.mock.calls[0][0] as { prompt: unknown };
      expect(arg.prompt).toBe('风格词V');           // 纯风格文本（面板为空）
      expect(typeof arg.prompt).toBe('string');      // 不再序列化 PromptValue 对象
    });
  });
```

（`execute` 的实际签名按既有用例调用方式对齐——执行时抄本文件第一个用例的调用形态。）

- [ ] **Step 11.3: 跑红**

Run: `npx vitest run src/modules/execution/execution.service.spec.ts`
Expected: 新用例 FAIL（prompt 为 ''/对象、无 findMany 调用）。

- [ ] **Step 11.4: 实现**

1. `:75` fallback 链改为（D12）：

```ts
        const prompt = upstream.textContents.join(' ') || data?.prompt?.text || data?.content || '';
```

2. 循环前（`for (const node of orderedNodes)` 之前）批量取风格（B19）：

```ts
    // 风格批量预取（spec §7.1/B19——validation.service.ts:29 同款 in 查询先例）
    const styleIds = [...new Set(orderedNodes.map((n) => (n.data as any)?.styleId).filter(Boolean))];
    const styleRows = styleIds.length
      ? await this.prisma.style.findMany({ where: { id: { in: styleIds as string[] } } })
      : [];
    const styleMap = new Map(styleRows.map((s) => [s.id, s]));
    const styleTextOf = (data: any): string => {
      const s = data?.styleId ? styleMap.get(data.styleId) : undefined;
      return s?.active ? s.promptText : '';
    };
```

3. 视频分支 `:112-113` 改（D28 删回退 + 注入）：

```ts
          const vStyleText = styleTextOf(vData);
          const vFinalPrompt = [prompt, vStyleText].filter(Boolean).join(', ');
          const result = await this.apiCaller.callVideoGen({
            prompt: vFinalPrompt,
```

4. 兜底分支 `:167-168` 改（注入）：

```ts
        const iStyleText = styleTextOf(data);
        const iFinalPrompt = [prompt, iStyleText].filter(Boolean).join(', '); // 分隔符对齐 combinePrompt（api-caller.service.ts:86）
        const result = await this.apiCaller.callImageGen({
          prompt: iFinalPrompt,
```

- [ ] **Step 11.5: 跑绿 + nodeIds spec 回归**

Run: `npx vitest run src/modules/execution/`
Expected: 全 PASS（含 nodeIds spec）。

- [ ] **Step 11.6: Commit**

```bash
git add src/modules/execution/execution.service.ts src/modules/execution/execution.service.spec.ts src/modules/execution/execution.service.nodeIds.spec.ts
git commit -m "feat(api): execution 风格集成——:75 fallback 补 data.prompt.text（面板断链 D12）+风格批量预取 Map 两处注入(join ', ' 对齐 combinePrompt)+视频分支删 PromptValue 对象回退（D28）+两份 spec mock 补 style 键（spec §7）"
```

---

### Task 12: snapshot-filter——白名单三行补 styleId/styleName + field 级断言

**Files:**
- Modify: `apps/api/src/modules/video-work/snapshot-filter.util.ts`（:35-37 三行）
- Modify: `apps/api/src/modules/video-work/snapshot-filter.util.spec.ts`（追加用例）

- [ ] **Step 12.1: 写失败测试**

`snapshot-filter.util.spec.ts` 末尾追加：

```ts
  it('styleId/styleName 进入 imageGen/imageExtGen/videoGen 白名单且快照保留（field 级，spec §7.3——现有断言只做 type 级，漏字段全绿）', () => {
    for (const t of ['imageGen', 'imageExtGen', 'videoGen'] as const) {
      expect(WHITELIST[t]).toContain('styleId');
      expect(WHITELIST[t]).toContain('styleName');
    }
    for (const t of ['imageGen', 'imageExtGen', 'videoGen'] as const) {
      const out = buildFilteredSnapshot(
        { nodes: [rawNode('n1', t, { styleId: 'st1', styleName: '胶片' })], edges: [] },
        base,
      );
      expect(out.nodes[0].data.styleId).toBe('st1');
      expect(out.nodes[0].data.styleName).toBe('胶片');
    }
  });
```

（`rawNode`/`base` 为本文件既有 helper/fixture，直接复用；执行时若命名不同按文件实际改。）

- [ ] **Step 12.2: 跑红**

Run: `npx vitest run src/modules/video-work/snapshot-filter.util.spec.ts`
Expected: 新用例 FAIL（白名单无该字段，data 被剥）。

- [ ] **Step 12.3: 实现**

`snapshot-filter.util.ts` 的 `WHITELIST`（:35-37）三行改为：

```ts
  imageGen: ['prompt', 'style', 'model', 'quality', 'ratio', 'resolution', 'aspectRatio', 'styleId', 'styleName'],
  imageExtGen: ['prompt', 'aspectRatio', 'aiTool', 'styleId', 'styleName'],
  videoGen: ['model', 'ratio', 'prompt', 'trimStart', 'trimEnd', 'label', 'styleId', 'styleName'],
```

（`style` 旧死字段保留在白名单——B10 声明废弃但不迁移、精准修改不动它。）

- [ ] **Step 12.4: 跑绿 + video-work 回归**

Run: `npx vitest run src/modules/video-work/`
Expected: 全 PASS（clone/作品 spec 若有白名单形状断言随之同步）。

- [ ] **Step 12.5: Commit**

```bash
git add src/modules/video-work/snapshot-filter.util.ts src/modules/video-work/snapshot-filter.util.spec.ts
git commit -m "feat(api): 快照/克隆白名单 imageGen/imageExtGen/videoGen 三行补 styleId/styleName+field 级断言（防发布作品/克隆后风格无声消失，spec §7.3/B9）"
```

---

### Task 13: stylesApi——前端接口封装（信封拆包/404→null）

**Files:**
- Create: `apps/web/src/api/stylesApi.ts`
- Create: `apps/web/src/api/stylesApi.test.ts`

（模式：canvas 用户侧裸 fetch + `json.code === 0 ? json.data : ...` 信封拆包——imageNodeApi.ts:35-39 先例；404 映射 null 非错误，spec §4.5。）

- [ ] **Step 13.1: 写失败测试**

创建 `stylesApi.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStyleCategories, fetchStyles, fetchStyleById, favoriteStyle, useStyle } from './stylesApi';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 0, data, message: 'ok' }) });
const nf = { ok: false, status: 404, json: async () => ({ code: -1, data: null, message: '风格不存在' }) };

describe('stylesApi', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('fetchStyles：拼 query 并拆信封', async () => {
    const f = vi.fn().mockResolvedValue(ok({ items: [], total: 0, page: 1, pageSize: 20 }));
    vi.stubGlobal('fetch', f);
    const out = await fetchStyles({ tab: 'favorites', search: 'x', commercialOnly: true, page: 2 });
    expect(f).toHaveBeenCalledWith('/api/styles?tab=favorites&search=x&commercialOnly=true&page=2&pageSize=20');
    expect(out).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('fetchStyleById：404 → null（非错误，spec §4.5）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nf));
    expect(await fetchStyleById('sx')).toBeNull();
  });

  it('favoriteStyle：POST body 显式目标态', async () => {
    const f = vi.fn().mockResolvedValue(ok({ favorited: true }));
    vi.stubGlobal('fetch', f);
    const out = await favoriteStyle('s1', true);
    expect(f).toHaveBeenCalledWith('/api/styles/s1/favorite', expect.objectContaining({ method: 'POST', body: JSON.stringify({ favorited: true }) }));
    expect(out).toEqual({ favorited: true });
  });

  it('useStyle：POST 无 body', async () => {
    const f = vi.fn().mockResolvedValue(ok({ id: 's1' }));
    vi.stubGlobal('fetch', f);
    await useStyle('s1');
    expect(f).toHaveBeenCalledWith('/api/styles/s1/use', expect.objectContaining({ method: 'POST' }));
  });

  it('fetchStyleCategories：GET /api/styles/categories', async () => {
    const f = vi.fn().mockResolvedValue(ok([{ id: 'c1' }]));
    vi.stubGlobal('fetch', f);
    expect(await fetchStyleCategories()).toEqual([{ id: 'c1' }]);
  });
});
```

- [ ] **Step 13.2: 跑红**

Run: `npx vitest run src/api/stylesApi.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 13.3: 实现 stylesApi.ts**

```ts
/** 风格库用户侧接口（spec §6.1）。信封 {code,data,message} 拆包——imageNodeApi 裸 fetch 先例。 */
import type { ImageItem } from '@/stores/nodeStore';

export interface StyleCategoryItem { id: string; name: string; sortOrder: number }

export interface StyleSummary {
  id: string; name: string; coverUrl: string; authorName: string | null;
  isCommercial: boolean; usageCount: number; promptText: string; favorited: boolean;
  coverKey?: string;
}

export interface StyleListResult { items: StyleSummary[]; total: number; page: number; pageSize: number }

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (json.code === 0) return json.data as T;
  throw new Error(json.message || '请求失败');
}

export async function fetchStyleCategories(): Promise<StyleCategoryItem[]> {
  const res = await fetch('/api/styles/categories');
  return unwrap<StyleCategoryItem[]>(res);
}

export interface FetchStylesParams {
  tab: 'all' | 'favorites' | 'recent';
  categoryId?: string;
  search?: string;
  commercialOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function fetchStyles(params: FetchStylesParams): Promise<StyleListResult> {
  const q = new URLSearchParams({
    tab: params.tab,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.categoryId) q.set('categoryId', params.categoryId);
  if (params.search) q.set('search', params.search);
  if (params.commercialOnly) q.set('commercialOnly', 'true');
  const res = await fetch(`/api/styles?${q.toString()}`);
  return unwrap<StyleListResult>(res);
}

/** 停用/不存在 → 404 → null（映射为「无风格」，非错误——spec §4.5）。 */
export async function fetchStyleById(id: string): Promise<StyleSummary | null> {
  const res = await fetch(`/api/styles/${id}`);
  if (res.status === 404) return null;
  return unwrap<StyleSummary>(res);
}

export async function favoriteStyle(id: string, favorited: boolean): Promise<{ favorited: boolean }> {
  const res = await fetch(`/api/styles/${id}/favorite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorited }),
  });
  return unwrap<{ favorited: boolean }>(res);
}

export async function useStyle(id: string): Promise<StyleSummary> {
  const res = await fetch(`/api/styles/${id}/use`, { method: 'POST' });
  return unwrap<StyleSummary>(res);
}

// ImageItem 仅类型引用占位防 tree-shake 误删（无运行时依赖）——如 lint 报未使用则删除本行与 import。
export type { ImageItem };
```

（末行 `export type { ImageItem }` 与 import 若 lint 判冗余直接删 import 与该行——stylesApi 本体不消费 ImageItem。）

- [ ] **Step 13.4: 跑绿**

Run: `npx vitest run src/api/stylesApi.test.ts`
Expected: 全 PASS。

- [ ] **Step 13.5: Commit**

```bash
git add src/api/stylesApi.ts src/api/stylesApi.test.ts
git commit -m "feat(web): stylesApi——三 tab 列表/分类/详情(404→null)/收藏显式目标态/use（裸 fetch 拆 {code,data} 信封，spec §6.1）"
```

---

### Task 14: useStyleLibrary——弹窗数据 hook（tab/分类/搜索/商用/分页/竞态/防抖/收藏/使用）

**Files:**
- Create: `apps/web/src/pages/canvas/components/style-library/useStyleLibrary.ts`
- Create: `apps/web/src/pages/canvas/components/style-library/useStyleLibrary.test.ts`

- [ ] **Step 14.1: 写失败测试**

创建 `useStyleLibrary.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStyleLibrary } from './useStyleLibrary';
import * as api from '@/api/stylesApi';
import { useNodeStore } from '@/stores/nodeStore';

vi.mock('@/api/stylesApi', () => ({
  fetchStyleCategories: vi.fn().mockResolvedValue([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]),
  fetchStyles: vi.fn(),
  favoriteStyle: vi.fn(),
  useStyle: vi.fn(),
}));

const baseItem = (id: string) => ({
  id, name: `风格${id}`, coverUrl: `/c${id}.png`, authorName: '作者',
  isCommercial: true, usageCount: 5, promptText: 'p', favorited: false,
});

describe('useStyleLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: {} } } as any });
  });

  it('初始加载 tab=all 第一页并带分类', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [baseItem('s1')], total: 1, page: 1, pageSize: 20 });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(api.fetchStyles).toHaveBeenCalledWith(expect.objectContaining({ tab: 'all', page: 1, pageSize: 20 }));
    expect(result.current.categories).toHaveLength(1);
  });

  it('loadMore 增页去重合并', async () => {
    (api.fetchStyles as any)
      .mockResolvedValueOnce({ items: [baseItem('s1')], total: 3, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [baseItem('s1'), baseItem('s2')], total: 3, page: 2, pageSize: 20 });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
  });

  it('切 tab 重置 page=1 并丢弃过期响应（竞态守卫，spec §4.2）', async () => {
    let resolve1: (v: unknown) => void = () => {};
    (api.fetchStyles as any)
      .mockImplementationOnce(() => new Promise((r) => { resolve1 = r; }))
      .mockResolvedValueOnce({ items: [baseItem('s9')], total: 1, page: 1, pageSize: 20 });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    act(() => result.current.setTab('favorites'));
    await waitFor(() => expect(result.current.items[0]?.id).toBe('s9'));
    act(() => resolve1({ items: [baseItem('s1')], total: 9, page: 1, pageSize: 20 })); // 过期响应迟到
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.items[0]?.id).toBe('s9'); // 未被过期响应覆盖
  });

  it('useStyle 成功 → updateConfig 写 styleId/styleName 并回调 onUsed；失败不回调（spec §4.4）', async () => {
    const onUsed = vi.fn();
    (api.fetchStyles as any).mockResolvedValue({ items: [baseItem('s1')], total: 1, page: 1, pageSize: 20 });
    (api.useStyle as any).mockResolvedValue(baseItem('s1'));
    const { result } = renderHook(() => useStyleLibrary('img1', { onUsed }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.applyStyle('s1'); });
    expect(useNodeStore.getState().nodes['img1'].data.styleId).toBe('s1');
    expect(useNodeStore.getState().nodes['img1'].data.styleName).toBe('风格s1');
    expect(onUsed).toHaveBeenCalledTimes(1);

    (api.useStyle as any).mockRejectedValue(new Error('boom'));
    await act(async () => { await result.current.applyStyle('s1'); });
    expect(result.current.useError).toBe('风格使用失败，请重试');
    expect(onUsed).toHaveBeenCalledTimes(1); // 失败不关窗不回调
  });

  it('clearStyle → updateConfig 写 null（D16 墓碑契约）', async () => {
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: { styleId: 's1', styleName: 'A' } } } as any });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    act(() => result.current.clearStyle());
    expect(useNodeStore.getState().nodes['img1'].data.styleId).toBeNull();
  });

  it('toggleFavorite 乐观更新本地 items', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [baseItem('s1')], total: 1, page: 1, pageSize: 20 });
    (api.favoriteStyle as any).mockResolvedValue({ favorited: true });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.toggleFavorite('s1'));
    expect(result.current.items[0].favorited).toBe(true);
  });
});
```

- [ ] **Step 14.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/style-library/useStyleLibrary.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 14.3: 实现 useStyleLibrary.ts**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchStyleCategories, fetchStyles, favoriteStyle, useStyle,
  type StyleCategoryItem, type StyleSummary,
} from '@/api/stylesApi';
import { useNodeStore } from '@/stores/nodeStore';

export type StyleTab = 'all' | 'favorites' | 'recent';

export function useStyleLibrary(nodeId: string, opts?: { onUsed?: () => void }) {
  const [tab, setTabState] = useState<StyleTab>('all');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [items, setItems] = useState<StyleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);
  const [categories, setCategories] = useState<StyleCategoryItem[]>([]);
  const reqSeq = useRef(0);

  // 搜索防抖 300ms（spec §4.2）
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { void fetchStyleCategories().then(setCategories).catch(() => {}); }, []);

  const load = useCallback(async (targetPage: number, append: boolean) => {
    const seq = ++reqSeq.current;
    setLoading(true); setError(null);
    try {
      const res = await fetchStyles({ tab, categoryId, search, commercialOnly, page: targetPage, pageSize: 20 });
      if (seq !== reqSeq.current) return; // 过期响应丢弃（竞态守卫）
      setItems((prev) => {
        const next = append ? [...prev, ...res.items] : res.items;
        return next.filter((it, i, arr) => arr.findIndex((x) => x.id === it.id) === i); // id 去重
      });
      setTotal(res.total);
      setPage(targetPage);
    } catch {
      if (seq === reqSeq.current) setError('加载失败，请重试');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [tab, categoryId, search, commercialOnly]);

  // 条件变化 → 重置 page=1（spec §4.2）
  useEffect(() => { void load(1, false); }, [load]);

  const setTab = useCallback((t: StyleTab) => { setTabState(t); setCategoryId(undefined); }, []);
  const loadMore = useCallback(() => { if (!loading && items.length < total) void load(page + 1, true); }, [loading, items.length, total, page, load]);

  const toggleFavorite = useCallback((id: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorited: !it.favorited } : it)));
    const target = items.find((it) => it.id === id);
    void favoriteStyle(id, !target?.favorited).catch(() => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorited: Boolean(target?.favorited) } : it)));
    });
  }, [items]);

  const applyStyle = useCallback(async (id: string) => {
    setUseError(null);
    try {
      const style = await useStyle(id);
      useNodeStore.getState().updateConfig(nodeId, { styleId: style.id, styleName: style.name } as never);
      opts?.onUsed?.();
    } catch {
      setUseError('风格使用失败，请重试'); // 失败不关窗（spec §4.4）
    }
  }, [nodeId, opts]);

  const clearStyle = useCallback(() => {
    useNodeStore.getState().updateConfig(nodeId, { styleId: null, styleName: null } as never); // D16：写 null
  }, [nodeId]);

  const currentStyleId = useNodeStore((s) => (s.nodes[nodeId]?.data as { styleId?: string | null } | undefined)?.styleId ?? null);

  return {
    tab, setTab, categoryId, setCategoryId, searchInput, setSearchInput,
    commercialOnly, setCommercialOnly, categories,
    items, total, page, loading, error, useError,
    loadMore, toggleFavorite, applyStyle, clearStyle, currentStyleId,
  };
}
```

- [ ] **Step 14.4: 跑绿**

Run: `npx vitest run src/pages/canvas/components/style-library/useStyleLibrary.test.ts`
Expected: 全 PASS（`updateConfig` 对 mock nodes 的写入经 mergeNodeData 保留 null 键——若断言失败先确认 mergeNodeData 对 null 值的处理是 `merged[key] = null` 保留）。

- [ ] **Step 14.5: Commit**

```bash
git add src/pages/canvas/components/style-library/useStyleLibrary.ts src/pages/canvas/components/style-library/useStyleLibrary.test.ts
git commit -m "feat(web): useStyleLibrary 数据 hook——三 tab/分类/搜索防抖 300ms/商用筛选/加载更多(去重合并)/竞态序号守卫丢弃过期响应/收藏乐观更新/use 成功写 styleId+styleName 失败不关窗/取消写 null（spec §4.2/§4.4/D16）"
```

---

### Task 15: StyleLibraryModal——弹窗 UI（外壳/卡片网格/详情层）+ 白名单登记

**Files:**
- Create: `apps/web/src/pages/canvas/components/style-library/StyleLibraryModal.tsx`
- Create: `apps/web/src/pages/canvas/components/style-library/StyleCard.tsx`
- Create: `apps/web/src/pages/canvas/components/style-library/StyleDetailPreview.tsx`
- Create: `apps/web/src/pages/canvas/components/style-library/StyleLibraryModal.test.tsx`
- Modify: `apps/web/src/pages/canvas/page.tsx`（:309 挂 `<StyleLibraryModal />` + import）
- Modify: `apps/web/scripts/eslint-rules/no-theme-utility.js`（白名单 2 条）
- Modify: `apps/web/e2e/audit/canvas-migration-registry.json`（whitelistKeeps 镜像 2 条）

要点（spec §4/D7/D13/D20/D21）：BaseFullscreenModal 外壳 + 显式宽 `w-[min(1600px,calc(100vw-64px))]`；点卡=使用+关窗（三 hover 按钮 stopPropagation）；当前使用卡白边+bg-black/50 遮罩+白底黑字徽章；详情层=库内 absolute 居中（挂卡片根非滚动区）+自带 scrim onClick+role="group"；onClose 状态驱动（先关详情后关库）。

- [ ] **Step 15.1: 写失败测试**

创建 `StyleLibraryModal.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StyleLibraryModal } from './StyleLibraryModal';
import { useMenuStore } from '@/stores/menuStore';
import { useNodeStore } from '@/stores/nodeStore';
import * as api from '@/api/stylesApi';

vi.mock('@/api/stylesApi', () => ({
  fetchStyleCategories: vi.fn().mockResolvedValue([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]),
  fetchStyles: vi.fn(),
  favoriteStyle: vi.fn().mockResolvedValue({ favorited: true }),
  useStyle: vi.fn(),
}));

const item = (id: string, over: Partial<api.StyleSummary> = {}) => ({
  id, name: `风格${id}`, coverUrl: `/c${id}.png`, authorName: '作者',
  isCommercial: true, usageCount: 5, promptText: 'promptText 正文', favorited: false, ...over,
});

describe('StyleLibraryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMenuStore.getState().closeStyleLibrary();
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: {} } } as any });
  });

  it('未打开不渲染', () => {
    const { container } = render(<StyleLibraryModal />);
    expect(container.innerHTML).toBe('');
  });

  it('打开渲染三 tab/分类 chips/仅看可商用/卡片信息（名称+商用徽章+作者+N 人使用）', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    expect(await screen.findByText('风格s1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的收藏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最近使用' })).toBeInTheDocument();
    expect(screen.getByText('摄影写真')).toBeInTheDocument();
    expect(screen.getByText('仅看可商用')).toBeInTheDocument();
    expect(screen.getByText('商用')).toBeInTheDocument();
    expect(screen.getByText('5 人使用')).toBeInTheDocument();
  });

  it('点卡片=使用+关窗；点收藏/详情不触发使用（stopPropagation，D13）', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    (api.useStyle as any).mockResolvedValue(item('s1'));
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await screen.findByText('风格s1');
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(api.useStyle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(api.useStyle).not.toHaveBeenCalled();
    expect(screen.getByTestId('style-detail-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('style-card-s1'));
    await waitFor(() => expect(api.useStyle).toHaveBeenCalledWith('s1'));
    expect(useMenuStore.getState().styleLibrary).toBeNull(); // 使用即关窗
  });

  it('当前使用卡：白底徽章+hover 取消使用写 null（D16）', async () => {
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: { styleId: 's1', styleName: '风格s1' } } } as any });
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await screen.findByText('当前使用');
    fireEvent.click(screen.getByTestId('style-card-s1')); // 点当前使用卡主体=无操作
    expect(api.useStyle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消使用' }));
    expect(useNodeStore.getState().nodes['img1'].data.styleId).toBeNull();
  });

  it('详情层：Esc 第一次关详情不关库（D20 状态驱动 onClose）', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await screen.findByText('风格s1');
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByTestId('style-detail-preview')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('style-detail-preview')).not.toBeInTheDocument();
    expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'img1' }); // 库未关
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().styleLibrary).toBeNull(); // 第二次关库
  });

  it('空态与 useError（失败不关窗，spec §4.4）', async () => {
    (api.fetchStyles as any).mockRejectedValue(new Error('x'));
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await waitFor(() => expect(screen.getByText('加载失败，请重试')).toBeInTheDocument());
    expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'img1' });
  });
});
```

- [ ] **Step 15.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/style-library/StyleLibraryModal.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 15.3: 实现 StyleCard.tsx**

```tsx
import { memo } from 'react';
import type { StyleSummary } from '@/api/stylesApi';

interface StyleCardProps {
  item: StyleSummary;
  isCurrent: boolean;
  onUse: (id: string) => void;
  onCancel: () => void;
  onFavorite: (id: string) => void;
  onDetail: (item: StyleSummary) => void;
}

/** 风格卡片（spec §4.3/D13）——点卡=使用（当前使用卡除外）；三个 hover 按钮全部 stopPropagation。 */
export const StyleCard = memo(function StyleCard({ item, isCurrent, onUse, onCancel, onFavorite, onDetail }: StyleCardProps) {
  return (
    <div
      data-testid={`style-card-${item.id}`}
      className="hover:bg-overlay-2 group relative flex w-full cursor-pointer flex-col gap-2 rounded-xl p-1 transition-colors"
      onClick={(e) => { e.stopPropagation(); if (isCurrent) return; onUse(item.id); }}
    >
      <div
        className={`relative flex flex-col items-start justify-between overflow-hidden rounded-lg border ${isCurrent ? 'border-white' : 'border-transparent'}`}
        style={{ aspectRatio: '3 / 4' }}
      >
        <img src={item.coverUrl} alt={item.name} loading="lazy" decoding="async"
          className="absolute inset-0 size-full object-cover" />
        {isCurrent && <div className="absolute inset-0 bg-black/50" aria-hidden="true" />}
        <div aria-hidden="true" className="from-black/20 pointer-events-none absolute inset-x-0 top-0 h-12 bg-linear-to-b to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative flex w-full items-center justify-between p-2">
          {isCurrent ? (
            <button
              type="button"
              aria-label="取消使用"
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="flex size-6 items-center justify-center rounded-lg bg-white text-black"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
            </button>
          ) : (
            <button
              type="button"
              aria-label="使用"
              onClick={(e) => { e.stopPropagation(); onUse(item.id); }}
              className="flex size-6 items-center justify-center rounded-lg bg-black/65 text-white transition-colors group-hover:bg-black/65"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8l4 4L14 4" /></svg>
            </button>
          )}
          <button
            type="button"
            aria-label={item.favorited ? '取消收藏' : '收藏'}
            onClick={(e) => { e.stopPropagation(); onFavorite(item.id); }}
            className={`flex size-6 items-center justify-center rounded-lg transition-colors ${item.favorited ? 'bg-black/65 text-white' : 'bg-black/65 text-white opacity-0 group-hover:opacity-100'}`}
          >
            <svg width="13" height="13" viewBox="0 0 22 21" fill={item.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5"><path d="M11 1.5l2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 8.1l6.3-.9z" /></svg>
          </button>
        </div>
        <div aria-hidden="true" className="from-black/70 pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative flex w-full items-end justify-between p-2">
          {isCurrent && (
            <span className="flex h-6 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[12px] leading-none text-black ring-1 ring-white">
              当前使用
            </span>
          )}
          <button
            type="button"
            aria-label="详情"
            onClick={(e) => { e.stopPropagation(); onDetail(item); }}
            className={`ml-auto flex size-6 items-center justify-center rounded-lg bg-black/65 text-white transition-opacity hover:bg-black/80 ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 9h14M2 13h9M2 5h6" /></svg>
          </button>
        </div>
      </div>
      <div className="flex w-full flex-col gap-1 px-1">
        <div className="flex w-full items-center gap-2">
          <p className="text-text min-w-0 flex-1 truncate text-[14px] font-medium leading-none">{item.name}</p>
          {item.isCommercial && (
            <div className="text-text-dim-2 flex shrink-0 items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="10" /><path d="M6 11.5l3.2 3.2L16 8" /></svg>
              <span className="text-[12px]">商用</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="size-4 shrink-0 rounded-full bg-overlay-3" aria-hidden="true" />
            <span className="text-text-dim-2 min-w-0 flex-1 truncate text-[12px]">{item.authorName ?? '匿名'}</span>
          </div>
          <span className="text-text-dim-2 shrink-0 text-[12px]">{item.usageCount} 人使用</span>
        </div>
      </div>
    </div>
  );
});
```

- [ ] **Step 15.4: 实现 StyleDetailPreview.tsx**

```tsx
import type { StyleSummary } from '@/api/stylesApi';

/** 详情浮层（spec §4.4/D20/B23）——库内 absolute 层挂卡片根（非滚动区），自带 scrim；不用 Modal role。 */
export function StyleDetailPreview({ item, onUse, onClose }: {
  item: StyleSummary; onUse: (id: string) => void; onClose: () => void;
}) {
  return (
    <div
      data-testid="style-detail-scrim"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        data-testid="style-detail-preview"
        role="group"
        aria-label={`风格详情：${item.name}`}
        className="flex w-[860px] max-w-[calc(100%-64px)] gap-4 rounded-2xl p-4"
        style={{ backgroundColor: 'var(--canvas-controls-bg)', border: '1px solid var(--canvas-controls-border)', boxShadow: 'var(--canvas-shadow-dropdown)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={item.coverUrl} alt={item.name} className="h-[420px] w-[315px] shrink-0 rounded-xl object-cover" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-text truncate text-[18px] font-semibold">{item.name}</h3>
            {item.isCommercial && <span className="text-text-dim-2 shrink-0 rounded-md bg-overlay-2 px-1.5 py-0.5 text-[12px]">可商用</span>}
          </div>
          <p className="text-text-dim-2 text-[13px]">作者：{item.authorName ?? '匿名'} · {item.usageCount} 人使用</p>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-overlay-2 p-3">
            <p className="text-text-dim-2 mb-1 text-[12px]">风格提示词</p>
            <p className="text-text whitespace-pre-wrap text-[13px] leading-6">{item.promptText}</p>
          </div>
          <button
            type="button"
            onClick={() => onUse(item.id)}
            className="self-end rounded-lg bg-white px-5 py-2 text-[14px] font-medium text-black transition-opacity hover:opacity-90"
          >
            使用
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 15.5: 实现 StyleLibraryModal.tsx**

```tsx
import { useState } from 'react';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useMenuStore } from '@/stores/menuStore';
import { useStyleLibrary, type StyleTab } from './useStyleLibrary';
import { StyleCard } from './StyleCard';
import { StyleDetailPreview } from './StyleDetailPreview';
import type { StyleSummary } from '@/api/stylesApi';

const TABS: Array<{ key: StyleTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'favorites', label: '我的收藏' },
  { key: 'recent', label: '最近使用' },
];

/** 风格库弹窗（spec §4）——BaseFullscreenModal 外壳 + 显式宽卡片（D21）；onClose 状态驱动（D20）。 */
export function StyleLibraryModal() {
  const styleLibrary = useMenuStore((s) => s.styleLibrary);
  const closeStyleLibrary = useMenuStore((s) => s.closeStyleLibrary);
  const [detail, setDetail] = useState<StyleSummary | null>(null);

  const lib = useStyleLibrary(styleLibrary?.nodeId ?? '', {
    onUsed: () => useMenuStore.getState().closeStyleLibrary(),
  });

  if (!styleLibrary) return null;
  const nodeId = styleLibrary.nodeId;

  return (
    <BaseFullscreenModal
      open
      onClose={() => (detail ? setDetail(null) : closeStyleLibrary())}
      label="风格库"
    >
      <div
        data-testid="style-library-modal"
        className="relative flex w-[min(1600px,calc(100vw-64px))] flex-col overflow-hidden rounded-xl"
        style={{
          height: 'min(calc(100vh - 160px), 1200px)',
          backgroundColor: 'var(--canvas-controls-bg)',
          border: '0.5px solid var(--canvas-controls-border)',
          boxShadow: 'var(--canvas-shadow-dropdown)',
        }}
      >
        {/* 行1：tabs + 搜索 + 关闭 */}
        <div className="flex h-14 shrink-0 items-center gap-4 px-4">
          <div className="flex h-10 items-center gap-1 rounded-xl border border-[var(--canvas-controls-border)] bg-overlay-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => lib.setTab(t.key)}
                className={`flex h-8 min-w-12 items-center justify-center whitespace-nowrap rounded-lg px-4 text-[15px] transition-colors ${
                  lib.tab === t.key ? 'bg-overlay-3 text-text' : 'text-text-dim-2 hover:bg-overlay-3 hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex h-10 w-[336px] items-center gap-1 overflow-hidden rounded-lg border border-transparent bg-overlay-2 py-2 pl-4 pr-2 transition-colors focus-within:border-[var(--fw-accent,var(--canvas-controls-border))]">
            <input
              value={lib.searchInput}
              onChange={(e) => lib.setSearchInput(e.target.value)}
              placeholder="搜索风格名称、作者"
              className="text-text placeholder:text-text-dim-2 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => (detail ? setDetail(null) : closeStyleLibrary())}
            className="text-text hover:bg-overlay-2 ml-auto flex size-10 items-center justify-center rounded-lg"
          >
            <svg width="14" height="14" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l13 13M15 2L2 15" /></svg>
          </button>
        </div>
        <div className="h-px shrink-0" style={{ backgroundColor: 'var(--canvas-controls-border)' }} />
        {/* 行2：分类 chips（收藏/最近隐藏）+ 仅看可商用 */}
        {lib.tab === 'all' && (
          <div className="flex shrink-0 items-center gap-2 px-4 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              <button
                type="button"
                onClick={() => lib.setCategoryId(undefined)}
                className={`flex h-7 min-w-12 shrink-0 items-center justify-center rounded-lg px-3 text-[13px] transition-colors ${
                  !lib.categoryId ? 'bg-overlay-3 text-text' : 'text-text-dim-2 hover:bg-overlay-2 hover:text-text'
                }`}
              >
                全部
              </button>
              {lib.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => lib.setCategoryId(c.id)}
                  className={`flex h-7 min-w-12 shrink-0 items-center justify-center rounded-lg px-3 text-[13px] transition-colors ${
                    lib.categoryId === c.id ? 'bg-overlay-3 text-text' : 'text-text-dim-2 hover:bg-overlay-2 hover:text-text'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <label className="text-text-dim-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={lib.commercialOnly} onChange={(e) => lib.setCommercialOnly(e.target.checked)} className="accent-white" />
              仅看可商用
            </label>
          </div>
        )}
        {lib.useError && <div className="text-text px-4 pt-2 text-[13px]" role="alert">{lib.useError}</div>}
        {/* 主体：5 列网格 + 加载更多 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {lib.error && <div className="text-text-dim-2 py-16 text-center text-[14px]">{lib.error}</div>}
          {!lib.error && lib.items.length === 0 && !lib.loading && (
            <div className="text-text-dim-2 py-16 text-center text-[14px]">
              {lib.tab === 'favorites' ? '暂无收藏的风格' : lib.tab === 'recent' ? '暂无使用记录' : '未找到匹配风格'}
            </div>
          )}
          <div className="grid grid-cols-5 gap-x-3 gap-y-2">
            {lib.items.map((it) => (
              <StyleCard
                key={it.id}
                item={it}
                isCurrent={it.id === lib.currentStyleId}
                onUse={lib.applyStyle}
                onCancel={lib.clearStyle}
                onFavorite={lib.toggleFavorite}
                onDetail={setDetail}
              />
            ))}
          </div>
          {lib.items.length < lib.total && (
            <button
              type="button"
              onClick={lib.loadMore}
              disabled={lib.loading}
              className="text-text-dim-2 hover:text-text mx-auto mt-2 block rounded-lg px-6 py-2 text-[13px] disabled:opacity-50"
            >
              {lib.loading ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
        {detail && (
          <StyleDetailPreview item={detail} onUse={lib.applyStyle} onClose={() => setDetail(null)} />
        )}
      </div>
    </BaseFullscreenModal>
  );
}
```

- [ ] **Step 15.6: page.tsx 挂载**

`page.tsx` import 区（AddNodeMenu import 旁）加 `import { StyleLibraryModal } from './components/style-library/StyleLibraryModal';`；`:309 <HandleAddNodeMenu />` 之后加一行 `<StyleLibraryModal />`。

- [ ] **Step 15.7: 跑绿 + 回归**

Run: `npx vitest run src/pages/canvas/components/style-library/ src/pages/canvas/page.test.tsx`
Expected: 全 PASS（page.test 若因新组件报错，按其既有 mock 模式加 `vi.mock('./components/style-library/StyleLibraryModal', () => ({ StyleLibraryModal: () => null }))`）。

- [ ] **Step 15.8: 白名单 2 条 + registry 镜像（spec §4.6 定稿）**

1. `no-theme-utility.js` 白名单（VideoCard 条目 :79 附近之后）加：

```js
  { glob: 'src/pages/canvas/components/style-library/StyleLibraryModal.tsx', allow: ['bg', 'text', 'border', 'from'] },   // 反白 CTA/恒定面族（#9/#6 先例 TopActionBar/CanvasTopBar）：当前使用白边框+bg-black/50 遮罩+白底黑字徽章/封面渐变
  { glob: 'src/pages/canvas/components/style-library/StyleDetailPreview.tsx', allow: ['bg'] },                            // scrim bg-black/60 中性遮罩（BaseFullscreenModal:92 同族）
```

（`allow` 族以实现 grep 为准增删——StyleCard.tsx 若也有命中（bg-black/65 按钮底/渐变）则同样登记：`{ glob: '.../StyleCard.tsx', allow: ['bg', 'from'] }`。）

2. `canvas-migration-registry.json` whitelistKeeps 数组尾镜像对应条目（结构 `{glob, allow[], why}`，参照 :2416 VideoCard 条目）：

```json
  {
   "glob": "src/pages/canvas/components/style-library/StyleLibraryModal.tsx",
   "allow": ["bg", "text", "border", "from"],
   "why": "2026-09-26 风格库：反白 CTA/恒定面族（当前使用白边框+白底黑字徽章+bg-black/50 压封面遮罩+封面渐变）——先例 TopActionBar 反白 CTA"
  },
  {
   "glob": "src/pages/canvas/components/style-library/StyleDetailPreview.tsx",
   "allow": ["bg"],
   "why": "2026-09-26 风格库详情 scrim bg-black/60 中性遮罩（BaseFullscreenModal:92 同族恒定黑罩）"
  }
```

（StyleCard 如登记则镜像第三条。）

3. 验证：`pnpm lint`（cwd=apps/web）PASS——新文件 white/black 族命中全在 allow 列表。

- [ ] **Step 15.9: Commit**

```bash
git add src/pages/canvas/components/style-library/ src/pages/canvas/page.tsx scripts/eslint-rules/no-theme-utility.js e2e/audit/canvas-migration-registry.json
git commit -m "feat(web): 风格库弹窗——BaseFullscreenModal 外壳+显式宽卡片(D21)/三 tab/分类 chips/搜索防抖/仅看可商用/5 列网格+加载更多/点卡=使用+关窗(D13)/取消使用 hover 按钮/详情层库内 scrim+role=group(D20/B23)/useError 失败不关窗；白名单 2 条+registry 镜像（spec §4）"
```

---

### Task 16: 工具行风格按钮选中态——类型双接口 + 封面圆图模块级缓存

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`（`ImageNodeData` :101-127 与 `VideoNodeData` :129-143 各加 2 字段）
- Create: `apps/web/src/pages/canvas/components/style-library/styleThumbCache.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx`（风格按钮选中态渲染）

- [ ] **Step 16.1: 写失败测试**

创建 `styleThumbCache.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStyleThumb } from './styleThumbCache';
import * as api from '@/api/stylesApi';
import * as mediaApi from '@/api/mediaApi';

vi.mock('@/api/stylesApi', () => ({ fetchStyleById: vi.fn() }));
vi.mock('@/api/mediaApi', () => ({ getMediaUrl: vi.fn() }));

describe('styleThumbCache（模块级缓存 {styleName,coverKey}，不缓存 presign URL——spec §4.5）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStyleThumb.cache.clear();
  });

  it('404/不存在 → null；结果缓存（第二次不发请求）', async () => {
    (api.fetchStyleById as any).mockResolvedValue(null);
    expect(await getStyleThumb('gone')).toBeNull();
    await getStyleThumb('gone');
    expect(api.fetchStyleById).toHaveBeenCalledTimes(1);
  });

  it('命中 → presign coverKey 为 URL；同 id 复用（getMediaUrl 每次按需调用）', async () => {
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片', coverKey: 'k1', coverUrl: '/expired.png' } as any);
    (mediaApi.getMediaUrl as any).mockResolvedValue({ url: '/fresh.png' });
    const a = await getStyleThumb('s1');
    const b = await getStyleThumb('s1');
    expect(a).toEqual({ styleName: '胶片', url: '/fresh.png' });
    expect(b).toEqual(a);
    expect(api.fetchStyleById).toHaveBeenCalledTimes(1);
    expect(mediaApi.getMediaUrl).toHaveBeenCalledTimes(2); // presign 不缓存
  });
});
```

（`getStyleThumb.cache` 为模块导出的 Map 供测试重置——实现里 `export const _cache` 或挂函数属性，执行时按 lint 调整命名。）

- [ ] **Step 16.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/style-library/styleThumbCache.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 16.3: 实现**

1. `nodeStore.ts` 类型（spec §7.1——读取侧需要，双接口都加）：

`ImageNodeData` 的 `style?: string;`（:117）之后加：

```ts
  styleId?: string | null;   // 风格库选中（null=已取消，D16 契约：键存在值 null）
  styleName?: string | null;
```

`VideoNodeData` 的 `prompt?: PromptValue;`（:137）之后加同样两行。

2. `styleThumbCache.ts`：

```ts
import { fetchStyleById } from '@/api/stylesApi';
import { getMediaUrl } from '@/api/mediaApi';

interface ThumbEntry { styleName: string; coverKey: string }

/** 模块级去重缓存——只存 {styleName, coverKey}，presign URL 按需现取（3600s TTL 不缓存，spec §4.5）。 */
const cache = new Map<string, ThumbEntry | null>();

export async function getStyleThumb(styleId: string): Promise<{ styleName: string; url: string } | null> {
  if (!cache.has(styleId)) {
    const style = await fetchStyleById(styleId); // 404 → null（缓存 null 防反复打 404）
    cache.set(styleId, style ? { styleName: style.name, coverKey: (style as { coverKey?: string }).coverKey ?? '' } : null);
  }
  const entry = cache.get(styleId) ?? null;
  if (!entry || !entry.coverKey) return entry ? { styleName: entry.styleName, url: '' } : null;
  const { url } = await getMediaUrl(entry.coverKey);
  return { styleName: entry.styleName, url };
}

// 测试重置口（命名带下划线避免与业务混淆；vitest 直接访问）
getStyleThumb.cache = cache;

declare module './styleThumbCache' {}
```

（`declare module` 行如无必要删除；`getStyleThumb.cache = cache` 需要函数属性类型声明 `getStyleThumb.cache = cache as never` 或接口扩展——执行时按 tsc 提示调整。）

3. `ImageThumbnailBar.tsx` 风格按钮选中态（组件体加订阅与加载）：

```tsx
import { useEffect, useState } from 'react';
import { getStyleThumb } from '../../style-library/styleThumbCache';
// ...
  const styleId = useNodeStore((s) => (s.nodes[nodeId]?.data as { styleId?: string | null } | undefined)?.styleId ?? null);
  const [thumb, setThumb] = useState<{ styleName: string; url: string } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!styleId) { setThumb(null); return; }
    void getStyleThumb(styleId).then((t) => { if (alive) setThumb(t); }).catch(() => { if (alive) setThumb(null); });
    return () => { alive = false; };
  }, [styleId]);
```

按钮 JSX（Task 5 后的形态）改为条件渲染：`thumb` 存在时上部为 `<img src={thumb.url} className="size-5 rounded-full object-cover" alt="" />`、下部 `<span className="... max-w-full truncate">{thumb.styleName}</span>`；否则维持调色盘图标+「风格」。按钮尺寸类不变（h-[56px] w-[56px]），名称 truncate 单行省略。

- [ ] **Step 16.4: 跑绿 + 回归**

Run: `npx vitest run src/pages/canvas/components/style-library/styleThumbCache.test.ts src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`
Expected: 全 PASS（ImageThumbnailBar 既有用例 #9/#11/#13/#15/#16 断言「风格」按钮——默认无 styleId 路径不变）。

- [ ] **Step 16.5: Commit**

```bash
git add src/stores/nodeStore.ts src/pages/canvas/components/style-library/styleThumbCache.ts src/pages/canvas/components/style-library/styleThumbCache.test.ts src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx
git commit -m "feat(web): 工具行风格按钮选中态——styleId/styleName 类型进 Image+Video 双接口（读取侧需要）+模块级 {styleName,coverKey} 缓存 presign 按需现取+选中显示封面圆图与风格名（spec §4.5/§7.1）"
```

---

### Task 17: admin 前端——菜单/路由/两页面/api + 三份测试改造

**Files:**
- Modify: `apps/web/src/api/adminApi.ts`（追加 adminStylesApi + uploadStyleCover）
- Modify: `apps/web/src/pages/admin/AdminLayout.tsx`（menuRoute 加组）
- Modify: `apps/web/src/router.tsx`（lazy import + 两子路由，相对路径）
- Create: `apps/web/src/pages/admin/pages/StyleCategoriesPage.tsx`
- Create: `apps/web/src/pages/admin/pages/StyleContentPage.tsx`
- Modify: `apps/web/src/router.admin.test.tsx`（白名单+集合+2 mock+标题）
- Modify: `apps/web/src/pages/admin/AdminLayout.test.tsx`（循环数组补「风格库」+标题）

- [ ] **Step 17.1: adminApi 扩展**

`adminApi.ts` 末尾追加（apiFetch 路径不带 /api——:194 注释先例；multipart 裸 fetch 带 /api——:134-144 先例）：

```ts
// ========== 风格库管理（spec §6.2/D27；admin 路径不带 /api 先例 :194） ==========

export interface AdminStyleCategory { id: string; name: string; sortOrder: number; active: boolean; createdAt: string }
export interface AdminStyle {
  id: string; name: string; categoryId: string; coverKey: string; coverUrl?: string;
  authorName: string | null; isCommercial: boolean; promptText: string;
  sortOrder: number; active: boolean; usageCount: number;
  category?: { name: string };
}

export const adminStylesApi = {
  listCategories: (): Promise<AdminStyleCategory[]> => apiFetch('/admin/style-categories'),
  createCategory: (data: { name: string; sortOrder?: number; active?: boolean }) =>
    apiFetch('/admin/style-categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id: string, data: Partial<{ name: string; sortOrder: number; active: boolean }>) =>
    apiFetch(`/admin/style-categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCategory: (id: string) => apiFetch(`/admin/style-categories/${id}`, { method: 'DELETE' }),
  listStyles: (q: { categoryId?: string; search?: string; page?: number; pageSize?: number }) => {
    const p = new URLSearchParams({ page: String(q.page ?? 1), pageSize: String(q.pageSize ?? 20) });
    if (q.categoryId) p.set('categoryId', q.categoryId);
    if (q.search) p.set('search', q.search);
    return apiFetch(`/admin/styles?${p.toString()}`);
  },
  createStyle: (data: Record<string, unknown>) =>
    apiFetch('/admin/styles', { method: 'POST', body: JSON.stringify(data) }),
  updateStyle: (id: string, data: Record<string, unknown>) =>
    apiFetch(`/admin/styles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStyle: (id: string) => apiFetch(`/admin/styles/${id}`, { method: 'DELETE' }),
};

/** multipart 直传（apiFetch JSON Content-Type 冲掉 boundary——:134 先例） */
export async function uploadStyleCover(file: File): Promise<{ key: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/admin/styles/upload-cover', { method: 'POST', body: formData, credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || '上传失败');
  }
  const body = await res.json();
  return body.data ?? body;
}
```

- [ ] **Step 17.2: AdminLayout 菜单 + router**

1. `AdminLayout.tsx` menuRoute（:32 `settings` 行之前）加组（**组 path 不等于子页 path——D27**）：

```tsx
    {
      path: '/admin/styles', name: '风格库', icon: <PictureOutlined />,
      routes: [
        { path: '/admin/styles/categories', name: '风格分类' },
        { path: '/admin/styles/content', name: '风格内容' },
      ],
    },
```

（icon import 补 `PictureOutlined`。）

2. `router.tsx`：lazy import 区（:20 附近）加：

```tsx
const StyleCategoriesPage = lazy(() => import('@/pages/admin/pages/StyleCategoriesPage'));
const StyleContentPage = lazy(() => import('@/pages/admin/pages/StyleContentPage'));
```

admin children（:85 `content/video-works` 之后）加（相对路径对齐仓内）：

```tsx
              { path: 'styles/categories', element: <StyleCategoriesPage /> },
              { path: 'styles/content', element: <StyleContentPage /> },
```

- [ ] **Step 17.3: 两份路由/布局测试改造（先红）**

1. `router.admin.test.tsx`：
   - mock 区（:5-13）加两条：

```tsx
vi.mock('@/pages/admin/pages/StyleCategoriesPage', () => ({ default: () => <div>StyleCategoriesPage</div> }));
vi.mock('@/pages/admin/pages/StyleContentPage', () => ({ default: () => <div>StyleContentPage</div> }));
```

   - 过滤条件（:29）补 `|| r.path.startsWith('styles/')`；期望集合（:32-35）补 `'styles/categories', 'styles/content'`（sort 后位置按字母序插入）；标题（:24）「8 叶子路径」→「10 叶子路径」。

2. `AdminLayout.test.tsx`：:19 循环数组补 `'风格库'`；:12 标题「4 组」→「5 组」。

Run: `npx vitest run src/router.admin.test.tsx src/pages/admin/AdminLayout.test.tsx`
Expected: router.admin 红（styles 叶子未注册）→ 实现页面后转绿；AdminLayout 新断言红（菜单未加——若 Step 17.2 已做则直接绿，顺序无碍）。

- [ ] **Step 17.4: 实现 StyleCategoriesPage.tsx**

```tsx
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Popconfirm, Button, Tag } from 'antd';
import { adminStylesApi, type AdminStyleCategory } from '@/api/adminApi';

export default function StyleCategoriesPage() {
  const actionRef = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AdminStyleCategory>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: '操作', valueType: 'option',
      render: (_, record) => [
        <CategoryFormModal key="edit" record={record} onDone={() => actionRef.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title="确认删除该分类？" onConfirm={async () => {
          try { await adminStylesApi.deleteCategory(record.id); message.success('已删除'); actionRef.current?.reload(); }
          catch (e) { message.error((e as Error).message); } // 删除保护 400 中文文案直达（spec §6.2）
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="风格分类">
      <ProTable<AdminStyleCategory>
        headerTitle="分类列表" rowKey="id" search={false} size="small"
        actionRef={actionRef}
        request={async () => {
          const data = await adminStylesApi.listCategories();
          return { data, success: true, total: data.length };
        }}
        columns={columns}
        toolBarRender={() => [
          <CategoryFormModal key="create" onDone={() => actionRef.current?.reload()} trigger={<Button type="primary">新建分类</Button>} />,
        ]}
      />
    </PageContainer>
  );
}

function CategoryFormModal({ record, onDone, trigger }: { record?: AdminStyleCategory; onDone: () => void; trigger: ReactElement }) {
  const { message } = AntdApp.useApp();
  const isEdit = Boolean(record);
  return (
    <ModalForm
      title={isEdit ? '编辑分类' : '新建分类'} trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={record ? { name: record.name, sortOrder: record.sortOrder, active: record.active } : { sortOrder: 0, active: true }}
      onFinish={async (v: any) => {
        try {
          if (isEdit && record) await adminStylesApi.updateCategory(record.id, v);
          else await adminStylesApi.createCategory(v);
          message.success(isEdit ? '已更新' : '已创建');
          onDone();
          return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      <ProFormText name="name" label="名称" rules={[{ required: true }, { max: 30 }]} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} fieldProps={{ precision: 0 }} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}
```

- [ ] **Step 17.5: 实现 StyleContentPage.tsx**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch, ProFormSelect, ProFormTextArea } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Input, Popconfirm, Select, Tag } from 'antd';
import { adminStylesApi, uploadStyleCover, type AdminStyle, type AdminStyleCategory } from '@/api/adminApi';

export default function StyleContentPage() {
  const actionRef = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();
  const [categories, setCategories] = useState<AdminStyleCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [committed, setCommitted] = useState({ categoryId: undefined as string | undefined, search: '' });

  useEffect(() => { void adminStylesApi.listCategories().then(setCategories).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => setCommitted({ categoryId, search: searchText.trim() }), 300); // 防抖
    return () => clearTimeout(t);
  }, [categoryId, searchText]);
  useEffect(() => { actionRef.current?.reload(); }, [committed]);

  const columns: ProColumns<AdminStyle>[] = [
    { title: '封面', width: 80, render: (_, r) => <img src={r.coverUrl} alt={r.name} className="h-12 w-9 rounded object-cover" /> },
    { title: '名称', dataIndex: 'name' },
    { title: '分类', render: (_, r) => r.category?.name ?? '-' },
    { title: '作者', dataIndex: 'authorName', render: (_, r) => r.authorName ?? '-' },
    { title: '可商用', dataIndex: 'isCommercial', render: (_, r) => (r.isCommercial ? <Tag color="green">商用</Tag> : '-') },
    { title: '提示词', dataIndex: 'promptText', ellipsis: true },
    { title: '使用量', dataIndex: 'usageCount', width: 80 },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: '操作', valueType: 'option',
      render: (_, record) => [
        <StyleFormModal key="edit" categories={categories} record={record} onDone={() => actionRef.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title="确认删除该风格？（收藏/最近使用记录将一并清除）" onConfirm={async () => {
          try { await adminStylesApi.deleteStyle(record.id); message.success('已删除'); actionRef.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="风格内容">
      {/* 页顶自定义筛选（D27——不启用 ProTable search 表单，仓内零先例） */}
      <div className="mb-4 flex items-center gap-3">
        <Select
          allowClear placeholder="全部分类" style={{ width: 180 }}
          value={categoryId} onChange={(v) => setCategoryId(v)}
          options={categories.map((c) => ({ label: c.name, value: c.id }))}
        />
        <Input.Search
          placeholder="搜索名称/作者" style={{ width: 260 }}
          value={searchText} onChange={(e) => setSearchText(e.target.value)}
          onSearch={(v) => setCommitted({ categoryId, search: v.trim() })}
        />
      </div>
      <ProTable<AdminStyle>
        headerTitle="风格列表" rowKey="id" search={false} size="small"
        actionRef={actionRef}
        request={async (params) => {
          const res = await adminStylesApi.listStyles({ ...committed, page: params.current ?? 1, pageSize: params.pageSize ?? 20 });
          return { data: res.items, success: true, total: res.total };
        }}
        columns={columns}
        toolBarRender={() => [
          <StyleFormModal key="create" categories={categories} onDone={() => actionRef.current?.reload()} trigger={<Button type="primary">新建风格</Button>} />,
        ]}
      />
    </PageContainer>
  );
}

function StyleFormModal({ categories, record, onDone, trigger }: {
  categories: AdminStyleCategory[]; record?: AdminStyle; onDone: () => void; trigger: ReactElement;
}) {
  const { message } = AntdApp.useApp();
  const isEdit = Boolean(record);
  const [coverKey, setCoverKey] = useState<string | undefined>(record?.coverKey);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { key } = await uploadStyleCover(file);
      setCoverKey(key);
      message.success('封面上传成功，保存后生效');
    } catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  return (
    <ModalForm
      title={isEdit ? '编辑风格' : '新建风格'} trigger={trigger}
      modalProps={{ destroyOnClose: true, afterClose: () => setCoverKey(record?.coverKey) }}
      initialValues={record ? {
        name: record.name, categoryId: record.categoryId, authorName: record.authorName ?? undefined,
        isCommercial: record.isCommercial, promptText: record.promptText,
        sortOrder: record.sortOrder, active: record.active,
      } : { sortOrder: 0, active: true, isCommercial: false }}
      onFinish={async (v: any) => {
        if (!coverKey) { message.error('请先上传封面图'); return false; }
        try {
          const payload = { ...v, authorName: v.authorName || null, coverKey };
          if (isEdit && record) await adminStylesApi.updateStyle(record.id, payload);
          else await adminStylesApi.createStyle(payload);
          message.success(isEdit ? '已更新' : '已创建');
          onDone();
          return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      {/* inline style 隐藏原生控件（antd :where() 特异性压 Tailwind .hidden——HomeBannersPage:96-97 注释先例） */}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }} />
      <div className="mb-4">
        <div className="mb-1 text-sm">封面（3:4 建议，≤5MB，jpg/png/webp）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        <span className="ml-2 text-xs text-gray-400">{coverKey ? '已上传' : '未上传'}</span>
      </div>
      <ProFormText name="name" label="名称" rules={[{ required: true }, { max: 60 }]} />
      <ProFormSelect name="categoryId" label="分类" rules={[{ required: true }]}
        options={categories.filter((c) => c.active).map((c) => ({ label: c.name, value: c.id }))} />
      <ProFormText name="authorName" label="作者名（可选）" placeholder="留空显示「匿名」" />
      <ProFormSwitch name="isCommercial" label="可商用" initialValue={false} />
      <ProFormTextArea name="promptText" label="风格提示词（拼入生成 prompt）" rules={[{ required: true }, { max: 2000 }]} fieldProps={{ rows: 4 }} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} fieldProps={{ precision: 0 }} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}
```

- [ ] **Step 17.6: 跑绿 + 回归**

Run: `npx vitest run src/router.admin.test.tsx src/pages/admin/AdminLayout.test.tsx && npx tsc -b --pretty false | head -20`
Expected: 两份测试全 PASS；tsc 无新增报错。

- [ ] **Step 17.7: Commit**

```bash
git add src/api/adminApi.ts src/pages/admin/AdminLayout.tsx src/router.tsx src/pages/admin/pages/StyleCategoriesPage.tsx src/pages/admin/pages/StyleContentPage.tsx src/router.admin.test.tsx src/pages/admin/AdminLayout.test.tsx
git commit -m "feat(web): admin 风格库——菜单组(styles 组 path≠子页)/相对路由 categories+content(D27)/分类页(删除保护 400 文案直达)/内容页(封面上传 inline input+页顶自定义筛选 D27+promptText 必填)/adminStylesApi+uploadStyleCover；router.admin 白名单+集合+2 mock+标题同步（spec §8）"
```

---

### Task 18: 收尾门禁 + 浏览器人工验收

**Files:** 无新改动（门禁与验收；发现问题回对应 Task 修复后重跑）

- [ ] **Step 18.1: 全量单测**

Run: `pnpm test`
Expected: web+api 全绿。

- [ ] **Step 18.2: lint（no-color-hex 增量 + no-theme-utility）**

Run: `pnpm lint`
Expected: PASS / 0 new（新文件 white/black 族命中均在 Task 15 白名单 allow 列表）。

- [ ] **Step 18.3: 斜杠门禁**

Run: `node scripts/css-audit.mjs --slash-gate`（cwd=apps/web）
Expected: exit 0（未写任何 `*-var-token/NN` 斜杠透明度）。

- [ ] **Step 18.4: 构建**

Run: `pnpm --filter @flowweb/web build && pnpm --filter @flowweb/api build`
Expected: 均成功（含 tsc）。

- [ ] **Step 18.5: 浏览器人工验收（spec §11 全 12 条）**

启动 dev server（按项目启动流程 memory），逐条过 spec §11 验收清单。重点（jsdom 覆盖不到的手势/视觉项）：
1. 角标一半悬外不被工具行/缩略图裁切（B22 spike 结论复核）；hover 大图预览与角标不打架；
2. 模式期点击目标节点后发起节点面板与序号仍可见（D25——「点一下就消失」=失败）；Tab 不弹 AddNodeMenu；
3. 「返回节点」滚动+选中；拖动节点不触发加入；拖拽/粘贴上传仍可用；
4. 风格库卡片宽度不塌宽（D21）、Esc 两段式（先详情后库，D20）、点收藏/详情不误触使用；
5. 使用风格后工具行圆图+风格名（刷新后仍在）；生成日志验证 prompt 含面板文本+风格文本（D12 接通）与视频不传对象（D28）；
6. admin 录入→前台即时可见；删除有收藏的风格成功（Cascade）；分类删除保护文案。

- [ ] **Step 18.6: 验收问题修复后终跑 + 最终 Commit（如有修复）**

```bash
pnpm test && pnpm lint && node apps/web/scripts/css-audit.mjs --slash-gate
```

---

## 执行中停机回报条件（遇此三类情况停下报告用户，勿自行改设计）

1. `prisma migrate dev` 因权限/基线报错（migrate 基线已重置过——按 flowweb_db_migration_env 记忆处理，勿 db push）；
2. favorites/recent 排序的 Prisma 语法（`_count` / 关联字段排序）与 Task 9 断言在真实 Prisma 类型下不可编译——按 Step 9.3 注裁定调整为语义等价实现并同步测试，改动超出「稳定倒序+id tiebreaker」语义时停机；
3. styleThumbCache 的函数属性（`getStyleThumb.cache`）在 strict 下需结构调整——允许改为模块导出 `export const styleThumbCacheMap` 同步测试，语义不变。

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：§3.1→T2/T5/T7；§3.2→T6；§3.3→T1/T7；§3.4→T4/T5；§4.1→T3/T5/T15；§4.2→T14/T15；§4.3→T15(StyleCard)；§4.4→T14/T15；§4.5→T16；§4.6→T15(白名单+镜像)；§5→T8；§6.1→T9/T13；§6.2→T10/T17；§7.1/§7.2→T11；§7.3→T12；§8→T17；§9.1 命令→T18；§9.2 既有改造→T3/T4/T5/T11/T17 分任务内联；§9.3 新增→各任务；§11→T18。无遗漏。
2. **占位符**：全部步骤含完整代码或精确既有代码保留指示（「原样保留」段为既有代码非新代码占位）；Step 9.3 的排序裁定注给出了确定的可执行替代语义（稳定倒序+id tiebreaker），非 TBD。
3. **类型一致性**：`referenceSelect: { sourceNodeId; notice }`（T2 定义，T5/T6/T7 消费一致）；`styleLibrary: { nodeId }`（T3 定义，T5/T15 一致）；`StyleSummary/StyleListResult/StyleCategoryItem`（T13 定义，T14/T15/T16 一致）；`decideReferencePick` 三分支（T1 定义，T7 消费一致）；后端 `StyleListItem`（T9）与前端 `StyleSummary` 字段同名同型（coverUrl/authorName/isCommercial/usageCount/promptText/favorited）；`getStyleThumb`（T16 测试与实现签名一致）。
4. **执行顺序**：T1→T2→T3（A 组 store 链）→T4→T5（组件，依赖 T3 menuStore）→T6→T7（接线，依赖全部）；B 组 T8→T9→T10（后端链）→T11/T12（独立）→T13→T14→T15（依赖 T3/T13/T14）→T16（依赖 T13/T15）→T17（依赖 T10）→T18 收尾。A/B 两组间仅 T15 依赖 T3（menuStore），无其他交叉。

