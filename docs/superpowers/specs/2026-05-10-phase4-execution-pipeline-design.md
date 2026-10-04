<!-- doc-status: historical | superseded-by: specs/2026-09-29-collab-conn-status-recovery-design.md | verified_at: n/a | note: 扣费与执行数据流章节已死，现行机制见 tech-debt.md -->
# Phase 4: Execution Pipeline + Credit System + Real-time Sync Design

> **Status:** Approved
> **Date:** 2026-05-10
> **Scope:** Workflow orchestration, validation gateway, API calling, credit account, Socket.io real-time sync — complete generation loop

## 1. Overview

Build the complete generation execution pipeline: user clicks generate → global pre-validation checks all nodes → topological sort determines execution order → nodes execute sequentially with upstream data injection → third-party API called (mock in Phase 4) → credit deducted with optimistic locking → results broadcast via Socket.io in real-time → frontend updates status/result/balance.

## 2. What's In / Out

| Scope | Items |
|-------|-------|
| **In** | UserBalance with optimistic locking, execution pipeline (pre-validation → sort → execute → deduct → broadcast), Socket.io /execution namespace, single-node + full-project execution, multi-upstream data injection, transaction-protected credit deduction, frontend real-time status/result/balance updates |
| **Out** | Top-up/recharge, transaction history, payment integration, Keycloak auth, real AI API integration (mock only), video node execution |

## 3. Database Addition

```prisma
model UserBalance {
  id        String   @id @default(cuid())
  userId    String   @unique
  credits   Int      @default(100)
  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Credit deduction uses optimistic locking via `updateMany` with version condition.

> 【2026-10-05 校准·扣费】**已死**——现行=TeamCreditService `reserve→settle/void`（TeamBalance 双池 credits+subscriptionCredits，账本唯一）；UserBalance 模型已删（commit 74b86e92）。

## 4. Backend Architecture

### 4.1 Module Structure

```
apps/api/src/modules/
├── credit/
│   ├── credit.service.ts          # Balance query + optimistic lock deduction
│   ├── credit.controller.ts       # GET /api/credits/balance
│   └── *.spec.ts
├── execution/
│   ├── execution.controller.ts    # POST /api/execution/execute
│   ├── execution.service.ts       # Orchestrator: validate → sort → execute → save
│   ├── validation.service.ts      # Global pre-validation gateway
│   ├── topology.service.ts        # Topological sort + upstream data collection
│   ├── api-caller.service.ts      # Third-party API caller (mock)
│   └── *.spec.ts
└── gateway/
    ├── execution.gateway.ts       # Socket.io /execution namespace
    └── *.spec.ts
```

### 4.2 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/credits/balance` | Get current user balance |
| POST | `/api/execution/execute` | Execute workflow (body: `{ projectId, nodeId? }`) |

### 4.3 Execution Flow

```
POST /api/execution/execute { projectId, nodeId? }
  │
  ├─ 1. Load project → nodes + edges
  ├─ 2. Determine scope: nodeId? → node + all upstream; else → all nodes
  ├─ 3. Topological sort → ordered execution list
  ├─ 4. GLOBAL PRE-VALIDATION (all nodes at once):
  │     ✓ Every node's model exists and active=true
  │     ✓ Every node's pricing rule exists and active=true
  │     ✓ Sum total credit cost ≤ user balance
  │     ✗ Any fail → return error immediately
  ├─ 5. EXECUTE (sequential, per node):
  │     for each node in order:
  │       emit node:status { status: 'loading' }
  │       collect all upstream outputs → inject as inputs
  │       call third-party API (mock)
  │       BEGIN TRANSACTION:
  │         optimistic lock credit deduction
  │         save result to canvasNode
  │       COMMIT / ROLLBACK
  │       emit node:status { status: 'done', resultUrl, credits }
  │       if error:
  │         emit node:status { status: 'error', error }
  │         abort remaining nodes
  └─ 6. emit execution:complete { totalCost }
```

> 【2026-10-05 校准·执行】同步 HTTP 与 BullMQ 队列**并存**（TD-18 统一入队未做）；幂等与在飞互斥由 GenerationIntent 表承载；执行读 Yjs doc 真实节点（非 REST 行式模型）；`execution:complete` 载荷已死（零消费，随 TD-21 退役清理）。

