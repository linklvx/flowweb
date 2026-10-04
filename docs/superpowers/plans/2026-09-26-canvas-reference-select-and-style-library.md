<!-- doc-status: historical | verified_at: n/a -->
# Canvas 参考选择模式与风格库 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 spec `docs/superpowers/specs/2026-09-26-canvas-reference-select-and-style-library-design.md`（v4）——功能块 A 画布参考选择模式（横幅/点选/序号 X 角标）+ 功能块 B 风格库全链路（4 新表/用户与 admin API/弹窗/admin 两页/生成集成/快照白名单）。

**Architecture:** A 组纯前端（纯函数→store→组件→接线递进）；B 组后端先行（Prisma→用户侧 service→admin→execution/snapshot）再前端（api→hook→弹窗→选中态→admin 页）。互斥收口：menuStore 三切片互斥 + menuStore→nodeStore 单向跨 store 调用（nodeStore→menuStore 方向由组件层 onClick 收口，避免 ESM 循环 import）。取消使用写 `null`（D16）；D14 非事务三步（D26）。

**Tech Stack:** React 18 + @xyflow/react 12.10.2 + zustand + Tailwind（语义 token）+ NestJS + Prisma/PostgreSQL + MinIO + vitest（web: @testing-library/react；api: @nestjs/testing）。

**工作目录：** web 侧命令在 `D:\flowweb\apps\web`，api 侧在 `D:\flowweb\apps\api`。测试命令：web `npx vitest run <file>`；api `npx vitest run <file>`（apps/api test script = tsc+vitest，单文件跑用 npx vitest run）。

**已知门禁（收尾 Task 18 全跑）：** `pnpm test`（turbo 全量）；`pnpm lint`（web lint-gate：no-color-hex 增量 + no-theme-utility 无 baseline）；`node scripts/css-audit.mjs --slash-gate`（**一律 cwd=apps/web**）；`pnpm --filter @flowweb/web build`。**硬约束**：斜杠透明度对 var() token 零输出（禁 `bg-overlay-2/50` 类写法）；white/black 工具类仅白名单文件可用；无裸 `text-text-dim`（只有 dim-1/2/3）；渐变用 `bg-gradient-to-*`（Tailwind 3.4.19，`bg-linear-to-*` 是 v4 命名零输出）；no-color-hex baseline key 含**行文本 hash**（lint-gate.mjs:8）——既有含 hex 的行必须逐字保留（本计划 T4 涉及 SortableImageItem.tsx:127 的 `border-[#2A2A34]` 行）。

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
import { decideReferencePick } from './referenceSelect';

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
});
```

- [ ] **Step 1.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/referenceSelect.test.ts`（cwd=apps/web）
Expected: FAIL（模块不存在）。

- [ ] **Step 1.3: 实现**

创建 `referenceSelect.ts`：

```ts
/** 画布参考选择——可选判定纯函数（spec §3.3）。
 * 类型守卫复用 nodeStore.isImageNode（:201-205，恰为 imageGen|imageExtGen——不留第二份节点分类表）；
 * 主图 = data.fileId ?? data.referenceImage（与 ImageGenNode.tsx:82-87 展示解析同源）。 */
import { isImageNode } from '@/stores/nodeStore';

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
  if (!isImageNode(targetNode)) return { kind: 'ignore' };
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

### Task 2: nodeStore——referenceSelect 状态 + 编辑/变换模式联动退出 + 满员提示 + styleId/styleName 类型

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`（NodeState 接口 :294 起加 3 声明；store 实现加字段与 4 个 action；:360-372 两个 setActive* 各加一行联动；`ImageNodeData` :117 与 `VideoNodeData` :137 后各加 2 类型字段）
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

5. 类型（从原 T16 前移至此——使 T14 的 updateConfig 无需 `as never`；读取侧 VideoConfigPanel 渲染选中态需要字段在 VideoNodeData 上，spec §7.1）：`ImageNodeData` 的 `style?: string;`（:117）之后与 `VideoNodeData` 的 `prompt?: PromptValue;`（:137）之后各加：

```ts
  styleId?: string | null;   // 风格库选中（null=已取消，D16 契约：键存在值 null）
  styleName?: string | null;
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
- Modify: `apps/web/src/pages/canvas/page.test.tsx`（nodeStore mock getState 补两键——Step 3.5，第八轮 A2）

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

    it('三个 open 与 toggle 开分支均跨 store 调 exitReferenceSelect（menuStore→nodeStore 单向；关分支不触发）', () => {
      const exitSpy = vi.spyOn(useNodeStore.getState(), 'exitReferenceSelect');
      useMenuStore.getState().open();             // 1
      useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } }); // 2
      useMenuStore.getState().openStyleLibrary('img1'); // 3
      useMenuStore.getState().toggle();           // 此刻 isOpen=false → 开分支 → 4
      expect(exitSpy).toHaveBeenCalledTimes(4);
      useMenuStore.getState().toggle();           // 由开变关 → 不触发
      expect(exitSpy).toHaveBeenCalledTimes(4);
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

- [ ] **Step 3.5: page.test.tsx nodeStore mock 补键（第八轮 A2——Tab 用例走真 menuStore.open）**

`apps/web/src/pages/canvas/page.test.tsx` 的 nodeStore mock（:87-93）getState 返回对象补两键：

```tsx
      getState: vi.fn(() => ({
        nodes: {},
        activeTransformNodeId: null,
        activeEditNodeId: null,
        referenceSelect: null,
        exitReferenceSelect: vi.fn(),
        setActiveTransformNodeId: vi.fn(),
        setActiveEditNodeId: vi.fn(),
      })),
```

（menuStore 在 page.test 为**真模块**（未 mock）；Tab 用例（:554-559「isHydrating=false 时 Tab 正常开菜单」）经 `useMenuStore.getState().open(pos)` 触发 T3 新增的跨 store 调用 `useNodeStore.getState().exitReferenceSelect()`——mock getState 缺该方法 → TypeError、`isOpen` 永不置 true、该用例必红。`referenceSelect: null` 同时保住 T7 Tab gate 的 falsy 路径。）

Run: `npx vitest run src/pages/canvas/page.test.tsx`
Expected: 全 PASS。

- [ ] **Step 3.6: 全量回归 + Commit**

Run: `npx vitest run`（cwd=apps/web）
Expected: 全绿（page.test 已在 Step 3.5 修复；其余消费 menuStore 的既有测试若因新字段失败，按其 mock 模式补 `styleLibrary: null` 初值）。

```bash
git add src/stores/menuStore.ts src/stores/menuStore.test.ts src/pages/canvas/components/HandleAddNodeMenu.test.tsx src/pages/canvas/page.test.tsx
git commit -m "feat(web): menuStore styleLibrary 第三切片——三向互斥（open/openHandleMenu/openStyleLibrary 各清其余+跨 store 退出参考选择）+toggle 由关变开清其余（修既有缺陷）+page.test mock 补跨 store 方法键"
```

---

### Task 4: SortableImageItem——序号/X 角标两态 + overflow 下移防裁切

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx`

要点（spec §3.4/D8/B18）：`index?: number` prop；角标挂新包裹层（一半悬外），原容器 div 的 className 行（:127 含 `border-[#2A2A34]`）**内容逐字保留**——no-color-hex baseline key = `sha256(TrimEnd(行文本))`（lint-gate.mjs:36-40），TrimEnd 只去尾部空白、**行首内容（前导缩进/元素前缀）参与哈希**：包裹后该 hex 行行首多出 `<div ` 前缀（正常排版下缩进亦随嵌套加深）→ 行文本变 → 键变，产生 **0 或 1 条**新增违例（正常为 1，见 Step 4.4 判定式流程）——按 **手工伴随重键**收口（lint-gate.mjs:139 note：机械清理允许伴随重键（计数不增），**UPDATE_BASELINE 全量重采是 B5 控制动作、日常禁用**）；两态复用既有本地 `hovered`（原生 mouseover/out）；uploading/error 态角标仍显示（z-10）；X 从 StatusOverlay 的 success 分支移除由角标接管，**同时删 StatusOverlay 孤立的 `isDragging` 与 `onDelete` 两个 prop**（二者唯一消费点均在被删的 success 分支——:42-52，调用点传参一并删）。同文件已在 no-theme-utility 白名单（allow:['bg','text']），角标沿用 bg-black/text-white 零登记成本。**本 Task 同 commit 让 ImageThumbnailBar 传 index**（否则 T4→T5 中间态缩略图无法删除）。

- [ ] **Step 4.1: 写失败测试**

