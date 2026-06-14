# Edge Flow Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当节点被选中时，相连边显示双向粒子流动动画 + 连线提亮

**Architecture:** 改造现有 `ConnectionLine` 使用 `useStore` + `nodeInternals` O(1) 查询端点选中状态，新建 `EdgeFlowParticles` 组件用 `<animateMotion>` 渲染双向粒子。叠加高亮层通过 `isActive && !isEdgeSelected` 条件控制。

**Tech Stack:** React, @xyflow/react (useStore, nodeInternals), SVG animateMotion, Vitest, @testing-library/react

**Source spec:** `docs/superpowers/specs/2026-06-14-edge-flow-animation-design.md`

---

### Task 1: 创建动画配置常量

**Files:**
- Create: `apps/web/src/pages/canvas/components/edges/edgeParticleConfig.ts`

- [ ] **Step 1: 创建配置文件**

```ts
export const EDGE_PARTICLE_CONFIG = {
  count: 3,
  radius: 3,
  duration: 2000,
  stagger: 667,          // ~2000/3
  directionOffset: 1000,  // 2000/2
  maxConnectedEdges: 20, // reserved: future degradation threshold
} as const;
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd apps/web && npx tsc --noEmit --pretty src/pages/canvas/components/edges/edgeParticleConfig.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/edges/edgeParticleConfig.ts
git commit -m "feat: add edge particle animation config"
```

---

### Task 2: 实现 EdgeFlowParticles 组件（TDD：先写测试）

**Files:**
- Create: `apps/web/src/pages/canvas/components/edges/EdgeFlowParticles.test.tsx`
- Create: `apps/web/src/pages/canvas/components/edges/EdgeFlowParticles.tsx`

- [ ] **Step 1: 写测试**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EdgeFlowParticles } from './EdgeFlowParticles';

describe('EdgeFlowParticles', () => {
  const pathD = 'M 0 0 C 50 0, 50 100, 100 100';

  it('should render correct number of circles for outward direction', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" active={true} />
      </svg>,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelectorAll('animateMotion')).toHaveLength(3);
  });

  it('should render correct number of circles for inward direction', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="inward" active={true} />
      </svg>,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelectorAll('animateMotion')).toHaveLength(3);
  });

  it('should NOT render circles when inactive', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" active={false} />
      </svg>,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('outward particles should NOT have keyPoints attribute', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" active={true} />
      </svg>,
    );
    const motions = container.querySelectorAll('animateMotion');
    motions.forEach((m) => {
      expect(m.getAttribute('keyPoints')).toBeNull();
    });
  });

  it('inward particles SHOULD have keyPoints="1;0" and keyTimes="0;1"', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="inward" active={true} />
      </svg>,
    );
    const motions = container.querySelectorAll('animateMotion');
    motions.forEach((m) => {
      expect(m.getAttribute('keyPoints')).toBe('1;0');
      expect(m.getAttribute('keyTimes')).toBe('0;1');
      expect(m.getAttribute('calcMode')).toBe('linear');
    });
  });

  it('should use CSS variable for fill color', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" active={true} />
      </svg>,
    );
    const circle = container.querySelector('circle')!;
    expect(circle.getAttribute('style')).toContain('var(--edge-flow-color)');
  });

  it('should stagger particle begin times', () => {
    const { container } = render(
      <svg>
        <EdgeFlowParticles pathD={pathD} direction="outward" active={true} />
      </svg>,
    );
    const begins = Array.from(container.querySelectorAll('animateMotion')).map(
      (m) => m.getAttribute('begin'),
    );
    expect(begins).toEqual(['0ms', '667ms', '1334ms']);
  });
});
```

- [ ] **Step 2: 运行测试，验证全部失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/edges/EdgeFlowParticles.test.tsx`
Expected: all tests FAIL (component not yet created)

- [ ] **Step 3: 实现 EdgeFlowParticles 组件**

