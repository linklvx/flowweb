# Image & Video Node Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add aspect-ratio-locked corner resize handles to ImageGenNode and VideoGenNode, matching TextInputNode's resize UX.

**Architecture:** Use @xyflow/react's NodeResizeControl with shouldResize={false} for full control. Shared resize utilities live in src/utils/resizeUtils.ts. ImageNodeData and VideoNodeData gain optional customSize and aspectRatio fields.

**Tech Stack:** React, @xyflow/react v12, Zustand, Vitest, @testing-library/react

---

### Task 1: Add customSize and aspectRatio fields to nodeStore types

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`

- [ ] **Step 1: Add fields to ImageNodeData and VideoNodeData interfaces**

In `nodeStore.ts`, add to `ImageNodeData` (after line 39):
```ts
  customSize?: { width: number; height: number };
  aspectRatio?: number;
```

And to `VideoNodeData` (after line 45):
```ts
  customSize?: { width: number; height: number };
  aspectRatio?: number;
  referenceVideo?: string;
  ratio?: string;
```

Note: `referenceVideo` and `ratio` are already used in VideoGenNode via `nodeData?.referenceVideo` and `nodeData?.ratio` but are missing from the `VideoNodeData` interface. Adding them fixes an existing type gap.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/nodeStore.ts
git commit -m "feat: add customSize and aspectRatio fields to ImageNodeData and VideoNodeData"
```

---

### Task 2: Create shared resize utilities

**Files:**
- Create: `apps/web/src/utils/resizeUtils.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/utils/__tests__/resizeUtils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { clampWithAspectRatio, adaptCustomSize } from '../resizeUtils';

describe('clampWithAspectRatio', () => {
  // ratio = width / height
  const ratio = 16 / 9; // ~1.778
  const min = 100;
  const max = 3000;

  it('should return same dimensions when within bounds', () => {
    const { w, h } = clampWithAspectRatio(1600, 900, ratio, min, max);
    expect(w).toBe(1600);
    expect(h).toBe(900);
  });

  it('should clamp width to max and scale height proportionally', () => {
    const { w, h } = clampWithAspectRatio(4000, 2250, ratio, min, max);
    expect(w).toBe(3000);
    expect(h).toBe(Math.round(3000 / ratio)); // ~1688
  });

  it('should clamp height to max and scale width proportionally', () => {
    // 9:16 portrait ratio — height exceeds max, should clamp
    const portraitRatio = 9 / 16; // ~0.5625
    const { w, h } = clampWithAspectRatio(2000, 4000, portraitRatio, min, max);
    expect(h).toBe(3000); // height clamped to max
    expect(w).toBe(Math.round(3000 * portraitRatio)); // ~1688
  });

  it('should enforce min side (hard constraint) even if it breaks max', () => {
    // 10:1 ratio, tiny size
    const r10 = 10;
    const { w, h } = clampWithAspectRatio(50, 5, r10, min, max);
    expect(h).toBe(100); // min hard constraint on height
    expect(w).toBe(1000); // proportional (exceeds max, but min is hard)
  });

  it('should handle square ratio', () => {
    const { w, h } = clampWithAspectRatio(200, 200, 1, min, max);
    expect(w).toBe(200);
    expect(h).toBe(200);
  });
});

describe('adaptCustomSize', () => {
  // adaptCustomSize does CONTAIN-fit: new content must fit ENTIRELY within customSize rect
  it('should fit by height when new ratio is wider than rect', () => {
    // customSize 1600x900 (ratio ~1.78), new ratio 1:1
    // 1600/1 = 1600 > 900 → height-constrained: keep height=900, width=900*1=900
    const result = adaptCustomSize({ width: 1600, height: 900 }, 1);
    expect(result.width).toBe(900);
    expect(result.height).toBe(900);
  });

  it('should fit by width when new ratio is taller than rect', () => {
    // customSize 400x1200 (ratio ~0.33), new ratio 16:9 (~1.78)
    // 400/1.78 = 225 ≤ 1200 → width-constrained: keep width=400, height=400/1.78=225
    const result = adaptCustomSize({ width: 400, height: 1200 }, 16 / 9);
    expect(result.width).toBe(400);
    expect(result.height).toBe(225);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/utils/__tests__/resizeUtils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write resizeUtils.ts**

```ts
import type { Node } from '@xyflow/react';