在 `SortableImageItem.test.tsx` 的 describe 末尾追加（import 区补 `fireEvent` 若无）：

```tsx
  // ---- 序号/X 角标两态（spec §3.4，D8）----
  it('9. 传 index 时常态渲染序号角标（index+1），一半悬外（transform 含 translate）', () => {
    render(<SortableImageItem image={baseImage} index={2} onDelete={onDelete} onClick={onClick} />);
    const badge = screen.getByTestId('ref-badge-index');
    expect(badge.textContent).toBe('3');
    expect(badge.parentElement?.style.transform).toContain('translate'); // 不锚字面量（jsdom 归一化差异防脆）
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

`SortableImageItem.tsx` 四处改动：

1. props 加 `index?: number;`（:7-11 接口）并解构；
2. `StatusOverlay` 的 `if (status === 'success' && !isDragging)` 分支（:42-52）**整段删除**（X 由角标接管），并**从其 props 接口/调用删去 `isDragging` 与 `onDelete`**（两者唯一消费点均在该分支，uploading/error 蒙层不使用）；
3. JSX（:120-142）改为**新包裹层结构**——原容器 div 的 className 行（:127）**类字符串内容逐字保留**（`"w-[50px] h-[50px] rounded-md overflow-hidden flex-shrink-0 border border-[#2A2A34] cursor-pointer relative group"` 一字不改，尺寸留在内层）；ref/attributes/listeners 上移到新包裹层：

```tsx
  return (
    <>
      <div
        ref={setRef}
        style={style}
        {...attributes}
        {...listeners}
        className="relative flex-shrink-0"
      >
        {/* 原 :127 className 串逐字保留（含 border-[#2A2A34]）——行首多 <div 前缀（缩进不变）→ 行文本变 → 0/1 条 hex 新键，
            Step 4.4 按手工伴随重键收口（勿改类字符串内容） */}
        <div className="w-[50px] h-[50px] rounded-md overflow-hidden flex-shrink-0 border border-[#2A2A34] cursor-pointer relative group">
          <img
            src={url}
            alt={name}
            className="w-full h-full object-cover"
            onClick={handleClick}
          />
          {(status === 'uploading' || status === 'error') && (
            <StatusOverlay status={status} progress={progress} />
          )}
        </div>

        {typeof index === 'number' && (
          <div
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

（预览 portal 段原样保留。StatusOverlay 定义同步删 isDragging/onDelete 参数与类型——组件只剩 uploading 进度与 error 两分支。）

- [ ] **Step 4.4: 跑绿 + lint 手工伴随重键（判定式流程——第八轮 A1/B1/P2-1）**

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx`
Expected: 全 PASS（含既有 1/2/4/5/6/8）。

Run: `pnpm lint`（cwd=apps/web）

**判定（不预设条数）**：SortableImageItem.tsx 含 `border-[#2A2A34]` 的行是全文件**唯一** hex 命中（baseline 亦仅 1 键——eslint-hex-baseline.json:181）。包裹层使该行行首多出 `<div ` 前缀/缩进随嵌套加深 → 通常报 **1 条**新增违例；若排版恰好使行文本逐字未变则为 **0 条**——两者都合法。**≥2 条=实现偏离（类字符串被改字或引入新 hex），回查勿继续。**

- **0 条** → 无需任何 baseline 操作，直接进 Step 4.5。
- **1 条** → 手工伴随重键（lint-gate.mjs:139 通道：只换这一把键，不动其余键与 meta）。先按文件实际行算新键（与 lint-gate.mjs:36-40 同算法）：

```bash
# cwd=apps/web（脚本 APP_ROOT 自解析，node -e 的相对路径按 cwd）
node -e "const{createHash}=require('crypto');const fs=require('fs');const line=fs.readFileSync('src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx','utf8').split(/\r?\n/).find(l=>l.includes('#2A2A34'));console.log('flowweb/no-color-hex|src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx|'+createHash('sha256').update(line.replace(/\s+$/u,''),'utf8').digest('hex'))"
```

用 Edit 把 `e2e/audit/eslint-hex-baseline.json` 中旧键整行（前缀 `flowweb/no-color-hex|src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx|` 开头那行，:181，含前导缩进与尾逗号）替换为上面输出的新键。复验：

```bash
pnpm lint   # → 门禁绿
git diff e2e/audit/eslint-hex-baseline.json   # 必须只显示 1 行键被替换；meta.count/capturedAt 与其余键零变化
```

（**禁用** `UPDATE_BASELINE=1` / `--update-baseline`：全量重采是 B5 控制的动作（lint-gate.mjs:139 note 明文排除日常使用），且会连带改写 `meta.capturedAt`——diff 复核标准随之失真。）

- [ ] **Step 4.5: ImageThumbnailBar 同 commit 传 index（防中间态不可删图）**

`ImageThumbnailBar.tsx` 的 SortableImageItem 渲染处（:150-159）改为带下标传入：

```tsx
          {images.map((image, idx) => (
            <SortableImageItem
              key={image.id}
              index={idx}
              image={image}
              onDelete={disabled ? () => {} : handleDeleteImage}
              onClick={disabled ? () => {} : onImageClick}
            />
          ))}
```

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/`
Expected: 全 PASS。

- [ ] **Step 4.6: Commit**

```bash
git add src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx src/pages/canvas/components/nodes/prompt-input/SortableImageItem.test.tsx src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx e2e/audit/eslint-hex-baseline.json
git commit -m "feat(web): 参考图序号/X 角标两态——index prop+新包裹层一半悬外角标（:127 hex 行行首多 <div 前缀 → baseline 单键重键、计数不变）+hover 复用原生 hovered 变 X 删除+StatusOverlay 删孤立 isDragging/onDelete+ImageThumbnailBar 同 commit 传 index（spec §3.4/D8/B18）"
```

---

### Task 5: ImageThumbnailBar——参考按钮=模式入口恒显 + 删 file input + pt-3 + 风格按钮开库

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/types.ts`（新增 MAX_REFERENCE_IMAGES 常量——C3 第八轮）

要点（spec §3.1/D19）：参考按钮脱离 `showUploadButton` 门控**恒显**（语义=模式入口）但**接 `disabled`**（生成中 status==='loading' 时渲染但点击无效——与原上传按钮的 !disabled 门控语义一致，P9 收紧：生成中不得改参考图/风格）；删除隐藏 file input/`handleUploadClick`/`handleFileChange`（拖拽 handleDrop/processUpload 保留）；图标换「卡片选择」（与横幅同款）；`pt-3` 防外层裁切（**spike 步骤先跑**）；风格按钮 onClick → `openStyleLibrary(nodeId)`（menuStore Task 3 已就绪；进入参考选择时关风格库的组件层收口也在此）。**满员上限抽常量（C3）**：`types.ts` 加 `export const MAX_REFERENCE_IMAGES = 9;`，组件默认参数改 `maxCount = MAX_REFERENCE_IMAGES`——**本功能新增三处共用同一常量**（工具行默认参数/拾取守卫/横幅文案；两处面板均未传 maxCount、依赖默认值，已核实）。既有硬编码 9 按精准修改**不动**并登记已知不一致：仅 PromptEditor.tsx:24 粘贴路径一处（useImageUpload 为参数化无硬编码、PromptInput 无上限判断，均已核实）。

- [ ] **Step 5.1: spike——pt-3 三面板布局影响（B22，浏览器 5 分钟）**

启动 dev server（`pnpm dev`，apps/web），在任一画布放一个图片节点（无主图、单选见图 5 面板），肉眼确认：工具行加 `pt-3` 后条高 +12px、面板不溢出、风格/参考 56px 按钮与 50px 缩略图垂直对齐可接受；**最右一张缩略图的角标不被容器 overflow-x-auto 横向裁切**（角标右移 9px 出 50px 图——必要时容器 `pr-2.5` 或角标改 inset 定位）。不可接受则回到本任务调整（如 pt-2.5+角标 16px 组合）并把结论登记 spec §3.4。spike 通过后继续。

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

3. **#8**（:265-295）disabled 断言改为「disabled 时参考/风格按钮仍渲染（恒显）但点击无效」（用例标题同步改——原标题 "disabled prop hides + button…" 已成假陈述）：把 `expect(screen.queryByTestId('upload-button')).not.toBeInTheDocument();` 改为：

```tsx
    // 参考按钮恒显（D19）但 disabled 时点击无效（P9：生成中不得进模式改参考图）
    expect(screen.getByTestId('upload-button')).toBeInTheDocument();
    expect((screen.getByTestId('upload-button') as HTMLButtonElement).disabled).toBe(true);
```

（drop 不触发上传的断言保留；`fireEvent.click` 对 disabled button 不触发 onClick，无需额外断言。）

3b. **#11**（:332-345，第七轮 P1-2——v2 改造清单漏列，`queryByTestId('upload-button')).not.toBeInTheDocument()` 与恒显直接矛盾）整例替换为：

```tsx
  it('11. 满员时风格与参考按钮均恒显（D19：参考=模式入口，不再随 maxCount 隐藏）', () => {
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
    expect(screen.getByRole('button', { name: '风格' })).toBeInTheDocument();
  });
```

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

1. import 区：删 `useRef`（若仅 fileInputRef 使用）、加 `import { useNodeStore } from '@/stores/nodeStore';`、`import { useMenuStore } from '@/stores/menuStore';`、值导入 `import { MAX_REFERENCE_IMAGES } from './types';`（**另起一行**——现有 :18 是 `import type { ImageItem } from './types';`，值塞进 type-only import 行编译错）；同时函数签名默认参数 `maxCount = 9` → `maxCount = MAX_REFERENCE_IMAGES`；
2. 删除 `fileInputRef`、`handleUploadClick`、`handleFileChange`（:42、:92-94、:82-85）与 JSX 中的 `<input ... data-testid="file-input">`（:133-141）；
3. `showUploadButton` 变量删除；参考按钮 JSX（:118-143 的 `{showUploadButton && (...)}` 包裹解除，按钮本身移出条件），按钮改为（**接 disabled**）：

```tsx
      {/* 参考按钮 = 画布选择模式入口（spec §3.1/D19：恒显、图标=卡片选择、disabled=生成中点击无效 P9；进入时组件层关闭风格库——nodeStore→menuStore 方向收口防 ESM 循环） */}
      <button
        data-testid="upload-button"
        aria-label="参考"
        disabled={disabled}
        onClick={() => {
          useMenuStore.getState().closeStyleLibrary();
          useNodeStore.getState().startReferenceSelect(nodeId);
        }}
        className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-overlay-2 transition-colors hover:bg-overlay-3 focus:outline-none shadow-none outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg data-icon="card-select" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <path d="M6.5 17.5H14A3.5 3.5 0 0 0 17.5 14V6.5" />
          <path d="M6.5 6.5h3v3h-3z" fill="currentColor" stroke="none" />
        </svg>
        <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">参考</span>
      </button>
```

4. 风格按钮（:106-116）加 `disabled={disabled}` 与 onClick：`onClick={() => useMenuStore.getState().openStyleLibrary(nodeId)}`（aria-label/样式不动，className 补 `disabled:cursor-not-allowed disabled:opacity-50`）；
5. 容器 div（:99-105）className 首项 `flex items-center gap-2 overflow-x-auto pb-1` → `flex items-center gap-2 overflow-x-auto pt-3 pb-1`（防裁切第 2 层，spec §3.4）；
6. `SortableImageItem` 渲染已在 Task 4 Step 4.5 传 index（本 Task 不再改）。

- [ ] **Step 5.5: 跑绿 + 全量回归**

Run: `npx vitest run src/pages/canvas/components/nodes/prompt-input/`（含 ImageConfigPanel/VideoConfigPanel 面板测试——它们 mock 掉本组件不受影响；PromptInput.test 若断言 file-input 需同步检查）
Expected: 全 PASS。

Run: `npx vitest run`（cwd=apps/web）
Expected: 全绿。

- [ ] **Step 5.6: Commit**

```bash
git add src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx src/pages/canvas/components/nodes/prompt-input/types.ts
git commit -m "feat(web): 参考按钮=画布选择模式入口——恒显脱离 maxCount 门控+卡片选择图标+删 file input（拖拽/粘贴保留）+pt-3 防裁切+风格按钮开风格库（组件层互斥收口）（spec §3.1/D19/D2）"
```

---

### Task 6: CanvasReferenceSelectBanner——顶部横幅

**Files:**
- Create: `apps/web/src/pages/canvas/components/CanvasReferenceSelectBanner.tsx`
- Create: `apps/web/src/pages/canvas/components/CanvasReferenceSelectBanner.test.tsx`

要点（spec §3.2）：absolute 顶部居中（ReactFlow 子级、不随 viewport 变换——先例 CanvasToolbar.tsx:51 为 bottom-left，"顶部居中"是本功能新形态）；`role="status"` 在文案 span；Esc=纯退出；「返回节点」=退出+滚动+选中——**几何取 `useReactFlow().getNode(id)`**（P11：nodeStore 节点无 measured/internals，RF 内部节点才有 positionAbsolute+measured）；notice 由 store flash 驱动。

- [ ] **Step 6.1: 写失败测试**

创建 `CanvasReferenceSelectBanner.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasReferenceSelectBanner } from './CanvasReferenceSelectBanner';
import { useNodeStore } from '@/stores/nodeStore';

// 固定 spy（vi.hoisted）——getState 每次返回同一对象，否则断言拿到全新 vi.fn() 恒 0 调用
const { selectNodeSpy } = vi.hoisted(() => ({ selectNodeSpy: vi.fn() }));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ selectNode: selectNodeSpy }) },
}));

const setCenter = vi.fn();
const getNode = vi.fn();
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ setCenter, getNode }),
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

  it('返回节点 → 退出+setCenter 到节点中心（几何取 useReactFlow().getNode，P11）+selectNode', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    // 几何从 RF 内部节点取（P11：nodeStore 节点无 measured/internals）
    getNode.mockReturnValue({
      id: 'img1',
      position: { x: 100, y: 200 },
      measured: { width: 200, height: 150 },
      internals: { positionAbsolute: { x: 100, y: 200 } },
    });
    render(<CanvasReferenceSelectBanner />);
    fireEvent.click(screen.getByRole('button', { name: '返回节点' }));
    expect(useNodeStore.getState().referenceSelect).toBeNull();
    expect(setCenter).toHaveBeenCalledWith(200, 275, expect.anything());
    expect(selectNodeSpy).toHaveBeenCalledWith('img1');
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
  const { setCenter, getNode } = useReactFlow();

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
    useNodeStore.getState().exitReferenceSelect();
    // P11：几何取 RF 内部节点（nodeStore 节点无 measured/internals）
    const node = getNode(sourceNodeId) as any;
    if (node) {
      const abs = node.internals?.positionAbsolute ?? node.position ?? { x: 0, y: 0 };
      const w = node.measured?.width ?? node.width ?? 0;
      const h = node.measured?.height ?? node.height ?? 0;
      setCenter(abs.x + w / 2, abs.y + h / 2, { duration: 300 });
      // 注：selectNode 只写 canvasStore.selectedId（P12）——面板可见由 elementsSelectable=false（D25）保证，
      // 此调用仅服务 selectedId 的其他消费方（如批量工具条），非面板保活手段
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
- Modify: `apps/web/src/hooks/useGroupKeyboard.ts`（Step 7.3——勿漏 git add，否则改动游离工作区）
- Modify: `apps/web/src/hooks/useGroupKeyboard.test.ts`（Step 7.3 可变 mock + 新用例）

薄接线任务（决策已纯函数化 Task 1、状态已 store 化 Task 2/6）：ReactFlow 真实手势下 onNodeClick 与拖拽抑制由 tsc + 全量回归 + Task 18 人工验收承保（先例：image-node-panel-redesign Task 9 同款定位）。

- [ ] **Step 7.1: CanvasView 接线**

1. import 区补：`import { decideReferencePick } from './referenceSelect';`、`import { CanvasReferenceSelectBanner } from './CanvasReferenceSelectBanner';`、`import { getMediaUrl } from '@/api/mediaApi';`、`import { MAX_REFERENCE_IMAGES } from './nodes/prompt-input/types';`（C3 常量，T5 已建；`useNodeStore` 已有）。
2. 组件体（:105 `isLocked` 之后）加：

```tsx
  const referenceSelect = useNodeStore((s) => s.referenceSelect);
  const inRefSelect = referenceSelect !== null;
```

3. `onNodeClick`（:200-209）在 `const ns = useNodeStore.getState();` **之后**插分支，且 useCallback deps 补 `handleReferencePick`（仓内启用 react-hooks/exhaustive-deps，漏 deps 会 lint 红）——改后结尾为 `}, [selectNode, handleReferencePick]);`：

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
    const decision = decideReferencePick(sourceNodeId, targetNode, currentImages.map((i: { id: string }) => i.id), MAX_REFERENCE_IMAGES);
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'full') {
      store.flashReferenceNotice(`最多 ${MAX_REFERENCE_IMAGES} 张参考图`);
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

（`useNodeStore` 已在 page.tsx import；若无需补 import。**回归面**：page.test.tsx:549/:558 已测 Tab——nodeStore mock 的 getState() 已在 T3 Step 3.5 补 `referenceSelect: null`（falsy 不触发早退）与 `exitReferenceSelect` 方法（缺方法会被 menuStore.open 的跨 store 调用打成 TypeError，第八轮 A2 已修），本步无额外测试改造。）

- [ ] **Step 7.3: useGroupKeyboard 早退 + 用例（P10 + 第八轮 C1）**

`src/hooks/useGroupKeyboard.ts` 的 `isGroupEditContext`（:9-26，纯布尔函数、return true=调用方跳过快捷键，已核实）首个条件之前插：

```ts
  if (useNodeStore.getState().referenceSelect) return true; // 画布参考选择模式禁分组/撤销快捷键（spec §3.1：模式期 Ctrl+Z 等不生效——防撤销刚加入的参考图）
```

（`useNodeStore` 若未 import 则补；该 hook 为纯 getState 判定无副作用，插首条安全。）

既有 `useGroupKeyboard.test.ts:5-12` 的静态 getState mock（只回 activeEdit/activeTransform 两键）**覆盖不到新分支**——先改可变旗标再补用例（C1：这是本功能防「撤销掉刚加入的参考图」的唯一闸门，不能零覆盖）。mock 区（:5-12）替换为：

```ts
// vi.hoisted：mock 工厂提升到 import 前，普通 const 会 TDZ——可变旗标供用例拨动 referenceSelect
const nodeState = vi.hoisted(() => ({
  activeEditNodeId: null as string | null,
  activeTransformNodeId: null as string | null,
  referenceSelect: null as unknown,
}));
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: { getState: () => nodeState },
}));
```

用例（追加进 `describe('isGroupEditContext（编辑态判定 spec 6.3）')`，:33-40）：

```ts
  it('参考选择模式 → true（模式期 Ctrl+Z/G/Y 被禁，spec §3.1——防撤销刚加入的参考图）', () => {
    nodeState.referenceSelect = { sourceNodeId: 'img1' };
    expect(isGroupEditContext(document.createElement('div'))).toBe(true);
    nodeState.referenceSelect = null; // 还原，防污染既有用例
  });
