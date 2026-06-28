# AI 工具选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在扩展图片节点（imageExtGen）底部配置面板中新增 AI 工具选择器按钮 + 弹出菜单

**Architecture:** nodeStore 仅保留核心业务类型（AiToolId + aiTool 字段 + isImageExtNode），UI 类型（AiToolItem/AiToolGroup）下沉到配置层。aiToolConfig.tsx 集中管理工具分组与内联 SVG 图标。ImageConfigPanel 新增按钮 + 弹窗，样式完全复用现有比例弹窗规范，含弹窗互斥 + 视口边界检测。enqueueWorkflow 改为对象传参透传 aiTool。

**Tech Stack:** React + TypeScript + Zustand + Vitest + React Testing Library

---

### Task 1: 扩展 nodeStore — 纯数据层，不引入 React

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`

- [ ] **Step 1: 添加 AiToolId 类型、aiTool 字段、isImageExtNode 类型守卫**

在 `ImageNodeData` 接口的 `aspectRatio?: number;` 后插入 `aiTool` 字段：

```typescript
  aiTool?: AiToolId;
```

在 `NodeData` 类型（line 117）上方插入（注意：不引入 React，不包含 AiToolItem/AiToolGroup）：

```typescript
export type AiToolId =
  | 'storyboard_scheduling' | 'storyboard' | 'grid_25' | 'four_panel'
  | 'frame_forward_3s' | 'frame_backward_5s'
  | 'portrait_texture' | 'film_lighting'
  | 'panorama_720' | 'nine_camera'
  | 'face_three_view' | 'character_sheet' | 'character_three_view'
  | 'scene_sheet' | 'product_sheet';
```

在 `isImageNode` 上方插入：

```typescript
export function isImageExtNode(node: unknown): node is AppNode & { type: 'imageExtGen'; data: ImageNodeData } {
  if (!isImageNode(node)) return false;
  return node.type === 'imageExtGen';
}
```

- [ ] **Step 2: 运行现有测试**

```bash
cd apps/web && npx vitest run src/stores/ --reporter=verbose 2>&1 | tail -30
```

Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/nodeStore.ts
git commit -m "feat: add AiToolId type, aiTool field, and isImageExtNode type guard"
```

---

### Task 2: 创建 aiToolConfig.tsx — 配置 + 内联 SVG + UI 类型

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/ai/aiToolConfig.tsx`

- [ ] **Step 1: 创建配置文件**

```tsx
import type { AiToolId } from '@/stores/nodeStore';

// ── UI 层类型定义（不放入 nodeStore，避免依赖 React）──

export interface AiToolItem {
  id: AiToolId;
  name: string;
  desc: string;
  icon: React.ReactNode;
  isNew?: boolean;
}

export interface AiToolGroup {
  groupName: string;
  items: AiToolItem[];
}

// ── 内联 SVG 图标 ──

const StoryboardSchedulingIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M5 5l2.5 3-2.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 10h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const StoryboardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="1" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="9" y="1" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="2" y="9" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="9" y="9" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);

const Grid25Icon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="5.7" x2="15" y2="5.7" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="1" y1="10.3" x2="15" y2="10.3" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="5.7" y1="1" x2="5.7" y2="15" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="10.3" y1="1" x2="10.3" y2="15" stroke="currentColor" strokeWidth="0.8"/>
  </svg>
);

const FourPanelIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="8.5" y="1" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="1" y="8.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);

const FrameForwardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/>
    <polyline points="6,5 10,8 6,11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const FrameBackwardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/>
    <polyline points="10,5 6,8 10,11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const PortraitTextureIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const FilmLightingIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="8" y1="1" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="8" y1="11" x2="8" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="1" y1="8" x2="5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="11" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const Panorama720Icon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <ellipse cx="8" cy="8" rx="7" ry="5" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1 1"/>
  </svg>
);

const NineCameraIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="5.7" x2="15" y2="5.7" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="1" y1="10.3" x2="15" y2="10.3" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="5.7" y1="1" x2="5.7" y2="15" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="10.3" y1="1" x2="10.3" y2="15" stroke="currentColor" strokeWidth="0.8"/>
  </svg>
);

const FaceThreeViewIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="13" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const CharacterSheetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M3.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const CharacterThreeViewIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 13c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="1" strokeDasharray="1 0.5"/>
    <path d="M8 13c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1" strokeDasharray="1 0.5" strokeLinecap="round"/>
  </svg>
);

const SceneSheetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M1 5l7-4 7 4v9a1 1 0 01-1 1H2a1 1 0 01-1-1V5z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    <rect x="6" y="9" width="4" height="6" stroke="currentColor" strokeWidth="1.2" fill="none"/>
  </svg>
);

const ProductSheetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="1" width="10" height="14" rx="2" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="0.8"/>
    <circle cx="8" cy="9" r="2" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

// ── 工具分组配置 ──

export const AI_TOOL_GROUPS: AiToolGroup[] = [
  {
    groupName: '分镜叙事',
    items: [
      { id: 'storyboard_scheduling', name: '调度故事板', desc: '生成带有运动轨迹等调度草图分镜', icon: StoryboardSchedulingIcon, isNew: true },
      { id: 'storyboard', name: '故事板', desc: '生成完整剧情片段', icon: StoryboardIcon, isNew: true },
      { id: 'grid_25', name: '25宫格连贯分镜', desc: '生成连续分镜长图', icon: Grid25Icon },
      { id: 'four_panel', name: '剧情推演四宫格', desc: '生成四格剧情推演', icon: FourPanelIcon },
      { id: 'frame_forward_3s', name: '画面推演 - 3秒后', desc: '推演画面后续动作', icon: FrameForwardIcon },
      { id: 'frame_backward_5s', name: '画面推演 - 5秒前', desc: '还原画面前置状态', icon: FrameBackwardIcon },
    ],
  },
  {
    groupName: '质感调节',
    items: [
      { id: 'portrait_texture', name: '人像质感调节', desc: '降低 AI 感，优化人物质感与光影', icon: PortraitTextureIcon, isNew: true },
      { id: 'film_lighting', name: '电影级光影校正', desc: '调整画面光影质感', icon: FilmLightingIcon },
    ],
  },
  {
    groupName: '空间与机位',
    items: [
      { id: 'panorama_720', name: '720全景', desc: '生成全景场景图', icon: Panorama720Icon },
      { id: 'nine_camera', name: '多机位九宫格', desc: '生成多视角机位图', icon: NineCameraIcon },
    ],
  },
  {
    groupName: '设定图',
    items: [
      { id: 'face_three_view', name: '角色脸部三视图', desc: '基于一张参考图生成脸部细节三视图', icon: FaceThreeViewIcon },
      { id: 'character_sheet', name: '角色设定图', desc: '角色主视觉与设定拆解', icon: CharacterSheetIcon },
      { id: 'character_three_view', name: '角色三视图', desc: '正侧背视图与脸部特写', icon: CharacterThreeViewIcon },
      { id: 'scene_sheet', name: '场景设定图', desc: '场景设定与氛围参考', icon: SceneSheetIcon },
      { id: 'product_sheet', name: '产品设定图', desc: '产品外观设定与细节拆解', icon: ProductSheetIcon },
    ],
  },
];
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc --noEmit --pretty 2>&1 | grep -E "aiToolConfig|error TS" | head -20
```

Expected: No errors related to `aiToolConfig.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ai/aiToolConfig.tsx
git commit -m "feat: add AI tool config with 15 tools across 4 groups"
```

---

### Task 3: 更新 ImageConfigPanel — 按钮 + 弹窗 + 互斥 + 边界检测

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`

- [ ] **Step 1: 添加测试（TDD RED）**

在 `ImageConfigPanel.test.tsx` 的 `describe('ImageConfigPanel', ()` 块末尾（最后一个 `it` 之后）添加：

