<!-- doc-status: historical | superseded-by: specs/2026-09-29-collab-conn-status-recovery-design.md | verified_at: n/a | note: §4.1/§7/§8 持久化机制已死（指针已加）；批 4 核查=文内无 ReactFlow 选型论证段（spec 自始假设 xyflow，ADR-0002 无源萃取——登记） -->
# Phase 2: Canvas Engine + Node System Design

> **Status:** Approved
> **Date:** 2026-05-10
> **Scope:** Infinite canvas (@xyflow/react), 3 node types, edge connections, state management, persistence

## 1. Overview

Build the visual canvas engine — the core of the AI content creation platform. Users drag nodes onto an infinite canvas, connect them to form pipelines, configure parameters, and trigger generation. Phase 2 delivers the canvas infrastructure and node interaction system without model integration or workflow automation (Phase 3+).

## 2. What's In / Out

| Scope | Items |
|-------|-------|
| **In** | @xyflow/react controlled canvas, text/image/video nodes, solid edge connections, dual-state image node, floating config panel, 3-layer Zustand state, localStorage cache, backend persistence |
| **Out** | Model configuration & pricing, workflow orchestration, Socket.io real-time sync, Keycloak auth, credit deduction |

## 3. Node Design: Dual-State Split Architecture

### 3.1 Node Types

Three independent node types with standard input/output ports:

| Node | Left Port | Right Port | Purpose |
|------|-----------|------------|---------|
| Text Input Node | Input | **Output** | Write AI Prompt |
| Image Gen Node | **Input** | **Output** | Generate images from upstream Prompt |
| Video Gen Node | **Input** | **Output** | Generate videos (placeholder in P2) |

### 3.2 Image Node: Dual State

**Inactive (default):**
- Large image preview area (200px+)
- No inline button, no config panel
- Standard ports visible
- Gray border, no highlight

**Active (selected):**
- Blue highlight border + glow shadow
- Floating config panel expands below node
- Panel contains: style tags, supplementary Prompt input, model dropdown, resolution dropdown, generation count, credit display, circular ▶ execute button (bottom-right)
- Ports highlighted

### 3.3 Edge Connections

- Solid lines, no animated dots
- Color follows upstream node theme
- Bezier curves between ports
- Standard input (left) / output (right) ports on all nodes

### 3.4 Connection Validation

```
✅ text.output  → image.input    (Prompt pass-through)
✅ text.output  → video.input    (Prompt pass-through)
✅ image.output → image.input    (image-to-image)
✅ image.output → video.input    (image-to-video)
❌ image.output → text.input     (text nodes don't accept image input)
❌ video.output → text.input
❌ self-connection (source === target)
```

### 3.5 Execution Flow

1. User clicks image node → activates → config panel appears
2. User adjusts parameters in panel (or uses defaults)
3. Clicks ▶ button in panel
4. System reads upstream text node Prompt → applies config params
5. Calls AI API (Phase 3) → displays result in preview area

## 4. Architecture

### 4.1 Data Flow

> 【2026-10-05 指针】本节数据流（localStorage 缓存+REST 防抖同步）已由 Yjs 协同文档+服务端 doc 持久化取代，见 specs/2026-09-29-collab-conn-status-recovery-design.md。

```
User Interaction → @xyflow/react (controlled mode)
    ↕
Zustand Stores (canvasStore / nodeStore / sharedStore)
    ↕
localStorage (instant cache) + Backend API (debounced 500ms)
```

### 4.2 Zustand Stores

**canvasStore — Canvas global state:**
```typescript
interface CanvasState {
  nodes: Node[]
  edges: Edge[]
  viewport: { x: number; y: number; zoom: number }
  selectedId: string | null

  onNodesChange: (changes) => void
  onEdgesChange: (changes) => void
  onConnect: (connection) => void
  addNode: (type, position) => void
  deleteNode: (id) => void
  selectNode: (id) => void
  updateViewport: (viewport) => void
  undo: () => void
  redo: () => void
}
```

**nodeStore — Per-node content state:**
```typescript
interface NodeState {
  nodes: Record<string, NodeData>

  updateText: (id, text) => void
  updateConfig: (id, config) => void
  getUpstreamPrompt: (id) => string
}

type NodeData = TextNodeData | ImageNodeData | VideoNodeData

interface TextNodeData {
  type: 'text'
  content: string
}

interface ImageNodeData {
  type: 'image'
  style: string
  extraPrompt: string
  model: string
  resolution: string
  count: number
  resultUrl?: string
  status: 'idle' | 'loading' | 'done' | 'error'
}
```

