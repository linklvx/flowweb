<!-- doc-status: historical | verified_at: n/a -->
# Phase 5: Video Node Enhancement Design

> **Status:** Approved
> **Date:** 2026-05-12
> **Scope:** Full video node with dual-state, 4 generation modes, HY-Video API integration, video playback

## 1. Overview

Transform the Phase 2 placeholder VideoGenNode into a fully functional video generation node, reusing the ImageGenNode dual-state architecture. Supports text-to-video, image-to-video, first-last-frame video, and multi-frame reference video generation via HY-Video 1.5 API.

## 2. Architecture

### 2.1 File Structure

```
apps/web/src/pages/canvas/components/nodes/
├── VideoGenNode.tsx              [REWRITE — replace placeholder]
├── VideoConfigPanel.tsx           [CREATE — floating config panel]
├── VideoGenNode.test.tsx          [REWRITE]
└── VideoConfigPanel.test.tsx      [CREATE]

apps/api/src/modules/execution/
└── api-caller.service.ts          [MODIFY — add callVideoGen]

apps/api/prisma/
└── seed.ts                        [MODIFY — add HY-Video model]
```

### 2.2 Component Structure

```
VideoGenNode (复用 ImageGenNode 双态架构)
├── 节点主体 (relative 容器)
│   ├── Handle 输入/输出 (紫色 #c084fc)
│   ├── 视频预览框
│   │   ├── 无视频: 占位符 ▶ 图标
│   │   ├── 有 videoUrl: <video controls> 播放器
│   │   └── 生成中: 加载动画
│   └── 状态指示灯 (等待/loading/done/error)
└── VideoConfigPanel (激活态悬浮, 失活完全隐藏)
    ├── 生成模式切换 (4 tab 按钮并排)
    │   ├── 文生视频 (默认)
    │   ├── 单图生视频
    │   ├── 首尾帧生视频
    │   └── 多帧参考生视频
    ├── 图片 URL 输入区 (模式切换动态显示)
    │   ├── 单图模式: 开始帧URL输入框
    │   ├── 首尾帧模式: 开始帧URL + 结束帧URL
    │   └── 多帧模式: 多行URL输入框(2-10个)
    ├── Prompt 输入框
    ├── 模型选择 (hy-video-1.5)
    ├── 视频比例 (16:9 / 9:16 / 1:1)
    ├── 清晰度 (720P / 1080P)
    ├── 视频时长 (5s / 10s / 15s)
    ├── 生成音频 (toggle)
    ├── 积分显示
    └── ▶ 执行按钮
```

### 2.3 Generation Mode Mapping

| Mode | Input | Panel Shows | API Params |
|------|-------|-------------|------------|
| text-to-video | Prompt only | Hide image area | `{ prompt }` |
| image-to-video | 1 image URL | Start frame URL input | `{ prompt, imageUrl }` |
| first-last-frame | 2 image URLs | Start + End frame URL inputs | `{ prompt, startImageUrl, endImageUrl }` |
| multi-frame | 2-10 image URLs | Multi-URL textarea | `{ prompt, imageUrls: string[] }` |

## 3. Backend Changes

### 3.1 ApiCallerService — callVideoGen

```typescript
async callVideoGen(params: {
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
}): Promise<VideoGenResult>

// Submit: POST /v1/api/video/submit { model: "hy-video-1.5", prompt, ... }
// Query:  POST /v1/api/video/query  { model: "hy-video-1.5", id }
// Poll max 60 times × 3s (video takes longer)
```

### 3.2 MODEL_CONFIG Addition

```typescript
'seed-model-hy-video': {
  apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/video',
  apiKey: 'sk-3spY8oRUCrMphKWPwS8I8jKxTGH9LyCaDrxfhucZFpi02y2C',
  modelName: 'hy-video-1.5',
  type: 'video',
}
```

### 3.3 Execution Service

In execution.service.ts, add video node handling after the image node section:

```typescript
if (node.type === 'videoGen') {
  const result = await this.apiCaller.callVideoGen({ ... });
  await prisma.canvasNode.update({
    data: { data: { ...data, videoUrl: result.url } }
  });
  gateway.emitNodeStatus(projectId, { nodeId, status: 'done', resultUrl: result.url });
}
```

## 4. Database Seed

Add HY-Video model to seed.ts:

```typescript
const videoNode = await prisma.nodeType.findUnique({ where: { key: 'video' } });

await prisma.aIModel.upsert({
  where: { id: 'seed-model-hy-video' },
  update: {},
  create: {
    id: 'seed-model-hy-video', nodeTypeId: videoNode.id,
    name: 'HY-Video 1.5', provider: 'Tencent Maas',
    apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/video',
    sortOrder: 1, recommended: true,
  },
});

// Video durations
const dur5 = await prisma.modelDuration.upsert({ where: { id: 'seed-dur-5' }, update: {}, create: { id: 'seed-dur-5', modelId: hyVideo.id, label: '5秒', seconds: 5 } });
const dur10 = ...10秒, dur15 = ...15秒

// Video pricing
{ nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur5.id, creditCost: 10 }
{ nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur10.id, creditCost: 18 }
{ nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur15.id, creditCost: 25 }
```

## 5. Frontend State Management

Extend nodeStore with VideoNodeData:

```typescript
interface VideoNodeData {
  type: 'video';
  mode: 'text-to-video' | 'image-to-video' | 'first-last-frame' | 'multi-frame';
  prompt: string;
  model: string;
  ratio: string;        // '16:9' | '9:16' | '1:1'
  quality: string;       // '720P' | '1080P'
  duration: string;      // durationId
  audio: boolean;
  startImageUrl?: string;
  endImageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;     // result
  status: 'idle' | 'loading' | 'done' | 'error';
}
```

## 6. Validation Rules

| Mode | Rule | Error Message |
|------|------|---------------|
| image-to-video | startImageUrl required | "请提供开始帧图片URL" |
| first-last-frame | startImageUrl AND endImageUrl required | "请上传开始帧和结束帧" |
| multi-frame | 2 ≤ imageUrls.length ≤ 10 | "请提供2-10张参考图" |
| all modes | prompt not empty | "请输入Prompt" |

## 7. Testing Strategy (TDD)

- VideoGenNode: rendering, handle count, selected state, video playback
- VideoConfigPanel: mode switching, URL validation, API integration
- ApiCallerService.callVideoGen: submit/poll flow, mode parameter mapping
- Backend: execution pipeline for video nodes

## 8. What's NOT in Phase 5

- Real file upload (MinIO integration)
- Video editing/trimming
- User-uploaded video playback (only generated videos)