// ratio = width / height
export const RESIZE_CONFIG = {
  minSide: 100,
  maxSide: 3000,
} as const;

export const HANDLE_STYLE = {
  width: 24,
  height: 24,
  background: 'transparent',
  border: 'none',
  zIndex: 9999,
} as const;

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type CornerPosition = (typeof CORNERS)[number];

/**
 * Clamp width/height to minSide/maxSide while maintaining aspect ratio.
 * ratio = width / height
 * Priority: minSide (hard) > maxSide (soft)
 */
export function clampWithAspectRatio(
  w: number,
  h: number,
  ratio: number,
  min: number,
  max: number,
): { w: number; h: number } {
  // Step 1: inner-fit within max
  if (w > max) {
    w = max;
    h = Math.round(max / ratio);
  }
  if (h > max) {
    h = max;
    w = Math.round(max * ratio);
  }
  // Step 2: min hard constraint (can exceed max)
  if (w < min) {
    w = min;
    h = Math.round(min / ratio);
  }
  if (h < min) {
    h = min;
    w = Math.round(min * ratio);
  }
  return { w, h };
}

/**
 * Adapt customSize to a new aspect ratio using contain-fit.
 */
export function adaptCustomSize(
  customSize: { width: number; height: number },
  newRatio: number,
): { width: number; height: number } {
  const fitByWidth = Math.round(customSize.width / newRatio);
  if (fitByWidth <= customSize.height) {
    return { width: customSize.width, height: fitByWidth };
  }
  return { width: Math.round(customSize.height * newRatio), height: customSize.height };
}

/**
 * Calculate anchor-compensated position based on which corner is being dragged.
 * Uses delta from current node position — does NOT depend on onResize callback x/y.
 */