**sharedStore — Cross-cutting business data:**
```typescript
interface SharedState {
  modelList: Model[]
  userCredits: number
  fetchModels: () => Promise<void>
}
```

### 4.3 @xyflow/react Integration

- **Controlled mode**: nodes and edges managed externally via Zustand
- `onNodesChange` / `onEdgesChange` / `onConnect` → dispatch to canvasStore
- Custom node types: `textInput`, `imageGen`, `videoGen`
- Custom edge type: solid bezier line
- `isValidConnection` hook for edge validation

## 5. Prisma Schema (Phase 2 Additions)

```prisma
model CanvasProject {
  id        String       @id @default(cuid())
  name      String
  userId    String?      // Phase 4 Keycloak
  viewport  Json         // { x, y, zoom }
  nodes     CanvasNode[]
  edges     CanvasEdge[]
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
}

model CanvasNode {
  id        String        @id @default(cuid())
  projectId String
  project   CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type      String        // 'text' | 'image' | 'video'
  position  Json          // { x, y }
  data      Json          // TextNodeData | ImageNodeData | VideoNodeData
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  @@index([projectId])
}

model CanvasEdge {
  id        String        @id @default(cuid())
  projectId String
  project   CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceId  String
  targetId  String

  @@index([projectId])
}
```

## 6. Frontend File Structure

```
apps/web/src/pages/canvas/
├── page.tsx                      // CanvasPage (replaces Phase 1 placeholder)
├── index.ts
├── components/
│   ├── CanvasView.tsx            // ReactFlow wrapper
│   ├── NodePalette.tsx           // Left sidebar drag sources
│   ├── CanvasToolbar.tsx         // Bottom zoom/fit controls
│   ├── nodes/
│   │   ├── TextInputNode.tsx     // Text input custom node
│   │   ├── ImageGenNode.tsx      // Image gen custom node (dual-state)
│   │   ├── ImageConfigPanel.tsx  // Floating config panel
│   │   └── VideoGenNode.tsx      // Video gen custom node (placeholder)
│   └── edges/
│       └── ConnectionLine.tsx    // Custom edge (solid line)
├── stores/
│   ├── canvasStore.ts
│   └── nodeStore.ts
└── api/
    └── projectApi.ts
```

## 7. Backend API

> 【2026-10-05 指针】本节 REST 批量同步端点（nodes/edges 批量 PUT）已随 REST 画布链路退役；现行=项目 CRUD 元数据 + Yjs doc 持久化，见 specs/2026-09-29-collab-conn-status-recovery-design.md。

**New module:** `apps/api/src/modules/project/`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Load project (nodes + edges) |
| PUT | `/api/projects/:id` | Update viewport |
| PUT | `/api/projects/:id/nodes` | Batch sync nodes (debounced) |
| PUT | `/api/projects/:id/edges` | Batch sync edges (debounced) |
| DELETE | `/api/projects/:id` | Delete project |

**Response format:** Same as Phase 1 — `{ code: 0, data: T, message: "ok" }`

## 8. Persistence Strategy

> 【2026-10-05 指针】本节机制（localStorage 增量+防抖 REST 快照）已由服务端 doc 持久化取代（CanvasDoc 增量日志+快照），见 specs/2026-09-29-collab-conn-status-recovery-design.md。

| Layer | Mechanism | Trigger | Data |
|-------|-----------|---------|------|
| Frontend cache | localStorage incremental | Auto on edit | Node content (TextNodeData / ImageNodeData) |
| Backend persist | Debounced API sync (500ms) | On nodes/edges/viewport change | Full state snapshot |

Page refresh restores from localStorage first, then server sync.

## 9. Testing Strategy (TDD)

- Unified Vitest across frontend and backend
- Component tests: @testing-library/react for custom nodes
- Store tests: Zustand actions/state verification
- Backend: @nestjs/testing + supertest
- NO production code without failing test first

## 10. What's NOT in Phase 2

- Model configuration management (admin panel)
- Multi-model pricing rules
- Workflow automation execution (topological order)
- Socket.io real-time sync
- Credit deduction
- Keycloak user authentication
- Video node full implementation (placeholder only)
