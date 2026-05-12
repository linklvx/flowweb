# Phase 5: Video Node Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade VideoGenNode from placeholder to full dual-state node with 4 video generation modes, HY-Video API integration, and video playback.

**Architecture:** Reuse ImageGenNode dual-state pattern — relative container with absolute-positioned floating config panel. 4 generation modes via tab switching in VideoConfigPanel. ApiCallerService.callVideoGen uses same submit/poll pattern as HY-Image.

**Tech Stack:** React 18, @xyflow/react, Zustand, NestJS, Prisma, Hy-Video 1.5 API

---

## File Structure Map

```
Modified files:
  apps/api/src/modules/execution/api-caller.service.ts  [Add MODEL_CONFIG + callVideoGen]
  apps/api/src/modules/execution/execution.service.ts    [Add video node handling]
  apps/api/prisma/seed.ts                                [Add HY-Video model + durations + pricing]

New files:
  apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx      [REWRITE placeholder]
  apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx  [CREATE]
  apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx      [REWRITE]
  apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx  [CREATE]
```

---

### Task 1: ApiCallerService — add callVideoGen + MODEL_CONFIG

**Files:**
- Modify: `apps/api/src/modules/execution/api-caller.service.ts`
- Modify: `apps/api/src/modules/execution/api-caller.service.spec.ts`

- [ ] **Step 1: Write FAILING test for callVideoGen**

```typescript
// In api-caller.service.spec.ts, add:

describe('callVideoGen', () => {
  it('should return mock video URL for unknown model', async () => {
    const result = await service.callVideoGen({
      prompt: '一只小狗', model: 'unknown-model', mode: 'text-to-video',
    });
    expect(result.url).toContain('/mock/');
    expect(result.url).toContain('.mp4');
  });

  it('should fallback to mock when no config matches', async () => {
    const result = await service.callVideoGen({
      prompt: 'test', model: 'SD XL', mode: 'text-to-video',
    });
    expect(result.url).toContain('/mock/');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Add MODEL_CONFIG entry + implement callVideoGen**

In `api-caller.service.ts`, add to MODEL_CONFIG:

```typescript
'seed-model-hy-video': {
  apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/video',
  apiKey: 'sk-3spY8oRUCrMphKWPwS8I8jKxTGH9LyCaDrxfhucZFpi02y2C',
  modelName: 'hy-video-1.5',
  type: 'video',
},
```

Add types:

```typescript
export interface VideoGenParams {
  prompt: string;
  model: string;
  mode: 'text-to-video' | 'image-to-video' | 'first-last-frame' | 'multi-frame';
  imageUrl?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  imageUrls?: string[];
  ratio?: string;
  quality?: string;
  duration?: string;
  audio?: boolean;
}

export interface VideoGenResult {
  url: string;
}
```

Add method to ApiCallerService class:

```typescript
async callVideoGen(params: VideoGenParams): Promise<VideoGenResult> {
  const config = MODEL_CONFIG[params.model];
  if (!config || config.type !== 'video') {
    await new Promise(r => setTimeout(r, 1000));
    return { url: `/mock/video_${Date.now()}.mp4` };
  }

  // Submit
  const body: any = { model: config.modelName, prompt: params.prompt };
  if (params.imageUrl) body.imageUrl = params.imageUrl;
  if (params.startImageUrl) body.startImageUrl = params.startImageUrl;
  if (params.endImageUrl) body.endImageUrl = params.endImageUrl;
  if (params.imageUrls?.length) body.imageUrls = params.imageUrls;

  const submitRes = await fetch(`${config.apiUrl}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  });
  const submitJson = await submitRes.json() as any;
  const taskId = submitJson.id || submitJson.task_id;
  if (!taskId) throw new Error('Video submit failed: no task ID');

  // Poll (60 retries × 3s = 3 min max)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const queryRes = await fetch(`${config.apiUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.modelName, id: taskId }),
    });
    const queryJson = await queryRes.json() as any;
    if (queryJson.status === 'completed' || queryJson.status === 'succeeded' || queryJson.status === 'done') {
      const urls = queryJson.data || queryJson.results || [];
      const first = Array.isArray(urls) ? urls[0] : urls;
      const resultUrl = typeof first === 'string' ? first : first?.url || first;
      return { url: String(resultUrl) };
    }
    if (queryJson.status === 'failed' || queryJson.status === 'error') {
      throw new Error(`Video generation failed: ${queryJson.error || 'unknown error'}`);
    }
  }
  throw new Error('Video generation timeout');
}
```

- [ ] **Step 3: Run tests → GREEN → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/execution/api-caller.service.ts apps/api/src/modules/execution/api-caller.service.spec.ts
git commit -m "feat: add callVideoGen with HY-Video submit/poll (60x3s)"
```