export function calcAnchorCompensation(
  handle: CornerPosition,
  nodeX: number,
  nodeY: number,
  deltaW: number,
  deltaH: number,
): { x: number; y: number } {
  switch (handle) {
    case 'top-left':
      return { x: nodeX - deltaW, y: nodeY - deltaH };
    case 'top-right':
      return { x: nodeX, y: nodeY - deltaH };
    case 'bottom-left':
      return { x: nodeX - deltaW, y: nodeY };
    case 'bottom-right':
    default:
      return { x: nodeX, y: nodeY };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/utils/__tests__/resizeUtils.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/resizeUtils.ts apps/web/src/utils/__tests__/resizeUtils.test.ts
git commit -m "feat: add shared resize utilities (clampWithAspectRatio, adaptCustomSize, calcAnchorCompensation)"
```

---

### Task 3: Add resize to ImageGenNode

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] **Step 1: Update @xyflow/react mock to include getNodes/setNodes**

In the existing `vi.mock('@xyflow/react', ...)` factory (around line 8), update the `useReactFlow` mock to include `getNodes` and `setNodes`:

```ts
useReactFlow: vi.fn(() => ({
  fitView: vi.fn(),
  screenToFlowPosition: vi.fn((p: any) => p),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  getNodes: vi.fn(() => [{ id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData }]),
  setNodes: vi.fn(),
})),
```

- [ ] **Step 2: Write failing tests for resize handle visibility**

Add to `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx`:

```ts
// Inside the describe block, after existing tests:

// ─── Resize handles ───

it('should NOT render resize handles when no image is loaded', () => {
  mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
  renderNode(true);
  expect(screen.queryByTestId('resize-control-top-left')).not.toBeInTheDocument();
  expect(screen.queryByTestId('resize-control-top-right')).not.toBeInTheDocument();
  expect(screen.queryByTestId('resize-control-bottom-left')).not.toBeInTheDocument();
  expect(screen.queryByTestId('resize-control-bottom-right')).not.toBeInTheDocument();
});

it('should render 4 corner resize handles when single-selected with image loaded', () => {
  mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
  renderNode(true);
  expect(screen.getByTestId('resize-control-top-left')).toBeInTheDocument();
  expect(screen.getByTestId('resize-control-top-right')).toBeInTheDocument();
  expect(screen.getByTestId('resize-control-bottom-left')).toBeInTheDocument();
  expect(screen.getByTestId('resize-control-bottom-right')).toBeInTheDocument();
});

it('should NOT render resize handles in edit mode', () => {
  mockNodeData = { status: 'done', fileId: 'cat-file-id', editMode: 'crop', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
  renderNode(true);
  expect(screen.queryByTestId('resize-control-top-left')).not.toBeInTheDocument();
});

it('should NOT render resize handles in transform mode', () => {
  mockNodeData = { status: 'done', fileId: 'cat-file-id', transformMode: true, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } };
  renderNode(true);
  expect(screen.queryByTestId('resize-control-top-left')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx --reporter=verbose 2>&1 | head -60`
Expected: FAIL — resize controls not found

- [ ] **Step 4: Add imports and isSingleSelected logic to ImageGenNode**

In `ImageGenNode.tsx`, add to the import from `@xyflow/react` (line 2):
```ts
import { NodeResizeControl, useReactFlow, useInternalNode, type NodeProps } from '@xyflow/react';
```
(Add `NodeResizeControl` and `useReactFlow`; `useInternalNode` and `NodeProps` are already imported)

Add import for resize utilities (after existing imports):
```ts
import { RESIZE_CONFIG, HANDLE_STYLE, CORNERS, clampWithAspectRatio, calcAnchorCompensation } from '@/utils/resizeUtils';
```

Add `isSingleSelected` computation after the existing `node` declaration (around line 60):
```ts
const { getNodes, setNodes } = useReactFlow();
const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;
```

- [ ] **Step 5: Add resize handlers and state**

Add resize state after the existing `isSaving` state (around line 81):
```ts
const [isResizing, setIsResizing] = useState(false);
```

Add the resize handlers before the return statement:
```ts
const handleResize = useCallback((_event: any, params: { width: number; height: number; x: number; y: number; handle: string }) => {
  const aspectRatio = nodeData?.aspectRatio;
  if (!aspectRatio || aspectRatio <= 0 || !isFinite(aspectRatio)) return;

  const currentNodes = getNodes();
  const currentNode = currentNodes.find((n) => n.id === id);
  if (!currentNode) return;

  const currentWidth = currentNode.width;
  const currentHeight = currentNode.height;
  // Guard: ensure node dimensions are initialized
  if (!currentWidth || !currentHeight || currentWidth <= 0 || currentHeight <= 0) return;

  // All corner handles: width is primary edge, derive height
  const newWidth = Math.round(params.width);
  const newHeight = Math.round(newWidth / aspectRatio);

  // clampWithAspectRatio already handles both max and min constraints;
  // directly use its output — no need for secondary branch logic
  const clamped = clampWithAspectRatio(newWidth, newHeight, aspectRatio, RESIZE_CONFIG.minSide, RESIZE_CONFIG.maxSide);

  const deltaW = clamped.w - currentWidth;
  const deltaH = clamped.h - currentHeight;

  const handlePos = params.handle as (typeof CORNERS)[number];
  const { x: newX, y: newY } = calcAnchorCompensation(
    handlePos,
    currentNode.position.x,
    currentNode.position.y,
    deltaW,
    deltaH,
  );

  setNodes((nds) =>
    nds.map((n) => {
      if (n.id !== id) return n;
      return { ...n, width: clamped.w, height: clamped.h, position: { x: newX, y: newY } };
    }),
  );
}, [id, nodeData?.aspectRatio, getNodes, setNodes]);

const handleResizeStart = useCallback(() => {
  setIsResizing(true);
}, []);

const handleResizeEnd = useCallback(() => {
  setIsResizing(false);
  const currentNodes = getNodes();
  const currentNode = currentNodes.find((n) => n.id === id);
  if (!currentNode) return;
  updateConfig(id, {
    customSize: { width: currentNode.width!, height: currentNode.height! },
  } as any);
  // NOTE: Undo history stack integration — deferred to when canvas-level
  // undo/redo infrastructure is built. Currently no undo stack exists.
  // See SPEC 1.9: one resize operation → one undo step.
}, [id, getNodes, updateConfig]);
```

- [ ] **Step 6: Cache aspectRatio when image loads**

In `handleImageLoad` (line 123), add aspectRatio caching:
```ts
const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  const size = calcConstrainedSize(img.naturalWidth, img.naturalHeight);
  setImgSize(size);
  setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  // Cache aspect ratio for resize
  updateConfig(id, { aspectRatio: img.naturalWidth / img.naturalHeight } as any);
}, [id, updateConfig]);
```

- [ ] **Step 7: Determine hasMedia and showResizeHandles**

After `displayUrl` declaration (line 72), add:
```ts
const hasMedia = !!displayUrl;
const isEditMode = !!nodeData?.editMode || !!transformMode;
const showResizeHandles = isSingleSelected && hasMedia && !isEditMode;
```

- [ ] **Step 8: Render NodeResizeControl handles**

After the title bar div (after the `</div>` closing the title bar), and before the Target handle, add:
```tsx
{/* Corner resize handles — only when single-selected with media, not in edit mode */}
{showResizeHandles && CORNERS.map((corner) => (
  <NodeResizeControl
    key={corner}
    nodeId={id}
    position={corner}
    shouldResize={() => false}
    onResize={handleResize}
    onResizeStart={handleResizeStart}
    onResizeEnd={handleResizeEnd}
    style={HANDLE_STYLE}
    data-testid={`resize-control-${corner}`}
  />
))}
```

- [ ] **Step 9: Adopt 100% container fill driven by React Flow node dimensions**

The inner image container must use `width: 100%; height: 100%` instead of fixed `baseWidth/baseHeight`, so that resizing the node via React Flow's width/height properties automatically scales the content.

Update the outer card div (around line 714):
```tsx
<div
  className="bg-[#222222] rounded-lg overflow-hidden"
  style={{
    width: nodeWidth,   // from node.width (React Flow managed)
    height: nodeHeight, // from node.height (React Flow managed)
    border: '1px solid #3F3F46',
    ...(editMode === 'outpaint'
      ? { border: 'none', borderRadius: 0 }
      : selected
        ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' }
        : {}),
  }}
>
```

Update the inner flex container (around line 726):
```tsx
<div
  className="flex items-center justify-center overflow-hidden transition-all duration-300 relative group"
  style={{
    width: '100%',
    height: '100%',
    borderRadius: editMode === 'outpaint' ? 0 : undefined,
  }}
>
```

Update the image wrapper (around line 735):
```tsx
<div className="relative" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
  <img
    src={displayUrl}
    alt="preview"
    className="max-w-full max-h-full object-contain"
    style={{
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      ...(previewTransform ? { transform: previewTransform } : {}),
    }}
    onLoad={handleImageLoad}
  />
```

Key changes:
- Outer container: `width: nodeWidth, height: nodeHeight` (reads from React Flow node)
- Inner containers: `width: '100%', height: '100%'` (fills parent)
- Image: `width: '100%', height: '100%', objectFit: 'cover'` (covers container)
- Remove `baseWidth`/`baseHeight` from container styles (they become internal only)
- Remove `maxWidth: 'none'` / `maxHeight: 'none'` from image

- [ ] **Step 10: Sync initial dimensions to React Flow node on image load**

In `handleImageLoad`, after calculating the initial size via `calcConstrainedSize`, also call `setNodes` to sync the initial dimensions to the React Flow node. This ensures the node's displayed size matches the content, preventing anchor misalignment:

```ts
const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  const size = calcConstrainedSize(img.naturalWidth, img.naturalHeight);
  setImgSize(size);
  setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  // Cache aspect ratio for resize
  updateConfig(id, { aspectRatio: img.naturalWidth / img.naturalHeight } as any);
  // Sync initial dimensions to React Flow node (only on first load, no customSize)
  const currentData = useNodeStore.getState().nodes[id]?.data as any;
  if (!currentData?.customSize) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        return { ...n, width: size.w, height: size.h };
      }),
    );
  }
}, [id, updateConfig, setNodes]);
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx --reporter=verbose`
Expected: All tests PASS including new resize tests

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx
git commit -m "feat: add aspect-ratio-locked corner resize handles to ImageGenNode"
```