```typescript
// ─── AI tool button (imageExtGen only) ───

it('should render AI tool button for imageExtGen node', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  const btn = screen.getByTestId('canvas-node-image-ai-tool-select');
  expect(btn).toBeTruthy();
  expect(btn.textContent).toContain('AI 工具');
});

it('should NOT render AI tool button for regular imageGen node', () => {
  render(<ImageConfigPanel nodeId="img1" />);
  expect(screen.queryByTestId('canvas-node-image-ai-tool-select')).not.toBeInTheDocument();
});

it('should open AI tool popup on button click', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  expect(screen.getByText('分镜叙事')).toBeTruthy();
  expect(screen.getByText('质感调节')).toBeTruthy();
  expect(screen.getByText('空间与机位')).toBeTruthy();
  expect(screen.getByText('设定图')).toBeTruthy();
});

it('should show "不使用 AI 工具" option at top of popup', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  expect(screen.getByText('不使用 AI 工具')).toBeTruthy();
});

it('should select tool and close popup on click', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  fireEvent.click(screen.getByText('故事板'));
  expect(screen.queryByText('分镜叙事')).not.toBeInTheDocument();
  expect(screen.getByTestId('canvas-node-image-ai-tool-select').textContent).toContain('故事板');
  expect(mockUpdateConfig).toHaveBeenCalledWith('ext1', { aiTool: 'storyboard' });
});

it('should clear aiTool when clicking "不使用 AI 工具"', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  fireEvent.click(screen.getByText('不使用 AI 工具'));
  expect(mockUpdateConfig).toHaveBeenCalledWith('ext1', { aiTool: undefined });
  expect(screen.getByTestId('canvas-node-image-ai-tool-select').textContent).toContain('AI 工具');
});

it('should close AI tool popup on outside click', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  expect(screen.getByText('分镜叙事')).toBeTruthy();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByText('分镜叙事')).not.toBeInTheDocument();
});

it('should close AI tool popup when clicking button again (toggle)', () => {
  render(<ImageConfigPanel nodeId="ext1" />);
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  expect(screen.getByText('分镜叙事')).toBeTruthy();
  fireEvent.click(screen.getByTestId('canvas-node-image-ai-tool-select'));
  expect(screen.queryByText('分镜叙事')).not.toBeInTheDocument();
});

it('should disable AI tool button when status is loading', () => {
  mockNodeData = { ...mockNodeData, status: 'loading' };
  render(<ImageConfigPanel nodeId="ext1" />);
  expect(screen.getByTestId('canvas-node-image-ai-tool-select')).toBeDisabled();
});
```

- [ ] **Step 2: 运行测试（确认 RED）**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx --reporter=verbose 2>&1 | tail -40
```

Expected: 新增测试全部 FAIL。

- [ ] **Step 3: 修改 import**

```typescript
// 现有 import 行修改：
import { useNodeStore, isImageNode, isImageExtNode, type ImageNodeData } from '@/stores/nodeStore';

// 新增 import：
import { AI_TOOL_GROUPS } from './ai/aiToolConfig';
```

- [ ] **Step 3b: 抽取公共弹窗样式常量**

在组件定义上方（`function ImageConfigPanelComponent` 之前）添加，两处弹窗共用：

```typescript
const POPUP_BASE_CLASS = 'absolute bottom-full mb-2 z-[300] rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]';
const POPUP_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)',
  backdropFilter: 'blur(32px)',
};
```

- [ ] **Step 4: 添加 state 和 ref**

在 `const selectedModel = ...` 行后添加：

```typescript
const isExtNode = isImageExtNode(node);
const [aiToolOpen, setAiToolOpen] = useState(false);
const popupRef = useRef<HTMLDivElement>(null);
const selectedAiTool = nodeData?.aiTool;