---

### Task 2: Execution Service — add video node handling

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts`

- [ ] **Step 1: Add video node processing**

Find the section after image node handling (after `callImageGen` section). Add BEFORE the catch block:

```typescript
// Video nodes
if (node.type === 'videoGen') {
  const vData = data as any;
  const result = await this.apiCaller.callVideoGen({
    prompt: prompt || vData?.prompt || '',
    model: vData?.model,
    mode: vData?.mode || 'text-to-video',
    imageUrl: upstream.imageUrl || vData?.startImageUrl,
    startImageUrl: vData?.startImageUrl,
    endImageUrl: vData?.endImageUrl,
    imageUrls: vData?.imageUrls,
    ratio: vData?.ratio,
    quality: vData?.quality,
    duration: vData?.duration,
    audio: vData?.audio,
  });

  await this.prisma.canvasNode.update({
    where: { id: node.id },
    data: { data: { ...vData, videoUrl: result.url } },
  });

  const newBalance = await this.credit.getBalance(userId);
  this.gateway.emitNodeStatus(projectId, {
    nodeId: node.id, status: 'done', resultUrl: result.url, credits: newBalance?.credits,
  });
  continue;
}
```

- [ ] **Step 2: Run all tests → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/execution/execution.service.ts
git commit -m "feat: add video node handling in execution pipeline"
```

---

### Task 3: VideoConfigPanel — 4-mode floating config panel

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx`

- [ ] **Step 1: Write FAILING test**

```typescript
// VideoConfigPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoConfigPanel } from './VideoConfigPanel';

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((sel?: any) => {
    const s = { nodes: { 'v1': { type: 'video', mode: 'text-to-video', prompt: '', model: '', ratio: '16:9', quality: '720P', duration: '', audio: false, status: 'idle' } }, updateConfig: vi.fn(), setStatus: vi.fn() };
    return sel ? sel(s) : s;
  }),
}));

vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: vi.fn(() => ({})) }));

describe('VideoConfigPanel', () => {
  it('should render 4 mode tabs', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByText('文生视频')).toBeInTheDocument();
    expect(screen.getByText('单图生视频')).toBeInTheDocument();
    expect(screen.getByText('首尾帧生视频')).toBeInTheDocument();
    expect(screen.getByText('多帧参考生视频')).toBeInTheDocument();
  });

  it('should show prompt input', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByPlaceholderText(/描述想要生成的视频/i)).toBeInTheDocument();
  });

  it('should render execute button', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByText('▶')).toBeInTheDocument();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement VideoConfigPanel**

Key design:
- 4 mode tabs at top, `text-to-video` default
- Image URL sections toggle based on mode
- model dropdown loads from `/api/node-types/video/models`
- ratio, quality, duration, audio dropdowns
- ▶ button with executing state

Due to length, see Appendix A for full component code.

- [ ] **Step 3: Run tests → GREEN → Commit**

```bash
cd apps/web && pnpm test -- --run
git add apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx
git commit -m "feat: add VideoConfigPanel with 4-mode tabs and video params"
```

---

### Task 4: VideoGenNode — rewrite placeholder with dual-state

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx`

- [ ] **Step 1: Write FAILING test**

```typescript
// VideoGenNode.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((sel?: any) => {
    const s = { nodes: { 'v1': { type: 'video', videoUrl: undefined, status: 'idle' } } };
    return sel ? sel(s) : s;
  }),
}));