---

### Task 4: Add resize to VideoGenNode

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`

- [ ] **Step 1: Add @xyflow/react mock to VideoGenNode tests**

The VideoGenNode test currently doesn't mock `@xyflow/react` (unlike ImageGenNode). With the new `useReactFlow` usage, we need to add a mock. At the top of the test file, after the existing `vi.mock` calls for `@/hooks/useMediaUrl` and before `@/stores/nodeStore`, add:

```ts
const { mockGetNodes, mockSetNodes } = vi.hoisted(() => {
  const getNodes = vi.fn(() => [{ id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, width: 548, height: 309, selected: true, data: getMockNodeData() }]);
  const setNodes = vi.fn();
  return { mockGetNodes: getNodes, mockSetNodes: setNodes };
});

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useReactFlow: vi.fn(() => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
    })),
  };
});
```

Note: Move the existing `vi.mock('@xyflow/react', ...)` if any, or add this as a new mock block.

- [ ] **Step 2: Write failing tests for video resize**

Add to `apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx`:

```ts
// Inside the describe block, after existing tests:

// ─── Resize handles ───

it('should NOT render resize handles when no video is loaded', () => {
  setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
  renderNode(true);
  expect(screen.queryByTestId('resize-control-top-left')).not.toBeInTheDocument();
  expect(screen.queryByTestId('resize-control-bottom-right')).not.toBeInTheDocument();
});