```tsx
import { memo } from 'react';
import { EDGE_PARTICLE_CONFIG } from './edgeParticleConfig';

interface EdgeFlowParticlesProps {
  pathD: string;
  direction: 'outward' | 'inward';
  active: boolean;
}

export const EdgeFlowParticles = memo(function EdgeFlowParticles({
  pathD,
  direction,
  active,
}: EdgeFlowParticlesProps) {
  if (!active) return null;

  const { count, radius, duration, stagger, directionOffset } = EDGE_PARTICLE_CONFIG;
  const isInward = direction === 'inward';

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          r={radius}
          style={{ fill: 'var(--edge-flow-color)' }}
        >
          <animateMotion
            path={pathD}
            dur={`${duration}ms`}
            begin={`${(isInward ? directionOffset : 0) + i * stagger}ms`}
            repeatCount="indefinite"
            calcMode="linear"
            {...(isInward ? { keyPoints: '1;0', keyTimes: '0;1' } : {})}
          />
        </circle>
      ))}
    </>
  );
});
```

- [ ] **Step 4: 运行测试，验证全部通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/edges/EdgeFlowParticles.test.tsx`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/edges/EdgeFlowParticles.tsx apps/web/src/pages/canvas/components/edges/EdgeFlowParticles.test.tsx
git commit -m "feat: add EdgeFlowParticles component with bidirectional animateMotion"
```

---

### Task 3: 添加 CSS 变量和全局样式

**Files:**
- Modify: `apps/web/src/index.css:6-20`

- [ ] **Step 1: 在 :root 中添加 CSS 变量**

在 `apps/web/src/index.css` 的 `:root` 块中添加一行，紧接在 `--canvas-handle-hover-icon` 之后：

```css
  /* Edge flow animation */
  --edge-flow-color: #3B82F6;
```

- [ ] **Step 2: 在文件末尾添加边缘流动画和无障碍样式**

在 `apps/web/src/index.css` 文件末尾追加：

```css
/* Edge flow animation */
.edge-flow-particles {
  opacity: 0;
  pointer-events: none;
  will-change: transform;
  transition: opacity 300ms ease;
}

.edge-flow-particles.is-active {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .edge-flow-particles {
    display: none;
  }
}
```

- [ ] **Step 3: 验证 CSS 语法**

Run: `cd apps/web && npx tailwindcss --noop 2>&1 || echo "CSS check: manual review needed"`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/index.css
git commit -m "style: add edge-flow CSS variable and particle animation styles"
```

---

### Task 4: 改造 ConnectionLine 组件（TDD：先更新测试）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/edges/ConnectionLine.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/edges/ConnectionLine.tsx`

- [ ] **Step 1: 更新 ConnectionLine 测试**

将现有测试文件替换为：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConnectionLine } from './ConnectionLine';
import { ReactFlowProvider } from '@xyflow/react';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      onEdgesChange: vi.fn(),
    }),
  },
}));

// mock useStore from @xyflow/react
const mockNodeInternals = new Map<string, { selected: boolean }>();
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useStore: vi.fn(),
  };
});

import { useStore } from '@xyflow/react';

const defaultProps = {
  id: 'e1',
  sourceX: 0,
  sourceY: 100,
  targetX: 200,
  targetY: 100,
  sourcePosition: 'right' as const,
  targetPosition: 'left' as const,
  selected: false,
  source: 'node1',
  target: 'node2',
};

function setupMockUseStore(sourceSelected: boolean, targetSelected: boolean) {
  mockNodeInternals.clear();
  mockNodeInternals.set('node1', { selected: sourceSelected } as any);
  mockNodeInternals.set('node2', { selected: targetSelected } as any);

  vi.mocked(useStore).mockImplementation((selector: any) => {
    return selector({
      nodeInternals: new Map(mockNodeInternals),
    });
  });
}

const renderWithProviders = (props = {}) =>
  render(
    <ReactFlowProvider>
      <svg>
        <ConnectionLine {...defaultProps} {...props} />
      </svg>
    </ReactFlowProvider>,
  );