```

（默认值与原静态 mock 逐键相同，既有用例行为不变。）

Run: `npx vitest run src/hooks/useGroupKeyboard.test.ts`
Expected: 全 PASS（含新用例）。

- [ ] **Step 7.4: 验证**

Run: `npx vitest run src/pages/canvas/components/CanvasView.test.tsx src/pages/canvas/page.test.tsx src/hooks/useGroupKeyboard.test.ts && npx tsc -b --pretty false`
Expected: 既有测试全 PASS；tsc 无新增报错（CanvasView.test 的 nodeStore mock 若缺 referenceSelect 键，按其既有 mock 模式补 `referenceSelect: null`）。

- [ ] **Step 7.5: Commit**

```bash
git add src/pages/canvas/components/CanvasView.tsx src/pages/canvas/page.tsx src/hooks/useGroupKeyboard.ts src/hooks/useGroupKeyboard.test.ts
git commit -m "feat(web): 参考选择模式接线——nodesDraggable+elementsSelectable 双 prop（D25）/onNodeClick 拾取分支（presign 异步+读最新写回）/deleteKeyCode 置空/Tab 键 gate/useGroupKeyboard 早退（Ctrl+Z/G/Y，含可变 mock 用例）/挂横幅（spec §3.1/§3.3）"
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
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  style     Style    @relation(fields: [styleId], references: [id], onDelete: Cascade)
  @@unique([userId, styleId])
  @@index([userId, createdAt])
}