// 视口边界检测函数：右侧溢出时自动改为右对齐
const checkPopupBounds = useCallback(() => {
  if (!popupRef.current) return;
  // 先重置样式，避免上次 right: '0' 残留导致横向拉伸
  popupRef.current.style.left = '0';
  popupRef.current.style.right = 'auto';
  // 等浏览器完成 layout 后检测是否溢出
  requestAnimationFrame(() => {
    if (!popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      popupRef.current.style.left = 'auto';
      popupRef.current.style.right = '0';
    }
  });
}, []);
```

- [ ] **Step 5: 添加弹窗互斥 + 关闭 + resize 监听 effect**

在现有的 `ratioOpen` 关闭 effect（line 76-81）后添加：

```typescript
// Close AI tool popup on outside click
useEffect(() => {
  if (!aiToolOpen) return;
  const handler = () => setAiToolOpen(false);
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [aiToolOpen]);

// Boundary detection: run on open + listen to window resize (100ms debounce)
useEffect(() => {
  if (!aiToolOpen) return;
  checkPopupBounds();
  let timer: ReturnType<typeof setTimeout>;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(checkPopupBounds, 100);
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    clearTimeout(timer);
  };
}, [aiToolOpen, checkPopupBounds]);
```

- [ ] **Step 6: 修改比例按钮 onClick（添加互斥）**

将比例按钮的 onClick（约 line 335）修改为：

```tsx
onClick={(e) => { e.stopPropagation(); setAiToolOpen(false); setRatioOpen((v) => !v); }}
```

- [ ] **Step 7: 将现有比例弹窗改为使用公共常量**

将比例弹窗的（约 line 344-347）：

```tsx
// 将:
className="absolute bottom-full mb-2 left-0 z-[300] w-[340px] flex flex-col gap-2 rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]"
style={{ backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)', backdropFilter: 'blur(32px)' }}

// 改为:
className={`${POPUP_BASE_CLASS} left-0 w-[340px] flex flex-col gap-2`}
style={POPUP_BASE_STYLE}
```

- [ ] **Step 8: 在比例按钮所在 div 后插入 AI 工具按钮**

在比例分辨率按钮的 `</div>`（line 388，即 `</div>` 关闭 `.relative` 容器）后、外层 `</div>`（line 389，关闭左侧按钮组的 flex div）前，插入：

```tsx
{isExtNode && (
  <div className="relative">
    <button
      type="button"
      data-testid="canvas-node-image-ai-tool-select"
      onClick={(e) => {
        e.stopPropagation();
        setRatioOpen(false);
        setAiToolOpen((v) => !v);
      }}
      disabled={status === 'loading'}
      className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-white/10 active:bg-white/[0.1] px-2 py-1 text-sm rounded-lg text-[#f5f5f5] border-none bg-transparent cursor-pointer"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
        <path d="M8 1.5a.75.75 0 01.75.75v1.19l1.22-.7a.75.75 0 11.75 1.3L9.5 4.73v1.54l1.22.7a.75.75 0 11-.75 1.3L8.75 7.56v.69a.75.75 0 01-1.5 0v-.69l-1.22.7a.75.75 0 11-.75-1.3L6.5 6.27V4.73l-1.22-.7a.75.75 0 11.75-1.3l1.22.7V2.25A.75.75 0 018 1.5z" fill="currentColor"/>
        <path d="M2 11a3 3 0 013-3h6a3 3 0 013 3v1a1 1 0 01-1 1H3a1 1 0 01-1-1v-1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        <circle cx="6.5" cy="12" r="0.5" fill="currentColor"/>
        <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
        <circle cx="9.5" cy="12" r="0.5" fill="currentColor"/>
      </svg>
      <span className="whitespace-nowrap text-xs">
        {selectedAiTool
          ? (AI_TOOL_GROUPS.flatMap(g => g.items).find(t => t.id === selectedAiTool)?.name ?? 'AI 工具')
          : 'AI 工具'}
      </span>
    </button>
    {aiToolOpen && (
      <div
        ref={popupRef}
        className={`${POPUP_BASE_CLASS} left-0 w-[230px] max-w-[calc(100vw-16px)] flex flex-col gap-1 p-2`}
        style={{
          ...POPUP_BASE_STYLE,
          maxHeight: 'min(520px, calc(100vh - 300px))',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto flex flex-col gap-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgb(134, 144, 156) transparent' }}>
          <button
            type="button"
            onClick={() => {
              updateConfig(nodeId, { aiTool: undefined });
              setAiToolOpen(false);
            }}
            className={`flex h-[44px] w-full cursor-pointer items-center gap-2 rounded-xl p-2 text-left transition-colors duration-200 border-none bg-transparent ${
              !selectedAiTool ? 'bg-white/10 text-[#f5f5f5]' : 'text-[#999] hover:bg-white/5'
            }`}
          >
            <span className="text-sm font-medium">不使用 AI 工具</span>
          </button>
          {AI_TOOL_GROUPS.map((group) => (
            <div key={group.groupName} className="flex flex-col gap-0.5">
              <div className="px-2 py-1">
                <span className="text-[#999] text-xs font-medium">{group.groupName}</span>
              </div>
              {group.items.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    updateConfig(nodeId, { aiTool: tool.id });
                    setAiToolOpen(false);
                  }}
                  className={`group flex h-[52px] w-full cursor-pointer items-center gap-2 rounded-xl p-2 text-left transition-colors duration-200 border-none bg-transparent ${
                    selectedAiTool === tool.id
                      ? 'bg-white/10 text-[#f5f5f5]'
                      : 'text-[#999] hover:bg-white/5'
                  }`}
                >
                  <div className="relative flex size-[34px] flex-none items-center justify-center rounded-lg bg-white/5">
                    {tool.icon}
                    {tool.isNew && (
                      <span className="pointer-events-none absolute right-[3px] top-[3px] size-1.5 rounded-full bg-[#5DDCFF] border border-[#1a1a1a]" />
                    )}
                  </div>
                  <div className="flex flex-col justify-center overflow-hidden">
                    <span className="text-sm font-medium truncate">{tool.name}</span>
                    <span className="mt-0.5 text-xs leading-4 text-[#999] opacity-0 group-hover:opacity-60 transition-opacity duration-200">{tool.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 9: 运行测试（确认 GREEN）**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx --reporter=verbose 2>&1 | tail -50
```

Expected: All tests PASS。

- [ ] **Step 10: Type-check**

```bash
cd apps/web && npx tsc --noEmit --pretty 2>&1 | grep -E "ImageConfigPanel|error TS" | head -20
```

Expected: No errors。

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx
git commit -m "feat: add AI tool selector button and popup for imageExtGen nodes"
```

---

### Task 4: enqueueWorkflow 改为对象传参 + 透传 aiTool

**Files:**
- Modify: `apps/web/src/api/executionApi.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`

- [ ] **Step 1: 修改 enqueueWorkflow 签名**

```typescript
import type { AiToolId } from '@/stores/nodeStore';

export async function enqueueWorkflow(params: {
  projectId: string;
  nodeId?: string;
  aiTool?: AiToolId;
}): Promise<{ jobId: string; status: string }> {
  return apiFetch('/execution/enqueue', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
```

`AiToolId` 为 type-only import，编译后零运行时依赖。

- [ ] **Step 2: 修改 ImageConfigPanel 调用点 — 类型安全收窄**

在 `handleGenerate`（约 line 212）：

```typescript
// 将:
const { jobId } = await enqueueWorkflow('default', nodeId);
// 改为:
const latestNode = useNodeStore.getState().nodes[nodeId];
const latestAiTool = isImageNode(latestNode) ? latestNode.data.aiTool : undefined;
const { jobId } = await enqueueWorkflow({ projectId: 'default', nodeId, aiTool: latestAiTool });
```

搜索项目中其他 `enqueueWorkflow` 调用点并同步改为对象传参：

```bash
grep -rn "enqueueWorkflow" apps/web/src/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 3: Type-check + 测试**

```bash
cd apps/web && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -10
cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: No type errors, all tests pass。

- [ ] **Step 4: 后端兼容性说明（本期不开发，仅记录）**

后端图片生成接口 `/execution/enqueue` 的请求 DTO 需新增 `aiTool?: string` 可选字段：
- 参数校验层：标记为可选，不传不报错
- 拓扑/执行链路：全链路透传
- 本期执行层：默认忽略该参数，不影响原有生成逻辑
- 验证方式：前端透传 `aiTool` 不触发 HTTP 4xx 校验错误

若后端暂不改动，需验证前端 `apiFetch('/execution/enqueue', { body: JSON.stringify({ projectId, nodeId, aiTool }) })` 不会被后端拒绝（大多数 JSON body 解析器对多余字段容忍）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/executionApi.ts apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx
# 加上其他涉及 enqueueWorkflow 调用的文件
git commit -m "refactor: convert enqueueWorkflow to object params, add aiTool passthrough"
```

---

### Task 5: 集成验证

- [ ] **Step 1: 运行全部测试**

```bash
cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: All tests pass。

- [ ] **Step 2: TypeScript 全量检查**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No type errors。

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "chore: integration verification — all tests and types pass"
```