### 4.4 Multi-Upstream Data Injection

| Node Type | Injection Strategy |
|-----------|-------------------|
| Text | Concatenate all upstream text node `content` values |
| Image | Upstream image node → `resultUrl` as img2img input; Upstream text node → `content` as prompt |
| Video | Same priority: upstream video/image `resultUrl` + text `content` |

### 4.5 Optimistic Locking Pattern

```typescript
const current = await prisma.userBalance.findUnique({ where: { userId } });
const result = await prisma.userBalance.updateMany({
  where: { userId, version: current.version },
  data: { credits: { decrement: cost }, version: { increment: 1 } },
});
if (result.count === 0) throw new ConcurrencyException('请重试');
```

### 4.6 Transaction Guarantee

API call success → in one Prisma transaction: deduct credits + save result. If deduction fails (version mismatch), rollback and retry.

### 4.7 Mock API Caller

Return fixed placeholder image URL after simulated delay (1-2 seconds). Interface designed for real API replacement in production.

## 5. Socket.io Design

### 5.1 Namespace: `/execution`

> 【2026-10-05 校准·socket】/execution **仍为现行通道**（node:status 主路径 dual-write 已落）；退役计划见 TD-21（保留+冻结分两步）——非"已退役"。

### 5.2 Events

```
Client → Server:
  join                          // Auto-join project room on CanvasPage mount

Server → Client (room: project:{projectId}):
  node:status {
    nodeId: string
    status: 'loading' | 'done' | 'error'
    resultUrl?: string
    error?: string
    credits?: number            // Remaining balance after deduction
  }
  execution:complete {
    totalCost: number
  }
```

### 5.3 Client Behavior

- On CanvasPage mount → emit `join` with projectId → join room `project:{projectId}`
- On disconnect → Socket.io auto-reconnect → re-emit `join`
- Listen to `node:status` → update nodeStore (status/resultUrl)
- Listen to `node:status.credits` → update navbar balance display

## 6. Frontend Changes

### 6.1 ImageConfigPanel — Execute Button

- Click ▶ → call `POST /api/execution/execute { projectId, nodeId }`
- During execution: `disabled=true`, show spinner
- On complete: re-enable button

### 6.2 ImageGenNode — Real-time Status

- Listen to `node:status` via Socket.io
- `loading` → show "生成中..." spinner
- `done` → show result image
- `error` → show error message
- Update resultUrl in nodeStore

### 6.3 Navbar — Credit Display

- Show current balance (fetched from `GET /api/credits/balance`)
- Auto-update on `node:status` credits field
- Link to future top-up page

### 6.4 New Files

```
apps/web/src/
├── hooks/
│   └── useSocket.ts              # Socket.io connection hook
├── api/
│   └── executionApi.ts           # executeWorkflow + fetchBalance
```

### 6.5 Modified Files

- `ImageConfigPanel.tsx` — wired to execution API + button state
- `ImageGenNode.tsx` — Socket.io listener for real-time status
- `Navbar.tsx` — credit balance display
- `canvasStore.ts` — add node status update from Socket.io
- `nodeStore.ts` — add setStatus/setResult (already exists, verify)
- `CanvasPage.tsx` — initialize Socket.io connection

## 7. Testing Strategy (TDD)

- Backend: @nestjs/testing for services, @nestjs/websockets for gateway, supertest for controllers
- Frontend: @testing-library/react + vitest, mock Socket.io client
- Key test scenarios:
  - Optimistic lock prevents concurrent overspend
  - Pre-validation catches all errors before any node executes
  - Single-node execution only runs target + upstream
  - Full-project execution runs all nodes in topological order
  - Multi-upstream injection correctly merges data
  - Transaction rollback on deduction failure
  - Socket.io events broadcast to correct room

## 8. What's NOT in Phase 4

- Top-up/recharge flow
- Transaction history/audit log
- Payment gateway integration
- Keycloak user authentication
- Real AI API integration (mock placeholder)
- Video node execution (only text + image nodes execute)
- BullMQ job queue (execute synchronously in HTTP request)