describe('VideoGenNode', () => {
  const renderNode = (selected = false) =>
    render(<ReactFlowProvider><VideoGenNode id="v1" data={{}} selected={selected} /></ReactFlowProvider>);

  it('should render node title', () => {
    renderNode();
    expect(screen.getByText(/视频生成节点/i)).toBeInTheDocument();
  });

  it('should render preview placeholder when no video', () => {
    renderNode();
    expect(screen.getByText(/视频预览区/i)).toBeInTheDocument();
  });

  it('should render video element when videoUrl exists', () => {
    vi.mocked(require('@/stores/nodeStore').useNodeStore).mockImplementation((sel?: any) => {
      const s = { nodes: { 'v1': { type: 'video', videoUrl: '/test.mp4', status: 'done' } } };
      return sel ? sel(s) : s;
    });
    renderNode();
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.querySelector('source')?.getAttribute('src')).toBe('/test.mp4');
  });

  it('should have 2 handles', () => {
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  it('should show config panel when selected', () => {
    renderNode(true);
    expect(screen.getByText('文生视频')).toBeInTheDocument();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Rewrite VideoGenNode**

Replace placeholder with dual-state component (relative wrapper, absolute-positioned config panel), video preview area with `<video controls>`, status indicator, purple theme. Pattern identical to ImageGenNode.

- [ ] **Step 3: Run tests → GREEN → Commit**

```bash
cd apps/web && pnpm test -- --run
git add apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.test.tsx
git commit -m "feat: rewrite VideoGenNode with dual-state, video preview, and config panel"
```

---

### Task 5: Database Seed — HY-Video model

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Add HY-Video model + durations + pricing to seed**

Append after existing video node seed section:

```typescript
// HY-Video model
const hyVideo = await prisma.aIModel.upsert({
  where: { id: 'seed-model-hy-video' },
  update: {},
  create: {
    id: 'seed-model-hy-video', nodeTypeId: videoNode.id,
    name: 'HY-Video 1.5', provider: 'Tencent Maas',
    apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/video',
    sortOrder: 1, recommended: true,
  },
});

const dur5 = await prisma.modelDuration.upsert({ where: { id: 'seed-dur-5' }, update: {}, create: { id: 'seed-dur-5', modelId: hyVideo.id, label: '5秒', seconds: 5 } });
const dur10 = await prisma.modelDuration.upsert({ where: { id: 'seed-dur-10' }, update: {}, create: { id: 'seed-dur-10', modelId: hyVideo.id, label: '10秒', seconds: 10 } });
const dur15 = await prisma.modelDuration.upsert({ where: { id: 'seed-dur-15' }, update: {}, create: { id: 'seed-dur-15', modelId: hyVideo.id, label: '15秒', seconds: 15 } });

const videoPricingRules = [
  { nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur5.id, creditCost: 10 },
  { nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur10.id, creditCost: 18 },
  { nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur15.id, creditCost: 25 },
];
for (const rule of videoPricingRules) {
  const existing = await prisma.pricingRule.findFirst({
    where: { nodeTypeId: rule.nodeTypeId, modelId: rule.modelId, durationId: rule.durationId, resolutionId: null },
  });
  if (existing) {
    await prisma.pricingRule.update({ where: { id: existing.id }, data: { creditCost: rule.creditCost } });
  } else {
    await prisma.pricingRule.create({ data: rule as any });
  }
}
```

- [ ] **Step 2: Run seed → Commit**

```bash
cd apps/api && npx tsx prisma/seed.ts
git add apps/api/prisma/seed.ts
git commit -m "feat: add HY-Video 1.5 model, durations, and pricing to seed"
```

---

### Task 6: Full Stack Integration Verification

- [ ] **Step 1: Run ALL tests**

```bash
pnpm test
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 3: Verify endpoints + file structure**

Check: VideoGenNode renders, VideoConfigPanel shows 4 modes, api-caller has MODEL_CONFIG, execution service handles videoGen type, seed has hy-video model.

- [ ] **Step 4: E2E test — call video API**

```bash
curl -X POST http://localhost:3000/api/execution/execute \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"default","nodeId":"test-video-node"}'
```

- [ ] **Step 5: Report + Commit any fixes**

---

## Appendix A: VideoConfigPanel Full Component

```tsx
// VideoConfigPanel.tsx
import { memo, useCallback, useState, useEffect } from 'react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { executeWorkflow } from '@/api/executionApi';
import { syncNodes, syncEdges } from '@/api/projectApi';

const RATIOS = ['16:9', '9:16', '1:1'];
const QUALITIES = ['720P', '1080P'];
const DURATIONS = ['5秒', '10秒', '15秒'];
const MODES = [
  { key: 'text-to-video', label: '文生视频' },
  { key: 'image-to-video', label: '单图生视频' },
  { key: 'first-last-frame', label: '首尾帧生视频' },
  { key: 'multi-frame', label: '多帧参考生视频' },
] as const;

interface Props { nodeId: string; }

function VideoConfigPanelComponent({ nodeId }: Props) {
  const nodeData = useNodeStore((s) => s.nodes[nodeId]) as any;
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const setStatus = useNodeStore((s) => s.setStatus);

  const [models, setModels] = useState<any[]>([]);
  const [creditCost, setCreditCost] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [prompt, setPrompt] = useState(nodeData?.prompt ?? '');

  const mode = nodeData?.mode ?? 'text-to-video';
  const model = nodeData?.model ?? '';
  const ratio = nodeData?.ratio ?? '16:9';
  const quality = nodeData?.quality ?? '720P';
  const duration = nodeData?.duration ?? '';
  const audio = nodeData?.audio ?? false;

  useEffect(() => {
    fetch('/api/node-types/video/models')
      .then(r => r.json()).then(j => { if (j.code === 0) setModels(j.data); }).catch(() => {});
  }, []);

  const update = (fields: any) => {
    const store = useNodeStore.getState();
    useNodeStore.setState({ nodes: { ...store.nodes, [nodeId]: { ...store.nodes[nodeId], type: 'video', ...fields } } });
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setExecuting(true); setStatus(nodeId, 'loading');
    try {
      const cs = useCanvasStore.getState();
      const ns = useNodeStore.getState();
      const merged = cs.nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: ns.nodes[n.id] || n.data || {} }));
      await Promise.all([syncNodes('default', merged), syncEdges('default', cs.edges)]);
      await executeWorkflow('default', nodeId);
    } catch { setStatus(nodeId, 'error'); }
    finally { setExecuting(false); }
  }, [nodeId, setStatus, prompt]);

  return (
    <div className="bg-[#1a1a1a] border-2 border-t-[#c084fc] border-[#444] rounded-xl w-[420px] shadow-xl">
      <div className="p-4">
        {/* Mode tabs */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {MODES.map(m => (
            <button key={m.key} onClick={() => update({ mode: m.key })}
              className={`px-2 py-1 rounded text-[10px] border transition-colors ${mode === m.key ? 'bg-[#c084fc]/20 border-[#c084fc] text-[#c084fc]' : 'bg-[#252525] border-[#444] text-[#888] hover:border-[#c084fc]'}`}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Image URL inputs — mode-dependent */}
        {mode === 'image-to-video' && (
          <input placeholder="开始帧图片URL" value={nodeData?.startImageUrl ?? ''} onChange={e => update({ startImageUrl: e.target.value })}
            className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 mb-3" />
        )}
        {mode === 'first-last-frame' && (
          <div className="flex gap-2 mb-3">
            <input placeholder="开始帧URL" value={nodeData?.startImageUrl ?? ''} onChange={e => update({ startImageUrl: e.target.value })}
              className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2" />
            <input placeholder="结束帧URL" value={nodeData?.endImageUrl ?? ''} onChange={e => update({ endImageUrl: e.target.value })}
              className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2" />
          </div>
        )}
        {mode === 'multi-frame' && (
          <textarea placeholder="输入2-10个图片URL，每行一个" value={(nodeData?.imageUrls ?? []).join('\n')}
            onChange={e => update({ imageUrls: e.target.value.split('\n').filter(Boolean) })}
            rows={3} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 mb-3 resize-none box-border" />
        )}

        {/* Prompt */}
        <textarea placeholder="描述想要生成的视频内容..." value={prompt}
          onChange={e => { setPrompt(e.target.value); update({ prompt: e.target.value }); }}
          rows={2} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 mb-3 resize-none box-border" />

        {/* Params */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div>
            <div className="text-[10px] text-[#888] mb-1">比例</div>
            <select value={ratio} onChange={e => update({ ratio: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1 py-1.5">
              {RATIOS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">清晰度</div>
            <select value={quality} onChange={e => update({ quality: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1 py-1.5">
              {QUALITIES.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">时长</div>
            <select value={duration} onChange={e => update({ duration: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1 py-1.5">
              <option value="">选择</option>
              {DURATIONS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">音频</div>
            <button onClick={() => update({ audio: !audio })}
              className={`w-full py-1.5 rounded-md text-[10px] border ${audio ? 'bg-[#c084fc]/20 border-[#c084fc] text-[#c084fc]' : 'bg-[#252525] border-[#444] text-[#888]'}`}>
              {audio ? '开' : '关'}
            </button>
          </div>
        </div>

        {/* Execute */}
        <div className="flex justify-between items-center">
          <span className="text-xs text-[#f59e0b]">{creditCost || '—'} 积分</span>
          <button onClick={handleGenerate} disabled={executing}
            className={`w-9 h-9 text-black font-bold text-lg rounded-full flex items-center justify-center cursor-pointer border-none shadow-md ${executing ? 'bg-gray-500' : 'bg-[#4ade80] hover:bg-[#22c55e] shadow-[#4ade80]/30'}`}>
            {executing ? '⏳' : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const VideoConfigPanel = memo(VideoConfigPanelComponent);
```

## Verification Checklist

- [ ] `pnpm test` — all tests pass
- [ ] TypeScript compilation clean
- [ ] VideoGenNode renders placeholder/loading/video states
- [ ] VideoConfigPanel shows 4 mode tabs, switches correctly
- [ ] Image URL inputs appear/disappear per mode
- [ ] ApiCallerService.callVideoGen handles HY-Video submit/poll
- [ ] Execution pipeline processes videoGen nodes
- [ ] Seed data: HY-Video model + 3 durations + 3 pricing rules