describe('ConnectionLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render edge path', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders();
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('should have amber stroke when edge itself selected', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders({ selected: true });
    const path = container.querySelector('path')!;
    expect(path.getAttribute('style')).toContain('#f59e0b');
  });

  it('should have gray stroke when not selected', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders({ selected: false });
    const path = container.querySelector('path')!;
    expect(path.getAttribute('style')).toContain('#888');
  });

  it('should show particles when source node is selected', () => {
    setupMockUseStore(true, false);
    const { container } = renderWithProviders();
    const particlesGroup = container.querySelector('.edge-flow-particles');
    expect(particlesGroup).toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(6); // 3 outward + 3 inward
  });

  it('should show particles when target node is selected', () => {
    setupMockUseStore(false, true);
    const { container } = renderWithProviders();
    const particlesGroup = container.querySelector('.edge-flow-particles');
    expect(particlesGroup).toBeInTheDocument();
  });

  it('should NOT show particles when neither endpoint is selected', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders();
    const particlesGroup = container.querySelector('.edge-flow-particles');
    expect(particlesGroup).not.toBeInTheDocument();
  });

  it('should show highlight overlay when endpoint selected and edge not selected', () => {
    setupMockUseStore(true, false);
    const { container } = renderWithProviders({ selected: false });
    const paths = container.querySelectorAll('path');
    // at least 2 paths: BaseEdge + HighlightOverlay
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('should NOT show highlight overlay when edge itself is selected', () => {
    setupMockUseStore(true, false);
    const { container } = renderWithProviders({ selected: true });
    const paths = container.querySelectorAll('path');
    // only 1 path (BaseEdge), no HighlightOverlay
    expect(paths.length).toBe(1);
  });

  it('should handle missing nodeInternals gracefully', () => {
    // empty Map: get() returns undefined
    mockNodeInternals.clear();
    vi.mocked(useStore).mockImplementation((selector: any) => {
      return selector({ nodeInternals: new Map() });
    });
    const { container } = renderWithProviders();
    // should render without crash
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('should show particles when both endpoints are selected', () => {
    setupMockUseStore(true, true);
    const { container } = renderWithProviders();
    // still 6 particles total (not doubled)
    expect(container.querySelectorAll('circle')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 运行测试，验证新增测试失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/edges/ConnectionLine.test.tsx`
Expected: existing 4 tests PASS, new tests (showing particles, overlay, etc.) FAIL

- [ ] **Step 3: 改造 ConnectionLine 组件**

将 `apps/web/src/pages/canvas/components/edges/ConnectionLine.tsx` 替换为：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
  useStore,
  type EdgeProps,
} from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { EdgeFlowParticles } from './EdgeFlowParticles';

export function ConnectionLine({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = useStore((state) => {
    const sourceSelected = state.nodeInternals.get(source)?.selected ?? false;
    const targetSelected = state.nodeInternals.get(target)?.selected ?? false;
    return sourceSelected || targetSelected;
  });

  const [visible, setVisible] = useState(false);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isActive) {
      setVisible(true);
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    } else {
      unmountTimerRef.current = setTimeout(() => setVisible(false), 300);
    }
    return () => {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
      }
    };
  }, [isActive]);

  const onDeleteEdge = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      useCanvasStore.getState().onEdgesChange([{ type: 'remove', id }]);
    },
    [id],
  );

  const containerClassName = `edge-flow-particles${isActive && visible ? ' is-active' : ''}`;

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#f59e0b' : '#888',
          strokeWidth: selected ? 3 : 2,
        }}
      />
      {isActive && !selected && (
        <path
          d={edgePath}
          fill="none"
          stroke="#999"
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {visible && (
        <g className={containerClassName} style={{ pointerEvents: 'none' }}>
          <EdgeFlowParticles pathD={edgePath} direction="outward" active={isActive} />
          <EdgeFlowParticles pathD={edgePath} direction="inward" active={isActive} />
        </g>
      )}
      {selected && (
        <EdgeLabelRenderer>
          <button
            onClick={onDeleteEdge}
            className="absolute text-[10px] bg-[#333] text-[#ccc] rounded-full w-5 h-5 flex items-center justify-center border border-[#555] cursor-pointer hover:bg-[#ef4444] hover:text-white hover:border-[#ef4444] transition-colors"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
```

关键变更：
1. 新增 `source`, `target` 从 `EdgeProps` 解构（React Flow 默认传入）
2. `useStore` 单 selector O(1) 查询 `nodeInternals`
3. `visible` + `isActive` 双变量控制粒子 DOM 挂载和 opacity 过渡
4. 高亮叠加层 `isActive && !selected` 条件渲染
5. 粒子容器 class 控制 `is-active` 触发 CSS transition
6. `source`, `target` extra type-safe via React Flow 内置属性

- [ ] **Step 4: 运行测试，验证全部通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/edges/ConnectionLine.test.tsx`
Expected: all 10 tests PASS

- [ ] **Step 5: 确认 EdgeFlowParticles 测试仍然通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/edges/EdgeFlowParticles.test.tsx`
Expected: all 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/canvas/components/edges/ConnectionLine.tsx apps/web/src/pages/canvas/components/edges/ConnectionLine.test.tsx
git commit -m "feat: add edge flow particles and highlight overlay on node selection"
```

---

### Task 5: 集成验证（浏览器）

**Files:** (no changes, verification only)

- [ ] **Step 1: 启动 dev server**

Run: `preview_start("web-dev")` or `cd apps/web && npm run dev`

- [ ] **Step 2: 打开 Canvas 页面，创建节点和连线**

- [ ] **Step 3: 验证场景**

| 验证项 | 操作 | 预期 |
|--------|------|------|
| 节点选中粒子出现 | 点击节点 | 相连边出现蓝色粒子流动 |
| 粒子淡入 | 点击节点 | 粒子 opacity 0→1 过渡 |
| 粒子淡出 | 点击空白取消 | 粒子 opacity 1→0 后消失 |
| 连线提亮 | 点击节点 | 相连边颜色微亮 |
| 边自身选中优先 | 点击边 | 橙色加粗，无叠加层 |
| 多选 | Ctrl+点击两个节点 | 两个节点相连边都动 |
| 拖拽不闪烁 | 拖拽选中节点 | 粒子持续稳定显示 |
| 删除节点 | Delete 键 | 粒子消失无内存泄漏 |

- [ ] **Step 4: 验证通过后标记完成**

---

### Task 6: 最终验证

- [ ] **Step 1: 运行全部测试**

Run: `cd apps/web && npx vitest run`
Expected: all tests PASS (no regressions)

- [ ] **Step 2: TypeScript 检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit final verification**

```bash
git add -A
git commit -m "chore: final verification for edge flow animation"
```

---

## Task 依赖关系

```
Task 1 (config) ───┐
                    ├──> Task 2 (EdgeFlowParticles) ──┐
Task 3 (CSS) ──────┘                                  ├──> Task 4 (ConnectionLine) ──> Task 5 (Integration) ──> Task 6 (Final)
                                                      │
                                                      └── (Task 3 and Task 2 are independent)
```

Task 1 和 Task 3 独立，可并行。Task 2 依赖 Task 1。Task 4 依赖 Task 2、3。Task 5、6 依赖 Task 4。

## 关键实现细节

1. **`isEdgeSelected` 来源**：直接使用 `EdgeProps.selected`，无需额外订阅
2. **淡入实现**：CSS 类控制。容器默认 `opacity: 0`，`is-active` 类设置 `opacity: 1`。挂载与加类分属两个渲染周期，自然触发过渡
3. **粒子颜色**：通过 `style={{ fill: 'var(--edge-flow-color)' }}` 设置
4. **高亮叠加层路径**：直接复用已计算的 `edgePath` 变量
5. **`source`/`target` props**：React Flow 的 `EdgeProps` 内置属性，默认传入每条边