model StyleRecentUsage {
  id         String   @id @default(cuid())
  userId     String
  styleId    String
  lastUsedAt DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
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
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  styleFavorite: {
    findMany: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  styleRecentUsage: {
    findMany: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
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

    it('tab=favorites：分页 join 行（styleFavorite.createdAt desc, id desc）——我的收藏时间倒序非全局收藏数', async () => {
      prisma.styleFavorite.findMany.mockResolvedValue([
        { id: 'f2', styleId: 's2', createdAt: new Date(), style: { id: 's2', name: 'B', coverKey: 'k2', authorName: null, isCommercial: false, usageCount: 0, promptText: 'p', active: true } },
      ]);
      prisma.styleFavorite.count.mockResolvedValue(1);
      const out = await service.list('u1', { tab: 'favorites', page: 1, pageSize: 20 });
      expect(prisma.styleFavorite.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', style: { active: true } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0, take: 20,
      }));
      expect(out.items[0]).toMatchObject({ id: 's2' });
      expect(prisma.style.findMany).not.toHaveBeenCalled(); // 不走 style 主表分页
    });

    it('tab=recent：同构换 styleRecentUsage.lastUsedAt desc；favorited 按真实收藏集（用过≠收藏，P1-5）', async () => {
      prisma.styleRecentUsage.findMany.mockResolvedValue([
        { id: 'r1', styleId: 's2', lastUsedAt: new Date(), style: { id: 's2', name: 'B', coverKey: 'k2', authorName: null, isCommercial: false, usageCount: 0, promptText: 'p', active: true } },
      ]);
      prisma.styleRecentUsage.count.mockResolvedValue(1);
      prisma.styleFavorite.findMany.mockResolvedValue([]); // 未收藏过
      const out = await service.list('u1', { tab: 'recent', page: 1, pageSize: 20 });
      expect(prisma.styleRecentUsage.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', style: { active: true } },
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
      }));
      expect(out.items[0].favorited).toBe(false); // 钉死：recent 不硬编码 true
    });

    it('搜索在收藏 tab 同样生效（styleFilter 折入 relation filter，P1-6；recent 走同一 styleFilter 构造）', async () => {
      prisma.styleFavorite.findMany.mockResolvedValue([]);
      prisma.styleFavorite.count.mockResolvedValue(0);
      await service.list('u1', { tab: 'favorites', search: '胶片', commercialOnly: true, page: 1, pageSize: 20 });
      expect(prisma.styleFavorite.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', style: { active: true, isCommercial: true, OR: expect.any(Array) } },
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
      expect(out.id).toBe('s1'); // 返回扁平 StyleListItem（H3 口径统一：测试/实现/前端三方一致）
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

    // 共享 style 过滤（P1-6 第七轮：搜索/商用在收藏/最近 tab 同样生效——搜索框三 tab 恒显，别留假交互）
    const styleFilter: any = { active: true };
    if (q.commercialOnly) styleFilter.isCommercial = true;
    if (q.search) {
      styleFilter.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { authorName: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    // favorites/recent：分页 join 行驱动（该用户收藏/使用时间倒序——非全局收藏数；
    // join 行 id 作 tiebreaker，spec §4.2 稳定序）。all：style 主表分页。
    if (q.tab === 'favorites' || q.tab === 'recent') {
      const isFav = q.tab === 'favorites';
      const model = isFav ? this.prisma.styleFavorite : this.prisma.styleRecentUsage;
      const timeField = isFav ? 'createdAt' : 'lastUsedAt';
      const joinWhere = { userId, style: styleFilter };
      const [joinRows, total] = await Promise.all([
        (model.findMany as any)({
          where: joinWhere,
          orderBy: [{ [timeField]: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { styleId: true, style: true },
        }),
        (model.count as any)({ where: joinWhere }),
      ]);
      const styleRows = (joinRows as Array<{ style: any }>).map((r) => r.style);
      // favorited 修复（P1-5 第七轮：favorited:true 硬编码会把「用过未收藏」全显示实心星，
      // 且点星第一次 toggle 会误发 false 删不存在的收藏）——recent 批量查真实收藏集
      const favSet = isFav
        ? new Set(styleRows.map((s) => s.id))
        : new Set(
            (await this.prisma.styleFavorite.findMany({
              where: { userId, styleId: { in: styleRows.map((s) => s.id) } },
              select: { styleId: true },
            })).map((f) => f.styleId),
          );
      const items = await Promise.all(
        styleRows.map(async (r) => ({
          id: r.id, name: r.name, authorName: r.authorName, isCommercial: r.isCommercial,
          usageCount: r.usageCount, promptText: r.promptText,
          coverUrl: await this.minio.generatePresignedGetUrl(r.coverKey, 3600),
          favorited: favSet.has(r.id),
        })),
      );
      return { items, total, page, pageSize };
    }

    // spread 而非就地改写（第八轮 B2：styleFilter 为共享对象，就地赋值在将来插入分支时会串味）
    const where: any = q.categoryId ? { ...styleFilter, categoryId: q.categoryId } : styleFilter;

    // 排序含 id tiebreaker（spec §4.2——偏移分页需稳定序）
    const orderBy = [{ sortOrder: 'asc' as const }, { usageCount: 'desc' as const }, { id: 'asc' as const }];

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

  /** 幂等 toggle：createMany skipDuplicates / deleteMany 双向不抛（spec D26）。
   *  typeof 校验：controller 无 ValidationPipe，非布尔值不得静默按 false 取消收藏（P17）。 */
  async favorite(userId: string, styleId: string, favorited: boolean): Promise<{ favorited: boolean }> {
    if (typeof favorited !== 'boolean') throw new BadRequestException('favorited 必须为布尔值');
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
    return this.getById(userId, styleId); // 扁平 StyleListItem（use 返回形状口径：扁平，非 { style } 包装——H3）
  }
}
```

（use 的返回为扁平 StyleListItem；spec §6.1 表中「→ `{ style }`」按此口径更正为「→ StyleListItem 扁平」。favorite 需在文件头部 import 补 `BadRequestException`。）

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
```

（无 FavoriteDto——favorite 的参数校验在 styles.service 内 `typeof favorited !== 'boolean'` 判定（P17：@Type(()=>Boolean) 会把 "false" 字符串转 true，语义陷阱）；dto 文件头部的 `Type` import 若因此未被使用则删。）

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
    try {
      return await this.prisma.styleCategory.create({ data: { name: dto.name, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException('分类已存在'); // 并发创建撞唯一名（P16）
      throw e;
    }
  }

  async updateCategory(id: string, dto: UpdateStyleCategoryDto) {
    const existing = await this.prisma.styleCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.styleCategory.update({ where: { id }, data }).catch((e) => {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException('分类已存在'); // 改名撞唯一索引（P2-1——比并发创建更常见）
      throw e;
    });
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
    try {
      return await this.prisma.style.create({
        data: {
          name: dto.name, categoryId: dto.categoryId, coverKey: dto.coverKey,
          authorName: dto.authorName ?? null, isCommercial: dto.isCommercial ?? false,
          promptText: dto.promptText, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2003') throw new BadRequestException('分类不存在'); // 非法 categoryId FK（P16）
      throw e;
    }
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
    const updated = await this.prisma.style.update({ where: { id }, data }).catch((e) => {
      if ((e as { code?: string }).code === 'P2003') throw new BadRequestException('分类不存在');
      throw e;
    });
    if (coverChanged) await this.minio.delete(existing.coverKey).catch(() => {}); // 换图清旧对象，失败不阻断（banner 先例）
    return updated;
  }

  async deleteStyle(id: string) {
    const existing = await this.prisma.style.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('风格不存在');
    // 对象删除失败不阻断行删除（updateStyle 同款 .catch；MinIO 抖动时管理员不被 500 卡死——P3-4）
    await this.minio.delete(existing.coverKey).catch(() => {});
    return this.prisma.style.delete({ where: { id } }); // Cascade 清收藏/最近由 FK 承担
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

`execution.service.spec.ts` 末尾追加（在顶层 describe 内）。**签名与 mock 基线（B5）**：真实签名为 `execute(projectId, nodeId, userId, nodeIds?, sv?)`（:35），且 `:40 if (!project) return`——新 describe 必须补 `canvasProject.findUnique`/`pricingRule.findFirst` 基线（既有用例逐个自补，:83 实证），否则四条用例全在「项目不存在」早退处红且与被测行为无关：

```ts
  describe('风格拼接与面板 prompt 断链（spec §7.1/§7.2，D12/D28）', () => {
    beforeEach(() => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' }); // :40 早退基线（B5）
      prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 }); // 对齐既有 12 处基线取值（:84 等）——0 会走 if(vCost>0) 另一分支（P3-5）
      prisma.style.findMany.mockResolvedValue([]);
    });

    it('D12：独立图片节点（无上游文本）data.prompt.text 进 prompt', async () => {
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', prompt: { text: '面板词', html: '面板词' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: [], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '面板词' }));
    });

    it('风格拼接：styleId → 批量 findMany 取 active promptText，join(", ") 到 prompt', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: '上游词' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(prisma.style.findMany).toHaveBeenCalledWith({ where: { id: { in: ['st1'] } } });
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词, 风格词' }));
    });

    it('inactive/不存在风格 → 忽略不阻塞（B1）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: false, promptText: '风格词' }]);
      topology.sort.mockReturnValue([
        { id: 'n2', type: 'imageGen', data: { model: 'm1', styleId: 'st1' } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: ['上游词'], imageUrl: undefined });
      await service.execute('p1', 'n2', 'u1');
      expect(apiCaller.callImageGen).toHaveBeenCalledWith(expect.objectContaining({ prompt: '上游词' }));
    });

    it('视频分支：finalPrompt 拼风格 + 面板清空 prompt 不传对象（D28 删回退）', async () => {
      prisma.style.findMany.mockResolvedValue([{ id: 'st1', active: true, promptText: '风格词V' }]);
      topology.sort.mockReturnValue([
        { id: 'n3', type: 'videoGen', data: { model: 'vm', styleId: 'st1', prompt: { text: '', html: '' } } },
      ]);
      topology.collectUpstreamData.mockReturnValue({ textContents: [], imageUrl: undefined });
      await service.execute('p1', 'n3', 'u1');
      const arg = apiCaller.callVideoGen.mock.calls[0][0] as { prompt: unknown };
      expect(arg.prompt).toBe('风格词V');           // 纯风格文本（面板为空）
      expect(typeof arg.prompt).toBe('string');      // 不再序列化 PromptValue 对象
    });
  });
```

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

（**位置**：追加在 `base` fixture 所在的**顶层 describe 作用域内**（:13 起），勿落到 describe 外——M5；`rawNode` 为本文件既有 helper，`out.nodes[0].data` 在 strict 下如报隐式 any 则 `(out.nodes[0] as any).data`。）

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
Expected: 全 PASS（既有 `toEqual(['aiTool','aspectRatio'])` 类断言按 `field in src` 判定、fixture 无 styleId——新增白名单字段不影响既有断言，已核实 :59；clone spec 的 data 形状断言若有 exact toEqual 需同步）。

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
    // 断言按实现的真实插入顺序（URLSearchParams 保序：构造器三键先、set 两键后——H4）
    expect(f).toHaveBeenCalledWith('/api/styles?tab=favorites&page=2&pageSize=20&search=x&commercialOnly=true');
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
```

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
    const { result } = renderHook(() => useStyleLibrary('img1', onUsed));
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

// onUsed 直传回调（非 opts 对象——第八轮 A2：对象字面量每渲染新建会使 applyStyle deps 失稳 → memo(StyleCard) 恒失效）
export function useStyleLibrary(nodeId: string, onUsed?: () => void) {
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

  const setTab = useCallback((t: StyleTab) => {
    setTabState(t);
    setCategoryId(undefined);
    setCommercialOnly(false); // 切 tab 清商用勾选（P1-6 配套：勾选态残留但 UI 已隐藏会静默过滤收藏列表）
  }, []);
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
      useNodeStore.getState().updateConfig(nodeId, { styleId: style.id, styleName: style.name });
      onUsed?.();
    } catch {
      setUseError('风格使用失败，请重试'); // 失败不关窗（spec §4.4）
    }
  }, [nodeId, onUsed]);

  const clearStyle = useCallback(() => {
    useNodeStore.getState().updateConfig(nodeId, { styleId: null, styleName: null }); // D16：写 null（类型已在 T2 就位，无需强转）
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
Expected: 全 PASS（类型已在 T2 前移，无需 `as never`；mergeNodeData 对 null 值是 `merged[key] = null` 保留——nodeStore.ts:269-271 已核实）。

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

  it('未打开不渲染且不发请求（H1——hook 只在内层挂载）', () => {
    const { container } = render(<StyleLibraryModal />);
    expect(container.innerHTML).toBe('');
    expect(api.fetchStyles).not.toHaveBeenCalled();
    expect(api.fetchStyleCategories).not.toHaveBeenCalled();
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
        <div aria-hidden="true" className="from-black/20 pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
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
              className="flex h-6 items-center overflow-hidden rounded-lg bg-black/65 text-white"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8l4 4L14 4" /></svg>
              </span>
              <span className="max-w-0 truncate whitespace-nowrap pr-0 text-[12px] leading-none opacity-0 transition-[max-width,opacity,padding] duration-150 group-hover:max-w-[3rem] group-hover:pr-2 group-hover:opacity-100">使用</span>
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
        <div aria-hidden="true" className="from-black/70 pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
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
import { useState, useCallback } from 'react';
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

/** 风格库弹窗（spec §4）——外层早退防未开弹窗也拉数据（H1：useStyleLibrary 的挂载 effect
 *  会无条件发请求，组件常驻 page.tsx——早退必须在使用 hook 之前，故拆内外两层）。 */
export function StyleLibraryModal() {
  const styleLibrary = useMenuStore((s) => s.styleLibrary);
  if (!styleLibrary) return null;
  return <StyleLibraryModalInner nodeId={styleLibrary.nodeId} />;
}

function StyleLibraryModalInner({ nodeId }: { nodeId: string }) {
  const closeStyleLibrary = useMenuStore((s) => s.closeStyleLibrary);
  const [detail, setDetail] = useState<StyleSummary | null>(null);

  // handleUsed useCallback + hook 直传回调（第八轮 A2 收口 P3-6）：对象字面量 { onUsed } 每渲染新建
  // 会使 applyStyle deps [nodeId, onUsed] 失稳 → memo(StyleCard) 恒失效；直传后 handleUsed 稳定 → applyStyle 稳定
  const handleUsed = useCallback(() => {
    setDetail(null); // 先清 detail——防下次开库旧详情浮层复现（P2-1）
    useMenuStore.getState().closeStyleLibrary();
  }, []);
  const lib = useStyleLibrary(nodeId, handleUsed);

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
                全部分类
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
              <input type="checkbox" checked={lib.commercialOnly} onChange={(e) => lib.setCommercialOnly(e.target.checked)} style={{ accentColor: 'currentColor' }} />
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
              {lib.searchInput.trim()
                ? '未找到匹配风格'
                : lib.tab === 'favorites' ? '暂无收藏的风格' : lib.tab === 'recent' ? '暂无使用记录' : '未找到匹配风格'}
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

1. `no-theme-utility.js` 白名单（VideoCard 条目 :79 附近之后）加——**white/black 命中全部在 StyleCard.tsx 与 StyleDetailPreview.tsx 两个文件（B6/P5：glob 按文件匹配；StyleLibraryModal.tsx 本体全程 token 零命中，不登记）**：

```js
  { glob: 'src/pages/canvas/components/style-library/StyleCard.tsx', allow: ['bg', 'text', 'border', 'from', 'ring'] },  // 反白 CTA/恒定面族：当前使用 border-white+ring-1 ring-white+bg-white/text-black 徽章+bg-black/50 遮罩+hover 按钮 bg-black/65+封面渐变 from-black——放行条件是整串全部族 ⊆ allow（:164-168），漏 ring 则整串违例（第七轮 P1-3，规则共 10 族非 9 族）
  { glob: 'src/pages/canvas/components/style-library/StyleDetailPreview.tsx', allow: ['bg', 'text'] },                // scrim bg-black/60 中性遮罩+使用钮 bg-white text-black
```

2. `canvas-migration-registry.json` whitelistKeeps 数组尾镜像（结构 `{glob, allow[], why}`，参照 :2416 VideoCard 条目）：

```json
  {
   "glob": "src/pages/canvas/components/style-library/StyleCard.tsx",
   "allow": ["bg", "text", "border", "from", "ring"],
   "why": "2026-09-26 风格库卡片：反白 CTA/恒定面族（当前使用 border-white+ring-white+白底黑字徽章+bg-black/50 压封面遮罩+hover 按钮 bg-black/65+封面渐变 from-black）——先例 TopActionBar 反白 CTA"
  },
  {
   "glob": "src/pages/canvas/components/style-library/StyleDetailPreview.tsx",
   "allow": ["bg", "text"],
   "why": "2026-09-26 风格库详情：scrim bg-black/60 中性遮罩（BaseFullscreenModal:92 同族）+使用钮 bg-white/text-black 反白 CTA"
  }
```

3. 验证：`pnpm lint`（cwd=apps/web）PASS——两个新文件 white/black 族命中全在 allow 列表（StyleLibraryModal.tsx 不应产生任何命中，若 grep 出命中说明实现偏离 token 化，回改实现而非扩白名单）。

- [ ] **Step 15.9: Commit**

```bash
git add src/pages/canvas/components/style-library/ src/pages/canvas/page.tsx scripts/eslint-rules/no-theme-utility.js e2e/audit/canvas-migration-registry.json
git commit -m "feat(web): 风格库弹窗——BaseFullscreenModal 外壳+显式宽卡片(D21)/三 tab/分类 chips/搜索防抖/仅看可商用/5 列网格+加载更多/点卡=使用+关窗(D13)/取消使用 hover 按钮/详情层库内 scrim+role=group(D20/B23)/useError 失败不关窗；白名单 2 条+registry 镜像（spec §4）"
```

---

### Task 16: 工具行风格按钮选中态——封面圆图 TTL 缓存

**Files:**
- Create: `apps/web/src/pages/canvas/components/style-library/styleThumbCache.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx`（风格按钮选中态渲染）

（类型 `styleId/styleName` 已在 Task 2 前移。B1 修正：**直接缓存 getById 返回的 presign coverUrl + 55min TTL**（< presign 3600s），不用 getMediaUrl(coverKey)——那是按 Media 行 id 取 URL 的接口，喂 MinIO key 会 404 且测试 mock 掉后静默。）

- [ ] **Step 16.1: 写失败测试**

创建 `styleThumbCache.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStyleThumb, styleThumbCacheMap } from './styleThumbCache';
import * as api from '@/api/stylesApi';

vi.mock('@/api/stylesApi', () => ({ fetchStyleById: vi.fn() }));

describe('styleThumbCache（TTL 缓存 {styleName, coverUrl, fetchedAt}——B1 方案）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    styleThumbCacheMap.clear();
  });

  it('404/不存在 → null；结果缓存（第二次不发请求，防反复打 404）', async () => {
    (api.fetchStyleById as any).mockResolvedValue(null);
    expect(await getStyleThumb('gone')).toBeNull();
    await getStyleThumb('gone');
    expect(api.fetchStyleById).toHaveBeenCalledTimes(1);
  });

  it('命中 → {styleName, url}；TTL 内同 id 复用不发请求', async () => {
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片', coverUrl: '/presigned.png' });
    const a = await getStyleThumb('s1');
    const b = await getStyleThumb('s1');
    expect(a).toEqual({ styleName: '胶片', url: '/presigned.png' });
    expect(b).toEqual(a);
    expect(api.fetchStyleById).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期（>55min）→ 重新请求刷新', async () => {
    vi.useFakeTimers();
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片', coverUrl: '/p1.png' });
    await getStyleThumb('s1');
    vi.setSystemTime(Date.now() + 56 * 60 * 1000);
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片新名', coverUrl: '/p2.png' });
    const c = await getStyleThumb('s1');
    expect(c).toEqual({ styleName: '胶片新名', url: '/p2.png' });
    expect(api.fetchStyleById).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 16.2: 跑红**

Run: `npx vitest run src/pages/canvas/components/style-library/styleThumbCache.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 16.3: 实现 styleThumbCache.ts**

```ts
import { fetchStyleById } from '@/api/stylesApi';

interface ThumbEntry { styleName: string; coverUrl: string; fetchedAt: number }

const TTL_MS = 55 * 60 * 1000; // < presign 3600s，过期重取（B1：不缓存 MinIO key 再换 URL——直接用接口已 presign 的 coverUrl）

/** 模块级去重缓存（导出 Map 供测试重置，勿挂函数属性——需额外类型声明）。 */
export const styleThumbCacheMap = new Map<string, ThumbEntry | null>();

export async function getStyleThumb(styleId: string): Promise<{ styleName: string; url: string } | null> {
  // has() 优先：负缓存值是 null，falsy 判断会穿透反复打 404（第七轮 P1-4）
  if (styleThumbCacheMap.has(styleId)) {
    const hit = styleThumbCacheMap.get(styleId);
    if (hit === null) return null; // 404 墓碑（进程内不过期，可接受——404 幂等且风格删除后节点残留 styleId 常驻）
    if (Date.now() - hit.fetchedAt < TTL_MS) return { styleName: hit.styleName, url: hit.coverUrl };
  }
  const style = await fetchStyleById(styleId); // 404 → null
  if (!style) {
    styleThumbCacheMap.set(styleId, null);
    return null;
  }
  styleThumbCacheMap.set(styleId, { styleName: style.name, coverUrl: style.coverUrl, fetchedAt: Date.now() });
  return { styleName: style.name, url: style.coverUrl };
}
```

- [ ] **Step 16.4: ImageThumbnailBar 风格按钮选中态**

组件体加订阅与加载：

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

- [ ] **Step 16.5: 跑绿 + 回归**

Run: `npx vitest run src/pages/canvas/components/style-library/styleThumbCache.test.ts src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.test.tsx`
Expected: 全 PASS（ImageThumbnailBar 既有用例 #9/#11/#13/#15/#16 断言「风格」按钮——默认无 styleId 路径不变）。

- [ ] **Step 16.6: Commit**

```bash
git add src/pages/canvas/components/style-library/styleThumbCache.ts src/pages/canvas/components/style-library/styleThumbCache.test.ts src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx
git commit -m "feat(web): 工具行风格按钮选中态——封面圆图 TTL 缓存（55min<presign 3600s，直接用接口 presign coverUrl——B1：勿按 MinIO key 喂 getMediaUrl）+选中显示风格名（spec §4.5）"
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
          <a className="text-accent-danger">删除</a>
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

  const firstRender = useRef(true);
  useEffect(() => { void adminStylesApi.listCategories().then(setCategories).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => setCommitted({ categoryId, search: searchText.trim() }), 300); // 防抖
    return () => clearTimeout(t);
  }, [categoryId, searchText]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; } // 跳过 mount 首次——ProTable 自带首次 request，叠加会双请求（P2-6）
    actionRef.current?.reload();
  }, [committed]);

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
          <a className="text-accent-danger">删除</a>
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
        <span className="text-text-dim-2 ml-2 text-xs">{coverKey ? '已上传' : '未上传'}</span>
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

- [ ] **Step 17.6: StyleCategoriesPage 最小测试（M2——仓内 8/9 admin 页有 colocated 测试；覆盖 spec §6.2 核心行为）**

创建 `apps/web/src/pages/admin/pages/StyleCategoriesPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import StyleCategoriesPage from './StyleCategoriesPage';
import * as adminApi from '@/api/adminApi';

vi.mock('@/api/adminApi', () => ({
  adminStylesApi: {
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
}));

// 页面用 AntdApp.useApp() 取 message——裸渲染时 antd context 默认值 {message:{}} → message.error 抛
// is not a function（P2-2）——必须包 <AntdApp>（HomeBannersPage.test.tsx:3 先例）；外层 <MemoryRouter>
// 对齐 9/9 既有 admin 页测试双层包裹（AnnouncementPage.test.tsx:23 等先例——PageContainer/ProTable 依赖 router context）

describe('StyleCategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.adminStylesApi.listCategories as any).mockResolvedValue([
      { id: 'c1', name: '摄影写真', sortOrder: 1, active: true, createdAt: '2026-01-01' },
    ]);
  });

  it('渲染分类列表行', async () => {
    render(<MemoryRouter><AntdApp><StyleCategoriesPage /></AntdApp></MemoryRouter>);
    expect(await screen.findByText('摄影写真')).toBeInTheDocument();
  });

  it('删除被 400 阻止时中文文案直达（spec §6.2 删除保护）', async () => {
    (adminApi.adminStylesApi.deleteCategory as any).mockRejectedValue(new Error('该分类下存在风格，请先清空后再删除'));
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><StyleCategoriesPage /></AntdApp></MemoryRouter>);
    await screen.findByText('摄影写真');
    await user.click(screen.getByText('删除'));
    // 测试环境无 zhCN locale（antd 默认 en_US → Popconfirm 确认钮文案='OK'，getByText('确定') 必落空）——
    // 统一用类名选择器（AnnouncementPage.test.tsx:49 逐字先例，:61 有坑位注释）
    await waitFor(() => expect(document.querySelector('.ant-popover .ant-btn-primary')).toBeTruthy());
    await user.click(document.querySelector('.ant-popover .ant-btn-primary') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('该分类下存在风格，请先清空后再删除')).toBeInTheDocument();
    });
  });
});
```

（若 message 渲染仍有异常，抄同目录既有 admin 页测试写法对齐——它们已解决同类问题。）

- [ ] **Step 17.7: 跑绿 + 回归**

Run: `npx vitest run src/router.admin.test.tsx src/pages/admin/AdminLayout.test.tsx src/pages/admin/pages/StyleCategoriesPage.test.tsx && npx tsc -b --pretty false`
Expected: 三份测试全 PASS；tsc 无新增报错。

- [ ] **Step 17.8: Commit**

```bash
git add src/api/adminApi.ts src/pages/admin/AdminLayout.tsx src/router.tsx src/pages/admin/pages/StyleCategoriesPage.tsx src/pages/admin/pages/StyleContentPage.tsx src/pages/admin/pages/StyleCategoriesPage.test.tsx src/router.admin.test.tsx src/pages/admin/AdminLayout.test.tsx
git commit -m "feat(web): admin 风格库——菜单组(styles 组 path≠子页)/相对路由 categories+content(D27)/分类页(删除保护 400 文案直达+最小测试)/内容页(封面上传 inline input+页顶自定义筛选跳首双请求+promptText 必填)/adminStylesApi+uploadStyleCover；text-accent-danger/dim-2 token 化；router.admin 白名单+集合+2 mock+标题同步（spec §8）"
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
4. 风格库卡片宽度不塌宽（D21）、Esc 两段式（先详情后库，D20）、点收藏/详情不误触使用、hover 使用钮「使用」文字展开可见（第九轮 P3-2：删 max-w-6 是功能性修复——容器曾卡 24px+overflow-hidden 裁掉 hover 文字，spec §4.3 该项此前实际不可见）；
5. 使用风格后工具行圆图+风格名（刷新后仍在）；生成日志验证 prompt 含面板文本+风格文本（D12 接通）与视频不传对象（D28）；**负路径**：满 9 张时点击目标节点仅横幅提示、allImages 不写入；presign 失败（可断网模拟）该次点击静默忽略、不写入半成品条目；
6. admin 录入→前台即时可见；删除有收藏的风格成功（Cascade）；分类删除保护文案。

- [ ] **Step 18.6: 验收问题修复后终跑 + 最终 Commit（如有修复）**

```bash
pnpm test && pnpm lint
```

（cwd=apps/web）`node scripts/css-audit.mjs --slash-gate`——与 Step 18.3 同 cwd 同写法，勿混用仓根相对路径。

---

## 执行中停机回报条件（遇此情况停下报告用户，勿自行改设计）

1. `prisma migrate dev` 因权限/基线报错（migrate 基线已重置过——按 flowweb_db_migration_env 记忆处理，勿 db push）；
2. Prisma join 表分页（Task 9 favorites/recent）在真实类型下需要偏离已定稿语义（createdAt/lastUsedAt desc + join 行 id desc）时停机——语法级适配（如 select 换 include）可自行调整并同步测试；
3. no-theme-utility 实际 grep 出的白名单命中族与 Step 15.8 声明的 allow 列表不一致——按实测族增删 allow 并镜像 registry（语义不变），但若 StyleLibraryModal.tsx 本体出现命中（应为零）则停机（实现偏离 token 化）。

## 自审记录（writing-plans Self-Review，v2 审核修订后）

1. **Spec 覆盖**：§3.1→T2/T5/T7（含 useGroupKeyboard gate Step 7.3）；§3.2→T6；§3.3→T1/T7；§3.4→T4/T5；§4.1→T3/T5/T15；§4.2→T14/T15；§4.3→T15(StyleCard，含使用钮 hover 展开文字)；§4.4→T14/T15；§4.5→T16（TTL 缓存——spec §4.5 同步更正）；§4.6→T15(白名单 2 条挂 StyleCard/StyleDetailPreview+镜像)；§5→T8（user 侧 Cascade 补）；§6.1→T9/T13（use 返回扁平——spec §6.1 同步更正）；§6.2→T10/T17；§7.1/§7.2→T11；§7.3→T12；§8→T17（含分类页测试）；§9.1 命令→T18；§9.2 既有改造→T3/T4/T5/T11/T17 分任务内联；§9.3 新增→各任务；§11→T18。无遗漏。
2. **占位符**：全部步骤含完整代码或精确既有代码保留指示；v1 的 6 处「执行时按实际改」已回填确定答案（T9 join 表排序/T11 execute 签名与基线/T12 用例位置/T13 query 顺序/T16 缓存方案/T15 白名单文件），仅保留 2 处语法级适配注（join 分页 select/include 形态、antd 测试模式抄既有）。
3. **类型一致性**：`referenceSelect: { sourceNodeId; notice }`（T2 定义，T5/T6/T7 消费一致）；`styleLibrary: { nodeId }`（T3 定义，T5/T15 一致）；`styleId?: string | null` 类型 T2 前移（T14 无强转、T16 直接消费）；`StyleSummary/StyleListResult/StyleCategoryItem`（T13 定义，T14/T15/T16 一致）；后端 `StyleListItem` 与前端 `StyleSummary` 同名同型，use 三方（测试/实现/前端）统一扁平口径；`getStyleThumb/styleThumbCacheMap`（T16 测试与实现一致）。
4. **执行顺序**：T1→T2→T3（A 组 store 链）→T4（含 ImageThumbnailBar 传 index）→T5→T6→T7；B 组 T8→T9→T10→T11/T12→T13→T14→T15→T16→T17→T18。A/B 交叉仅 T15 依赖 T3。
5. **第六轮审核落实清单**：B1→T16 TTL 方案；B2→T9 mock 补键；B3→T9 join 表分页（含断言）；B4→T3 断言 4 次；B5→T11 签名+基线 beforeEach；B6→T15 白名单挂 StyleCard/DetailPreview；H1→T15 内外层拆分；H3→use 扁平口径（spec 同步）；H4→T13 断言按实现顺序；H5→checkbox accentColor currentColor；M1→T8 user 侧 Cascade（依据修正：全部 User 关系 13 条中 11 条 Cascade，例外仅 Team.owner Restrict 与 TeamJoinRequest.decidedByUser SetNull 且语义正当——join 表无例外，我们的纯属主行加 Cascade 与先例一致）；M2→T17 分类页测试；M3/P9→T5 按钮 disabled；M4→T7 deps/分支位置；M5→T12 位置注明；M6→T4 transform toContain；M7→T4 同 commit 传 index；P4→T4 包裹层保 baseline；P6→bg-gradient-to；P7→chip「全部分类」；P10→Step 7.3 useGroupKeyboard；P11→T6 getNode；P12→T6 selectNode 注释；P16→T10 P2002/P2003 catch；P17→favorite typeof 校验+删 FavoriteDto；P2-1→onUsed 清 detail；P2-2→StatusOverlay 删孤立 prop；P2-6→筛选跳首次；P2-4→text-accent-danger/dim-2；P20/P21→命令统一去 head、css-audit 同 cwd；P22→使用钮 hover 展开。
6. **第七轮审核落实清单**：P1-1→T4 baseline 认清缩进参与哈希（「恰好 1 条 + UPDATE_BASELINE」表述在第八轮 A1/B1 再修正为判定式 + 手工伴随重键，见第八轮清单——UPDATE_BASELINE 引 lint-gate.mjs:139 属反向引用）；P1-2→T5 补改用例 #11（+ #8 标题）；P1-3→T15 白名单 StyleCard 加 ring（10 族非 9 族，整串⊆allow 才放行）+registry 镜像；P1-4→T16 负缓存 has() 优先（404 墓碑）；P1-5→T9 recent 按真实收藏集算 favorited（+mock 补值+断言钉死）；P1-6→T9 styleFilter 折入 relation filter（搜索/商用三 tab 生效）+T14 setTab 清 commercialOnly；P2-1→updateCategory P2002 catch；P2-2→T17 测试包 AntdApp；P3-1→T1 复用 isImageNode（nodeStore:201-205，删重复 Set）；P3-2→spike 补横向裁切确认；P3-4→deleteStyle minio.delete 加 catch；P3-5→creditCost 基线对齐 5；P3-6→onUsed useCallback（第八轮 A2 升级为直传回调签名，见第八轮清单）；P3-8→T15 删 max-w-6/max-w-35（第八轮 A3 更正理由：Tailwind 3.4 maxWidth 已含 spacing 档——config.full.js:653 `...theme('spacing')`，max-w-6 能生成；max-w-35 默认刻度无 35 档零输出；**第九轮 P3-2 再升级定性：max-w-6=24px 容器上限+overflow-hidden 曾实际裁掉 hover 展开文字——删除是视觉 bug 修复非冗余清理，验收 T18.5-4 已补**）；T4 onDelete 一并删孤立；T7 Files/git add 补 useGroupKeyboard.ts。M1 数字修正为 13/11。
7. **第八轮审核落实清单**（3 份合并，逐条核实后采纳）：A1/B1/P2-1→T4 Step 4.4 改**判定式流程 + 手工伴随重键**（lint-gate.mjs:139 note 只允许机械清理伴随重键、明文排除 UPDATE_BASELINE 全量重采——v3 把它说成「合法通道」引用反了；pwsh 语法问题随弃用该通道一并消失；「缩进 6→8」诊断更正为「行首多 `<div ` 前缀、正常排版缩进随之加深」，0/1 条均合法、≥2 条才回查）；A2/A3(pass1)/P3-1(pass2)/A3(pass3)→useStyleLibrary 签名收成 `onUsed?: () => void` 直传（deps `[nodeId, onUsed]`）——对象字面量每渲染新建会使 memo(StyleCard) 恒失效，原 P3-6 修复未达目标；A1/A1b(pass3)/A5(pass1)/P2-2(pass2)→T17.6 测试包 `<MemoryRouter><AntdApp>` 双层（9/9 既有 admin 页先例）+ Popconfirm 确认钮用类名选择器 `.ant-popover .ant-btn-primary`（无 zhCN locale，okText='OK'，AnnouncementPage.test.tsx:49/:61 先例）；A2(pass3)→T3 新增 Step 3.5：page.test nodeStore mock getState 补 `referenceSelect: null + exitReferenceSelect: vi.fn()`（Tab 用例走真 menuStore.open 的跨 store 调用，缺方法必 TypeError——v3「天然不回归」结论写反，T7 回归面同步改口）；B2→T9 `where` 改 spread（styleFilter 共享对象禁就地改写）；C1→T7 Step 7.3 useGroupKeyboard.test 改 vi.hoisted 可变 mock + referenceSelect 用例（防误撤销闸门零覆盖）；C2→spec §3.1 登记视频发起节点在范围（D6）；C3→`MAX_REFERENCE_IMAGES = 9` 常量进 types.ts 三处共用（工具行默认/拾取守卫/横幅文案）；E1→使用钮删死过渡 `transition-[max-width]`（max-width 变化在内层 span，其自带 transition）；E2→T10 注释「并发改名」更正「并发创建」；E3→T9 用例名更正（只跑 favorites）；P3-2(pass2)→空态文案 searchInput 非空时统一「未找到匹配风格」（收藏/最近 tab 搜索无结果不再误显「暂无收藏」）；D25 兜底→spec §3.3 备注（onNodeClick 若实测不派发，拾取后补 selectNode，不放弃甲方案）。
8. **第九轮审核落实清单**（3 份合并；无 P1/P2，文字订正 + 定性升级）：① Step 4.3 注释与 Step 4.6 commit 标题残留「缩进+2」旧诊断→统一改「行首多 `<div ` 前缀（缩进不变）」；② Step 5.4 补第 1 条编辑项：`import { MAX_REFERENCE_IMAGES } from './types';` 值导入**另起一行**（:18 现为 `import type`，混入值导入编译错）+默认参数改常量；③ C3「单一真源」口径收窄→「本功能新增三处共用常量」；既有硬编码 9 仅 PromptEditor.tsx:24 一处（审核称两处有误：useImageUpload 为参数化、PromptInput 无上限判断，实读核实），登记已知不一致不动；④ spec §3.2「2s 还原」→「约 2s（实现 2200ms）」；⑤ P3-2 定性升级：删 max-w-6 是**视觉 bug 修复**（24px 容器上限+overflow-hidden 曾裁掉 hover 展开文字，spec §4.3「使用钮 hover 展开文字」此前实际不可见）——T18.5-4 补验收「hover 使用钮文字展开可见」；⑥ D25 兜底降级为纯记录：第九轮实读 @xyflow/react dist（handleNodeClick 用户回调分支在 isSelectable 判块之外 :2156-2169、pointer-events 由 onNodeClick 存在性保住 :2140/:2282）——onNodeClick **不受 elementsSelectable 门控**，甲方案源码级成立（spec §3.3 备注已补证据）；⑦ 审核方自纠两条更正（max-w-6 可生成/缩进未变）与本计划 v4 口径一致，无需动作。