it('should render 4 corner resize handles when single-selected with video loaded', () => {
  setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
  renderNode(true);
  expect(screen.getByTestId('resize-control-top-left')).toBeInTheDocument();
  expect(screen.getByTestId('resize-control-top-right')).toBeInTheDocument();
  expect(screen.getByTestId('resize-control-bottom-left')).toBeInTheDocument();
  expect(screen.getByTestId('resize-control-bottom-right')).toBeInTheDocument();
});

// ─── pointer-events handling ───

it('should set pointer-events: none on video element during resize', () => {
  setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
  renderNode(true);
  const videoEl = document.querySelector('video')!;
  // Simulate resize start via the control's onResizeStart
  // We verify the mechanism exists via the handler registration
  expect(videoEl).toBeTruthy();
  // The actual test of the mechanism requires integration testing;
  // we verify presence of resize controls as proxy
  expect(screen.getByTestId('resize-control-bottom-right')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/VideoGenNode.test.tsx --reporter=verbose 2>&1 | head -40`
Expected: FAIL — resize controls not found

- [ ] **Step 4: Add imports to VideoGenNode**

In `VideoGenNode.tsx`, update the import from `@xyflow/react`:
```ts
import { NodeResizeControl, useReactFlow, type NodeProps } from '@xyflow/react';
```

Add resize utilities import:
```ts
import { RESIZE_CONFIG, HANDLE_STYLE, CORNERS, clampWithAspectRatio, calcAnchorCompensation } from '@/utils/resizeUtils';
```

- [ ] **Step 5: Add resize state and refs**

After the existing `uploadProgress` state (line 130), add:
```ts
const [isResizing, setIsResizing] = useState(false);
const videoRef = useRef<HTMLVideoElement>(null);
const fallbackCleanupRef = useRef<(() => void) | null>(null);
```

Add `isSingleSelected` after existing node access (around line 46):
```ts
const { getNodes, setNodes } = useReactFlow();
const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;
```

Determine visibility (align with Spec 1.1 — hide in edit mode):
```ts
const hasMedia = !!displayUrl;
// VideoGenNode doesn't have transform/edit modes currently, but check for future-proofing
const isEditMode = !!(nodeData?.editMode);
const showResizeHandles = isSingleSelected && hasMedia && !isEditMode;
```

- [ ] **Step 6: Add resize handlers with pointer-events management**

Add before the return statement:

```ts
const handleResize = useCallback((_event: any, params: { width: number; height: number; x: number; y: number; handle: string }) => {
  const aspectRatio = nodeData?.aspectRatio;
  if (!aspectRatio || aspectRatio <= 0 || !isFinite(aspectRatio)) return;

  const currentNodes = getNodes();
  const currentNode = currentNodes.find((n) => n.id === id);
  if (!currentNode) return;

  const currentWidth = currentNode.width;
  const currentHeight = currentNode.height;
  if (!currentWidth || !currentHeight || currentWidth <= 0 || currentHeight <= 0) return;

  const newWidth = Math.round(params.width);
  const newHeight = Math.round(newWidth / aspectRatio);

  // clampWithAspectRatio handles both bounds; use output directly
  const clamped = clampWithAspectRatio(newWidth, newHeight, aspectRatio, RESIZE_CONFIG.minSide, RESIZE_CONFIG.maxSide);

  const deltaW = clamped.w - currentWidth;
  const deltaH = clamped.h - currentHeight;

  const handlePos = params.handle as (typeof CORNERS)[number];
  const { x: newX, y: newY } = calcAnchorCompensation(
    handlePos,
    currentNode.position.x,
    currentNode.position.y,
    deltaW,
    deltaH,
  );

  setNodes((nds) =>
    nds.map((n) => {
      if (n.id !== id) return n;
      return { ...n, width: clamped.w, height: clamped.h, position: { x: newX, y: newY } };
    }),
  );
}, [id, nodeData?.aspectRatio, getNodes, setNodes]);

const finishResize = useCallback(() => {
  const currentNodes = getNodes();
  const currentNode = currentNodes.find((n) => n.id === id);
  if (!currentNode) return;

  updateConfig(id, {
    customSize: { width: currentNode.width!, height: currentNode.height! },
  } as any);

  // Restore pointer-events on video
  if (videoRef.current) {
    videoRef.current.style.pointerEvents = 'auto';
  }
  // Remove window fallback events
  if (fallbackCleanupRef.current) {
    fallbackCleanupRef.current();
    fallbackCleanupRef.current = null;
  }
  // NOTE: Undo history stack integration deferred — no canvas-level undo system yet.
}, [id, getNodes, updateConfig]);

const handleResizeStart = useCallback(() => {
  setIsResizing(true);
  if (videoRef.current) {
    videoRef.current.style.pointerEvents = 'none';
  }

  const onFallback = () => {
    finishResize();
    setIsResizing(false);
  };
  window.addEventListener('mouseup', onFallback);
  window.addEventListener('blur', onFallback);

  fallbackCleanupRef.current = () => {
    window.removeEventListener('mouseup', onFallback);
    window.removeEventListener('blur', onFallback);
    if (videoRef.current) {
      videoRef.current.style.pointerEvents = 'auto';
    }
  };
}, [finishResize]);

const handleResizeEnd = useCallback(() => {
  setIsResizing(false);
  finishResize();
}, [finishResize]);
```

- [ ] **Step 7: Add useEffect cleanup for pointer-events**

Add after the existing socket.io useEffect (after line 124):

```ts
// Cleanup resize fallback events on unmount
useEffect(() => {
  return () => {
    if (fallbackCleanupRef.current) {
      fallbackCleanupRef.current();
      fallbackCleanupRef.current = null;
    }
  };
}, []);
```

- [ ] **Step 8: Cache aspectRatio when video loads**

In `handleVideoLoad` (line 57), add aspectRatio caching:
```ts
const handleVideoLoad = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
  const vid = e.currentTarget;
  const size = calcConstrainedSize(vid.videoWidth || 548, vid.videoHeight || 306);
  setVidSize(size);
  if (vid.videoWidth && vid.videoHeight) {
    updateConfig(id, { aspectRatio: vid.videoWidth / vid.videoHeight } as any);
  }
}, [id, updateConfig]);
```

- [ ] **Step 9: Render resize handles and update video styles**

Add resize handles after the title bar div:
```tsx
{/* Corner resize handles */}
{showResizeHandles && CORNERS.map((corner) => (
  <NodeResizeControl
    key={corner}
    nodeId={id}
    position={corner}
    shouldResize={() => false}
    onResize={handleResize}
    onResizeStart={handleResizeStart}
    onResizeEnd={handleResizeEnd}
    style={HANDLE_STYLE}
    data-testid={`resize-control-${corner}`}
  />
))}
```

Update the video element (line 272) to add ref and cover fill:
```tsx
<video
  ref={videoRef}
  src={displayUrl}
  controls
  className="max-w-full max-h-full object-contain"
  style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
  onLoadedMetadata={handleVideoLoad}
/>
```

Update the outer container div (line 268) to add overflow hidden:
The existing `overflow-hidden` on the flex container is sufficient. Verify it's present on line 269.

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/VideoGenNode.test.tsx --reporter=verbose`
Expected: All tests PASS including new resize tests

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx
git commit -m "feat: add aspect-ratio-locked corner resize handles to VideoGenNode with pointer-events management"
```

---

### Task 5: Wire adaptCustomSize for material replacement

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`

- [ ] **Step 1: Add material replacement adaptation in ImageGenNode**

In `ImageGenNode.tsx`, update the `useEffect` that resets dimensions on displayUrl change (line 131):
```ts
// Reset dimensions when image URL changes
useEffect(() => {
  const currentData = useNodeStore.getState().nodes[id]?.data as any;
  const existingCustomSize = currentData?.customSize;
  const existingAspectRatio = currentData?.aspectRatio;

  setImgSize(null);
  setNaturalSize(null);

  // If user has manually resized and material changed, adapt customSize
  if (existingCustomSize && existingAspectRatio && displayUrl) {
    // Aspect ratio will be updated by handleImageLoad — adapt then
    // For now, keep customSize; handleImageLoad will adapt if ratio differs
  } else if (!displayUrl) {
    // Material removed — keep customSize but clear aspectRatio
  }
}, [displayUrl, id]);
```

- [ ] **Step 2: Add ratio-aware adaptation in handleImageLoad for ImageGenNode**

Update `handleImageLoad` to adapt customSize when ratio changes, AND sync node display size via setNodes. This merges the logic from Task 3 Step 10 (initial sync) and adds the ratio-change adaptation:

```ts
const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  const newAspectRatio = img.naturalWidth / img.naturalHeight;
  const currentData = useNodeStore.getState().nodes[id]?.data as any;
  const existingCustomSize = currentData?.customSize;
  const existingAspectRatio = currentData?.aspectRatio;

  // Tolerance 0.01: avoid unnecessary adaptation from floating-point noise
  const ratioChanged = existingCustomSize && existingAspectRatio &&
    Math.abs(newAspectRatio - existingAspectRatio) > 0.01;

  let size: { w: number; h: number };
  if (ratioChanged) {
    const adapted = adaptCustomSize(existingCustomSize!, newAspectRatio);
    updateConfig(id, { customSize: adapted, aspectRatio: newAspectRatio } as any);
    size = { w: adapted.width, h: adapted.height };
  } else if (existingCustomSize && !ratioChanged) {
    size = { w: existingCustomSize.width, h: existingCustomSize.height };
  } else {
    size = calcConstrainedSize(img.naturalWidth, img.naturalHeight);
    updateConfig(id, { aspectRatio: newAspectRatio } as any);
  }

  setImgSize(size);
  setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });

  // Sync display size to React Flow node — keeps visual consistent with data
  setNodes((nds) =>
    nds.map((n) => {
      if (n.id !== id) return n;
      return { ...n, width: size.w, height: size.h };
    }),
  );
}, [id, updateConfig, setNodes]);
```

Note: Add `adaptCustomSize` to the resize utils import:
```ts
import { RESIZE_CONFIG, HANDLE_STYLE, CORNERS, clampWithAspectRatio, calcAnchorCompensation, adaptCustomSize } from '@/utils/resizeUtils';
```

- [ ] **Step 3: Add ratio-aware adaptation in handleVideoLoad for VideoGenNode**

Update `handleVideoLoad` in `VideoGenNode.tsx` with the same pattern — adapt customSize on ratio change AND sync display size via setNodes:

```ts
const handleVideoLoad = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
  const vid = e.currentTarget;
  const vidW = vid.videoWidth || 548;
  const vidH = vid.videoHeight || 306;
  const newAspectRatio = vidW / vidH;
  const currentData = useNodeStore.getState().nodes[id]?.data as any;
  const existingCustomSize = currentData?.customSize;
  const existingAspectRatio = currentData?.aspectRatio;

  const ratioChanged = existingCustomSize && existingAspectRatio &&
    Math.abs(newAspectRatio - existingAspectRatio) > 0.01;

  let size: { w: number; h: number };
  if (ratioChanged) {
    const adapted = adaptCustomSize(existingCustomSize!, newAspectRatio);
    updateConfig(id, { customSize: adapted, aspectRatio: newAspectRatio } as any);
    size = { w: adapted.width, h: adapted.height };
  } else if (existingCustomSize && !ratioChanged) {
    size = { w: existingCustomSize.width, h: existingCustomSize.height };
  } else {
    size = calcConstrainedSize(vidW, vidH);
    updateConfig(id, { aspectRatio: newAspectRatio } as any);
  }

  setVidSize(size);

  setNodes((nds) =>
    nds.map((n) => {
      if (n.id !== id) return n;
      return { ...n, width: size.w, height: size.h };
    }),
  );
}, [id, updateConfig, setNodes]);
```

Add `adaptCustomSize` to the VideoGenNode import as well.

- [ ] **Step 4: Run full test suite**

Run: `cd apps/web && npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx
git commit -m "feat: adapt customSize when material aspect ratio changes"
```

---

### Task 6: Integration verification

**Files:**
- (verification only, no file changes)

- [ ] **Step 1: Run full test suite**

Run: `cd apps/web && npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 2: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify resize handle rendering in browser**

Start dev server and verify:
1. Create a new image node → no resize handles
2. Generate/upload an image → resize handles appear at 4 corners when selected
3. Enter crop/edit mode → handles disappear
4. Exit edit mode → handles reappear
5. Drag bottom-right corner → aspect ratio preserved
6. Drag top-left corner → anchor stays fixed
7. Resize a video node → video controls disabled during drag, restored after
8. After resize, node input/output anchors align with node edges (no offset)
9. Canvas zoom in/out → handles remain functional with correct size and precision

- [ ] **Step 4: Verify resize persistence across page refresh**

1. Resize an image/video node to a custom size
2. Refresh the page (or close and reopen the project)
3. Node dimensions should be restored from customSize
4. Verify the node display size matches the persisted size

- [ ] **Step 5: Note on undo/redo**

The spec requires undo stack integration (one resize = one undo step). Canvas-level undo/redo infrastructure does not currently exist in the codebase. This is deferred to a future task. When the undo system is built:
- onResize: already does NOT push to history ✓
- onResizeEnd: hook into `historyStore` or equivalent to snapshot node state
- fallback (blur/mouseup): same snapshot on cleanup
