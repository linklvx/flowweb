<!-- doc-status: historical | superseded-by: plans/2026-09-30-collab-recovery-master-plan.md | verified_at: n/a | note: 扣费与执行数据流任务已死，现行机制见 tech-debt.md -->
# Phase 4: Execution Pipeline + Credit System + Real-time Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⛔ 本 plan 已完成（历史档）。【2026-10-05 校准】扣费=TeamCreditService `reserve→settle/void`（TeamBalance 双池，UserBalance 乐观锁已死）；执行=同步 HTTP 与 BullMQ **并存**（TD-18 未做）+ GenerationIntent 幂等 + 读 doc 真实节点；socket=/execution **仍为现行通道**（TD-21 分两步退役）。

**Goal:** Build the complete generation execution loop: user clicks generate → pre-validation → topological execution → mock API call → optimistic-lock credit deduction → Socket.io real-time broadcast → frontend status/result/balance update.

**Architecture:** NestJS execution pipeline (validation → topology → api-call → deduction) with Socket.io `/execution` namespace for real-time sync. Prisma transaction guards credit deduction + result save. Frontend listens to WebSocket events for live status updates.

**Tech Stack:** NestJS 10.4.18, Prisma 5.22.0, Socket.io 4.x, @nestjs/websockets, Zustand 4.5.5, React 18.3.1, Vitest

---

## File Structure Map

```
Modified files:
  apps/api/prisma/schema.prisma                     [Add UserBalance]
  apps/api/src/app.module.ts                        [Nothing — gateways auto-register]
  apps/web/src/pages/canvas/page.tsx                [Socket.io connect on mount]
  apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx  [Wire execute]
  apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx      [Socket listener]
  apps/web/src/pages/home/components/Navbar.tsx     [Credit display]

New files:
  # Backend — Credit
  apps/api/src/modules/credit/
    credit.service.ts, credit.controller.ts, credit.module.ts, *.spec.ts

  # Backend — Execution Engine
  apps/api/src/modules/execution/
    execution.service.ts, execution.controller.ts, execution.module.ts, *.spec.ts
    topology.service.ts, topology.service.spec.ts
    validation.service.ts, validation.service.spec.ts
    api-caller.service.ts, api-caller.service.spec.ts

  # Backend — WebSocket Gateway
  apps/api/src/modules/gateway/
    execution.gateway.ts, execution.gateway.spec.ts

  # Frontend
  apps/web/src/hooks/useSocket.ts
  apps/web/src/api/executionApi.ts
```

---

## Group 1: Database + Infrastructure

### Task 1: UserBalance Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — add UserBalance model

- [ ] **Step 1: Add model to schema**

Read the existing schema and APPEND:

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

- [ ] **Step 2: Generate migration + prisma client**

```bash
cd apps/api && npx prisma migrate dev --name add_user_balance
# OR if DB not running:
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/add_user_balance/migration.sql
npx prisma generate
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: add UserBalance model with optimistic lock version field"
```

---

### Task 2: Socket.io Gateway Setup

**Files:**
- Create: `apps/api/src/modules/gateway/execution.gateway.ts`
- Create: `apps/api/src/modules/gateway/execution.gateway.spec.ts`

- [ ] **Step 1: Install Socket.io dependencies**

```bash
cd apps/api && pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

- [ ] **Step 2: Write FAILING test for ExecutionGateway**

```typescript
// execution.gateway.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionGateway } from './execution.gateway';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ExecutionGateway', () => {
  let gateway: ExecutionGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecutionGateway],
    }).compile();
    gateway = module.get<ExecutionGateway>(ExecutionGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('should have server instance after init', () => {
    expect(gateway.server).toBeDefined();
  });
});
```

Run → FAIL.

- [ ] **Step 3: Implement ExecutionGateway**

```typescript
// execution.gateway.ts
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/execution', cors: { origin: '*' } })
export class ExecutionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    // Client connected
  }

  handleDisconnect(client: Socket) {
    // Client disconnected
  }

  @SubscribeMessage('join')
  handleJoin(client: Socket, projectId: string) {
    client.join(`project:${projectId}`);
  }

  emitNodeStatus(projectId: string, data: {
    nodeId: string;
    status: 'loading' | 'done' | 'error';
    resultUrl?: string;
    error?: string;
    credits?: number;
  }) {
    this.server.to(`project:${projectId}`).emit('node:status', data);
  }

  emitExecutionComplete(projectId: string, data: { totalCost: number }) {
    this.server.to(`project:${projectId}`).emit('execution:complete', data);
  }
}
```

Run test → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/gateway/ apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add Socket.io execution gateway with /execution namespace"
```

---

### Task 3: Credit Service + Controller

**Files:**
- Create: `apps/api/src/modules/credit/credit.service.ts`, `credit.controller.ts`, `credit.module.ts`
- Create corresponding `*.spec.ts` files

- [ ] **Step 1: Write FAILING test for CreditService**

```typescript
// credit.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { CreditService } from './credit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CreditService', () => {
  let service: CreditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      userBalance: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<CreditService>(CreditService);
  });

  it('should get balance for existing user', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 85, version: 3 });
    const result = await service.getBalance('u1');
    expect(result.credits).toBe(85);
  });

  it('should create default balance for new user', async () => {
    prisma.userBalance.findUnique.mockResolvedValue(null);
    prisma.userBalance.upsert.mockResolvedValue({ userId: 'u1', credits: 100, version: 0 });
    const result = await service.getOrCreateBalance('u1');
    expect(result.credits).toBe(100);
  });

  it('should deduct credits with optimistic locking', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100, version: 2 });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.deduct('u1', 5);
    expect(result.success).toBe(true);
    expect(prisma.userBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', version: 2 },
      data: { credits: { decrement: 5 }, version: { increment: 1 } },
    });
  });

  it('should return success=false on version mismatch', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100, version: 2 });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.deduct('u1', 5);
    expect(result.success).toBe(false);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement CreditService**

```typescript
// credit.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getBalance(userId: string) {
    return this.prisma.userBalance.findUnique({ where: { userId } });
  }

  async getOrCreateBalance(userId: string) {
    return this.prisma.userBalance.upsert({
      where: { userId },
      create: { userId, credits: 100 },
      update: {},
    });
  }

  async deduct(userId: string, cost: number): Promise<{ success: boolean; newBalance?: number }> {
    const current = await this.prisma.userBalance.findUnique({ where: { userId } });
    if (!current) return { success: false };
    if (current.credits < cost) return { success: false };

    const result = await this.prisma.userBalance.updateMany({
      where: { userId, version: current.version },
      data: { credits: { decrement: cost }, version: { increment: 1 } },
    });

    if (result.count === 0) return { success: false };

    const updated = await this.prisma.userBalance.findUnique({ where: { userId } });
    return { success: true, newBalance: updated!.credits };
  }
}
```

- [ ] **Step 3: Implement CreditController + CreditModule**

```typescript
// credit.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { CreditService } from './credit.service';

@Controller('api/credits')
export class CreditController {
  constructor(private readonly service: CreditService) {}

  @Get('balance')
  async getBalance(@Query('userId') userId: string) {
    const balance = await this.service.getOrCreateBalance(userId || 'default-user');
    return { credits: balance.credits };
  }
}
```

```typescript
// credit.module.ts
import { Module } from '@nestjs/common';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';

@Module({
  controllers: [CreditController],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
```

- [ ] **Step 4: Add CreditModule to AppModule and run tests**

Read `apps/api/src/app.module.ts`, add `CreditModule` to imports.

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/credit/ apps/api/src/app.module.ts
git commit -m "feat: add credit service with optimistic lock deduction"
```

---

## Group 2: Execution Engine Components

### Task 4: Topology Service

**Files:**
- Create: `apps/api/src/modules/execution/topology.service.ts`
- Create: `apps/api/src/modules/execution/topology.service.spec.ts`

- [ ] **Step 1: Write FAILING test**

```typescript
// topology.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TopologyService } from './topology.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('TopologyService', () => {
  let service: TopologyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TopologyService],
    }).compile();
    service = module.get<TopologyService>(TopologyService);
  });

  it('should return topological order for simple chain: text→image', () => {
    const nodes = [
      { id: 'n1', type: 'textInput', position: {}, data: { content: 'hello' } },
      { id: 'n2', type: 'imageGen', position: {}, data: { model: 'm1' } },
    ];
    const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
    const order = service.sort(nodes as any, edges as any);
    expect(order.map(n => n.id)).toEqual(['n1', 'n2']);
  });

  it('should find upstream nodes for a given nodeId', () => {
    const nodes = [
      { id: 'n1', type: 'textInput' }, { id: 'n2', type: 'textInput' }, { id: 'n3', type: 'imageGen' },
    ];
    const edges = [
      { id: 'e1', source: 'n1', target: 'n3' }, { id: 'e2', source: 'n2', target: 'n3' },
    ];
    const scope = service.getScope(nodes as any, edges as any, 'n3');
    expect(scope.map(n => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('should collect upstream data — text content concatenation', () => {
    const nodes = [
      { id: 'n1', type: 'textInput', data: { content: '一只猫' } },
      { id: 'n2', type: 'textInput', data: { content: '坐在窗台上' } },
      { id: 'n3', type: 'imageGen', data: {} },
    ];
    const edges = [{ source: 'n1', target: 'n3' }, { source: 'n2', target: 'n3' }];
    const upstream = service.collectUpstreamData('n3', nodes as any, edges as any);
    expect(upstream.textContents).toContain('一只猫');
    expect(upstream.textContents).toContain('坐在窗台上');
  });

  it('should collect upstream image resultUrl for img2img', () => {
    const nodes = [
      { id: 'n1', type: 'imageGen', data: { resultUrl: '/img/cat.jpg' } },
      { id: 'n2', type: 'imageGen', data: {} },
    ];
    const edges = [{ source: 'n1', target: 'n2' }];
    const upstream = service.collectUpstreamData('n2', nodes as any, edges as any);
    expect(upstream.imageUrl).toBe('/img/cat.jpg');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement TopologyService**

```typescript
// topology.service.ts
import { Injectable } from '@nestjs/common';
import { Node, Edge } from '@xyflow/react';

export interface UpstreamData {
  textContents: string[];
  imageUrl?: string;
}

@Injectable()
export class TopologyService {
  /** Topological sort (Kahn's algorithm simplified for DAG) */
  sort(nodes: Node[], edges: Edge[]): Node[] {
    const nodeIds = new Set(nodes.map(n => n.id));
    const inDegree: Record<string, number> = {};
    const adjacency: Record<string, string[]> = {};

    for (const id of nodeIds) { inDegree[id] = 0; adjacency[id] = []; }
    for (const e of edges) {
      if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
        adjacency[e.source].push(e.target);
        inDegree[e.target] = (inDegree[e.target] || 0) + 1;
      }
    }

    const queue = Object.entries(inDegree).filter(([, d]) => d === 0).map(([id]) => id);
    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      for (const neighbor of adjacency[current] || []) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) queue.push(neighbor);
      }
    }

    return result.map(id => nodes.find(n => n.id === id)!).filter(Boolean);
  }

  /** Get all nodes in scope: target node + all upstream dependencies */
  getScope(nodes: Node[], edges: Edge[], nodeId: string): Node[] {
    const upstreamIds = this.getUpstreamIds(nodeId, edges);
    upstreamIds.add(nodeId);
    return nodes.filter(n => upstreamIds.has(n.id));
  }

  private getUpstreamIds(nodeId: string, edges: Edge[], visited = new Set<string>()): Set<string> {
    const parents = edges.filter(e => e.target === nodeId).map(e => e.source);
    for (const p of parents) {
      if (!visited.has(p)) {
        visited.add(p);
        this.getUpstreamIds(p, edges, visited);
      }
    }
    return visited;
  }

  /** Collect data from all upstream nodes for injection */
  collectUpstreamData(nodeId: string, nodes: Node[], edges: Edge[]): UpstreamData {
    const upstreamEdges = edges.filter(e => e.target === nodeId);
    const textContents: string[] = [];
    let imageUrl: string | undefined;

    for (const e of upstreamEdges) {
      const upstream = nodes.find(n => n.id === e.source);
      if (!upstream) continue;
      const data = upstream.data as any;

      if (upstream.type === 'textInput' && data?.content) {
        textContents.push(data.content);
      } else if ((upstream.type === 'imageGen' || upstream.type === 'videoGen') && data?.resultUrl) {
        imageUrl = data.resultUrl; // Take the first available image
      }
    }

    return { textContents, imageUrl };
  }
}
```

Run test → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/execution/topology.service.ts apps/api/src/modules/execution/topology.service.spec.ts
git commit -m "feat: add topology service with sort, scope, and upstream data collection"
```

---

### Task 5: Validation Service

**Files:**
- Create: `apps/api/src/modules/execution/validation.service.ts`
- Create: `apps/api/src/modules/execution/validation.service.spec.ts`

- [ ] **Step 1: Write FAILING test**

```typescript
// validation.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationService } from './validation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ValidationService', () => {
  let service: ValidationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aIModel: { findMany: vi.fn() },
      pricingRule: { findFirst: vi.fn() },
      userBalance: { findUnique: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ValidationService>(ValidationService);
  });

  it('should pass validation when all checks succeed', async () => {
    prisma.aIModel.findMany.mockResolvedValue([
      { id: 'm1', active: true, nodeType: { key: 'image' } },
    ]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 5 });
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100 });

    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(true);
    expect(result.totalCost).toBe(5);
  });

  it('should fail when model not found or inactive', async () => {
    prisma.aIModel.findMany.mockResolvedValue([]);
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('模型');
  });

  it('should fail when pricing rule not found', async () => {
    prisma.aIModel.findMany.mockResolvedValue([
      { id: 'm1', active: true, nodeType: { key: 'image' } },
    ]);
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    const nodes = [{ id: 'n1', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } }];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('定价规则');
  });

  it('should fail when balance insufficient', async () => {
    prisma.aIModel.findMany.mockResolvedValue([
      { id: 'm1', active: true, nodeType: { key: 'image' } },
    ]);
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 50 });
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 10 });
    const nodes = [
      { id: 'n1', type: 'imageGen', data: { model: 'm1' } },
      { id: 'n2', type: 'imageGen', data: { model: 'm1' } },
    ];
    const result = await service.validateAll(nodes as any, 'u1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('余额');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement ValidationService**

```typescript
// validation.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Node } from '@xyflow/react';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalCost: number;
}

@Injectable()
export class ValidationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async validateAll(nodes: Node[], userId: string): Promise<ValidationResult> {
    const errors: string[] = [];
    let totalCost = 0;

    // Get all model IDs from nodes
    const modelIds = [...new Set(nodes.filter(n => n.type !== 'textInput').map(n => (n.data as any)?.model).filter(Boolean))];
    
    // Check all models exist and active
    const models = await this.prisma.aIModel.findMany({
      where: { id: { in: modelIds } },
      include: { nodeType: true },
    });
    const modelMap = new Map(models.map(m => [m.id, m]));

    for (const node of nodes) {
      if (node.type === 'textInput') continue; // Text nodes don't need models
      
      const data = node.data as any;
      const model = modelMap.get(data.model);
      if (!model || !model.active) {
        errors.push(`节点 ${node.id}: 模型不存在或已下线`);
        continue;
      }

      // Check pricing rule
      const rule = await this.prisma.pricingRule.findFirst({
        where: {
          modelId: data.model,
          resolutionId: data.resolution || null,
          active: true,
        },
      });

      if (!rule) {
        errors.push(`节点 ${node.id}: 无有效定价规则 (模型=${data.model}, 分辨率=${data.resolution || '默认'})`);
        continue;
      }

      totalCost += rule.creditCost;
    }

    if (errors.length > 0) return { valid: false, errors, totalCost: 0 };

    // Check balance
    const balance = await this.prisma.userBalance.findUnique({ where: { userId } });
    if (!balance || balance.credits < totalCost) {
      return { valid: false, errors: [`余额不足: 需要 ${totalCost} 积分，当前 ${balance?.credits ?? 0} 积分`], totalCost };
    }

    return { valid: true, errors: [], totalCost };
  }
}
```

Run test → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/execution/validation.service.ts apps/api/src/modules/execution/validation.service.spec.ts
git commit -m "feat: add global pre-validation service for models, pricing, and balance"
```

---

### Task 6: API Caller Service (Mock)

**Files:**
- Create: `apps/api/src/modules/execution/api-caller.service.ts`
- Create: `apps/api/src/modules/execution/api-caller.service.spec.ts`

- [ ] **Step 1: Write FAILING test**

```typescript
// api-caller.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ApiCallerService } from './api-caller.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ApiCallerService', () => {
  let service: ApiCallerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiCallerService],
    }).compile();
    service = module.get<ApiCallerService>(ApiCallerService);
  });

  it('should return mock result with image URL after delay', async () => {
    const result = await service.callImageGen({
      prompt: '一只猫',
      extraPrompt: '阳光窗台',
      style: '写实',
      model: 'SD XL',
      resolution: '1024×1024',
    });
    expect(result.url).toContain('/mock/');
    expect(result.url).toContain('1024x1024');
  });

  it('should take at least 1 second (simulated delay)', async () => {
    const start = Date.now();
    await service.callImageGen({ prompt: 'test', model: 'SD XL' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(500);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement Mock ApiCallerService**

```typescript
// api-caller.service.ts
import { Injectable } from '@nestjs/common';

export interface ImageGenParams {
  prompt: string;
  extraPrompt?: string;
  style?: string;
  model: string;
  resolution?: string;
  imageUrl?: string; // img2img source
}

export interface ImageGenResult {
  url: string;
  width: number;
  height: number;
}

@Injectable()
export class ApiCallerService {
  async callImageGen(params: ImageGenParams): Promise<ImageGenResult> {
    // Simulate API latency
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

    const [w, h] = (params.resolution || '1024×1024').split('×').map(Number);
    
    // Return mock placeholder image URL
    const bgColor = Math.floor(Math.random() * 16777215).toString(16);
    const url = `/mock/generated_${bgColor}_${w}x${h}.jpg`;

    return { url, width: w || 1024, height: h || 1024 };
  }
}
```

Run test → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/execution/api-caller.service.ts apps/api/src/modules/execution/api-caller.service.spec.ts
git commit -m "feat: add mock API caller service for image generation"
```

---

## Group 3: Execution Orchestrator

### Task 7: Execution Service + Controller

**Files:**
- Create: `apps/api/src/modules/execution/execution.service.ts`, `execution.controller.ts`, `execution.module.ts`
- Create corresponding `*.spec.ts` files

- [ ] **Step 1: Write FAILING test for ExecutionService**

```typescript
// execution.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditService } from '../credit/credit.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionService', () => {
  let service: ExecutionService;
  let prisma: any;
  let topology: any;
  let validation: any;
  let apiCaller: any;
  let credit: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: { findUnique: vi.fn() },
      canvasNode: { update: vi.fn() },
      $transaction: vi.fn((cb: any) => cb(prisma)),
    };
    topology = {
      getScope: vi.fn().mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: 'hello' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
      ]),
      sort: vi.fn().mockReturnValue([
        { id: 'n1', type: 'textInput', data: { content: 'hello' } },
        { id: 'n2', type: 'imageGen', data: { model: 'm1', resolution: 'r1' } },
      ]),
      collectUpstreamData: vi.fn().mockReturnValue({ textContents: ['hello'], imageUrl: undefined }),
    };
    validation = { validateAll: vi.fn().mockResolvedValue({ valid: true, errors: [], totalCost: 5 }) };
    apiCaller = { callImageGen: vi.fn().mockResolvedValue({ url: '/mock/test.jpg', width: 1024, height: 1024 }) };
    credit = { deduct: vi.fn().mockResolvedValue({ success: true, newBalance: 95 }) };
    gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TopologyService, useValue: topology },
        { provide: ValidationService, useValue: validation },
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: CreditService, useValue: credit },
        { provide: ExecutionGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get<ExecutionService>(ExecutionService);
  });

  it('should execute a single node and return results', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1', nodes: [], edges: [], viewport: {},
    });

    const result = await service.execute('p1', 'n2', 'default-user');
    expect(result.success).toBe(true);
    expect(gateway.emitNodeStatus).toHaveBeenCalled();
    expect(credit.deduct).toHaveBeenCalled();
  });

  it('should return validation error when pre-validation fails', async () => {
    validation.validateAll.mockResolvedValue({ valid: false, errors: ['余额不足'], totalCost: 0 });
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1', nodes: [], edges: [], viewport: {},
    });

    const result = await service.execute('p1', undefined, 'default-user');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('余额不足');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement ExecutionService**

```typescript
// execution.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditService } from '../credit/credit.service';
import { ExecutionGateway } from '../gateway/execution.gateway';

@Injectable()
export class ExecutionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly topology: TopologyService,
    private readonly validation: ValidationService,
    private readonly apiCaller: ApiCallerService,
    private readonly credit: CreditService,
    private readonly gateway: ExecutionGateway,
  ) {}

  async execute(projectId: string, nodeId: string | undefined, userId: string) {
    // 1. Load project
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      include: { nodes: true, edges: true },
    });
    if (!project) return { success: false, errors: ['项目不存在'] };

    const allNodes = project.nodes as any[];
    const allEdges = project.edges as any[];

    // 2. Determine scope
    const scopeNodes = nodeId
      ? this.topology.getScope(allNodes, allEdges, nodeId)
      : allNodes;

    // 3. Topological sort
    const orderedNodes = this.topology.sort(scopeNodes, allEdges);

    // 4. Global pre-validation
    const validationResult = await this.validation.validateAll(orderedNodes, userId);
    if (!validationResult.valid) {
      return { success: false, errors: validationResult.errors };
    }

    // 5. Execute sequentially
    let totalCreditsDeducted = 0;
    for (const node of orderedNodes) {
      // Emit loading
      this.gateway.emitNodeStatus(projectId, { nodeId: node.id, status: 'loading' });

      try {
        if (node.type === 'textInput') {
          // Text nodes: pass through
          this.gateway.emitNodeStatus(projectId, {
            nodeId: node.id, status: 'done',
            credits: (await this.credit.getBalance(userId))?.credits,
          });
          continue;
        }

        // Collect upstream data
        const upstream = this.topology.collectUpstreamData(node.id, scopeNodes, allEdges);

        // Call API
        const prompt = upstream.textContents.join(' ') || (node.data as any)?.content || '';
        const imageUrl = upstream.imageUrl;

        const result = await this.apiCaller.callImageGen({
          prompt,
          extraPrompt: (node.data as any)?.extraPrompt,
          style: (node.data as any)?.style,
          model: (node.data as any)?.model,
          resolution: (node.data as any)?.resolution,
          imageUrl,
        });

        // Get cost
        const rule = await this.prisma.pricingRule.findFirst({
          where: {
            modelId: (node.data as any)?.model,
            resolutionId: (node.data as any)?.resolution || null,
            active: true,
          },
        });

        const cost = rule?.creditCost ?? 0;

        // Transaction: deduct + save
        if (cost > 0) {
          const deductResult = await this.credit.deduct(userId, cost);
          if (!deductResult.success) {
            this.gateway.emitNodeStatus(projectId, {
              nodeId: node.id, status: 'error', error: '扣费失败，请重试',
            });
            return { success: false, errors: [`节点 ${node.id}: 扣费失败`] };
          }
          totalCreditsDeducted += cost;
        }

        // Save result
        await this.prisma.canvasNode.update({
          where: { id: node.id },
          data: {
            data: { ...(node.data as any), resultUrl: result.url },
          },
        });

        const newBalance = await this.credit.getBalance(userId);
        this.gateway.emitNodeStatus(projectId, {
          nodeId: node.id, status: 'done',
          resultUrl: result.url, credits: newBalance?.credits,
        });

      } catch (err: any) {
        this.gateway.emitNodeStatus(projectId, {
          nodeId: node.id, status: 'error', error: err.message,
        });
        return { success: false, errors: [`节点 ${node.id}: ${err.message}`] };
      }
    }

    // 6. Complete
    this.gateway.emitExecutionComplete(projectId, { totalCost: totalCreditsDeducted });
    return { success: true, errors: [] };
  }
}
```

- [ ] **Step 3: Implement ExecutionController + ExecutionModule**

```typescript
// execution.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { ExecutionService } from './execution.service';

@Controller('api/execution')
export class ExecutionController {
  constructor(private readonly service: ExecutionService) {}

  @Post('execute')
  execute(@Body() body: { projectId: string; nodeId?: string; userId?: string }) {
    return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user');
  }
}
```

```typescript
// execution.module.ts
import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { CreditModule } from '../credit/credit.module';
import { ExecutionGateway } from '../gateway/execution.gateway';

@Module({
  imports: [CreditModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, TopologyService, ValidationService, ApiCallerService, ExecutionGateway],
  exports: [ExecutionService],
})
export class ExecutionModule {}
```

Add `ExecutionModule` to AppModule imports.

- [ ] **Step 4: Run tests → GREEN → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/execution/ apps/api/src/app.module.ts
git commit -m "feat: add execution orchestrator with full pipeline"
```

---

## Group 4: Frontend Integration

### Task 8: Socket.io Client Hook + executionApi

**Files:**
- Create: `apps/web/src/hooks/useSocket.ts`
- Create: `apps/web/src/api/executionApi.ts`

Install: `cd apps/web && pnpm add socket.io-client`

- [ ] **Step 1: Implement useSocket hook**

```typescript
// hooks/useSocket.ts
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket(projectId: string) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('/execution', {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', projectId);
    });

    return () => {
      socket.disconnect();
    };
  }, [projectId]);

  return socketRef;
}
```

- [ ] **Step 2: Implement executionApi**

```typescript
// api/executionApi.ts
import { apiFetch } from './client';

export async function executeWorkflow(projectId: string, nodeId?: string) {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeId }),
  });
}

export async function fetchBalance(): Promise<{ credits: number }> {
  return apiFetch('/credits/balance');
}
```

- [ ] **Step 3: Verify compilation + Commit**

```bash
cd apps/web && npx tsc -b --noEmit
git add apps/web/src/hooks/useSocket.ts apps/web/src/api/executionApi.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add Socket.io client hook and execution API"
```

---

### Task 9: Navbar Credit Display

**Files:**
- Modify: `apps/web/src/pages/home/components/Navbar.tsx`

- [ ] **Step 1: Update Navbar to show credits**

Find the Navbar component and add a credit display. Read the current file and add:

Import: `import { useState, useEffect } from 'react';`

Add state + effect:
```typescript
const [credits, setCredits] = useState<number | null>(null);

useEffect(() => {
  fetch('/api/credits/balance')
    .then(r => r.json())
    .then(json => { if (json.code === 0) setCredits(json.data.credits); })
    .catch(() => {});
}, []);
```

Add credit display between the logo and nav actions:
```tsx
{credits !== null && (
  <div className="text-xs text-[#f59e0b] mr-auto ml-4">
    ⚡ {credits} 积分
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/home/components/Navbar.tsx
git commit -m "feat: add credit balance display to Navbar"
```

---

### Task 10: ImageConfigPanel — Execute Button Wiring

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`

- [ ] **Step 1: Wire the ▶ button to execution API**

Read the current file and update the `handleGenerate` function:

```typescript
import { executeWorkflow } from '@/api/executionApi';

// Add state
const [executing, setExecuting] = useState(false);

// Replace handleGenerate:
const handleGenerate = useCallback(async () => {
  setExecuting(true);
  setStatus(nodeId, 'loading');
  try {
    const result = await executeWorkflow('default', nodeId);
    if (!result.success) {
      setStatus(nodeId, 'error');
      // Error will be shown via Socket.io / toast
    }
  } catch (e: any) {
    setStatus(nodeId, 'error');
  } finally {
    setExecuting(false);
  }
}, [nodeId, setStatus]);
```

Update the execute button to show disabled state:
```tsx
<button
  onClick={handleGenerate}
  disabled={executing}
  className={`w-9 h-9 text-black font-bold text-lg rounded-full flex items-center justify-center cursor-pointer border-none shadow-md transition-colors ${
    executing ? 'bg-gray-500 cursor-not-allowed' : 'bg-[#4ade80] hover:bg-[#22c55e] shadow-[#4ade80]/30'
  }`}
>
  {executing ? '⏳' : '▶'}
</button>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx
git commit -m "feat: wire ImageConfigPanel execute button to execution API"
```

---

### Task 11: ImageGenNode — Socket.io Real-time Status

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] **Step 1: Add Socket.io listener for node status**

Read the current file and add Socket.io listener:

```typescript
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';

// In the component, add:
useEffect(() => {
  const socket = io('/execution', { transports: ['websocket', 'polling'] });
  
  socket.on('connect', () => {
    socket.emit('join', 'default');
  });

  socket.on('node:status', (data: any) => {
    if (data.nodeId !== id) return;
    
    if (data.status === 'loading') {
      useNodeStore.getState().setStatus(id, 'loading');
    } else if (data.status === 'done' && data.resultUrl) {
      useNodeStore.getState().setResult(id, data.resultUrl);
    } else if (data.status === 'error') {
      useNodeStore.getState().setStatus(id, 'error');
    }

    // Update Navbar credits
    if (data.credits !== undefined) {
      window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
    }
  });

  return () => { socket.disconnect(); };
}, [id]);
```

- [ ] **Step 2: Update Navbar to listen for credit updates**

Add to Navbar:
```typescript
useEffect(() => {
  const handler = (e: CustomEvent) => setCredits(e.detail);
  window.addEventListener('credits:update', handler as EventListener);
  return () => window.removeEventListener('credits:update', handler as EventListener);
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/home/components/Navbar.tsx
git commit -m "feat: add Socket.io real-time status listener to ImageGenNode and Navbar"
```

---

### Task 12: CanvasPage — Socket.io Initialization

**Files:**
- Modify: `apps/web/src/pages/canvas/page.tsx`

- [ ] **Step 1: Add useSocket hook to CanvasPage**

Read the current file and add:

```typescript
import { useSocket } from './hooks/useSocket';

// Inside CanvasPage function:
useSocket('default');
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/canvas/page.tsx
git commit -m "feat: initialize Socket.io connection on canvas page mount"
```

---

## Group 5: Seed + Integration

### Task 13: Database Seed — UserBalance

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Add default user balance to seed**

Read the existing seed and APPEND:

```typescript
// ====== Phase 4: Default User Balance ======
await prisma.userBalance.upsert({
  where: { userId: 'default-user' },
  update: {},
  create: { userId: 'default-user', credits: 100, version: 0 },
});

console.log('Seed complete: Phase 1 cards + Phase 3 models + Phase 4 user balance');
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat: seed default user balance (100 credits)"
```

---

### Task 14: Full Stack Integration Verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 3: Verify file structure — all expected files exist**

Backend: credit/ (3 files), execution/ (8 files), gateway/ (2 files)
Frontend: useSocket.ts, executionApi.ts
Modified: ImageConfigPanel, ImageGenNode, Navbar, CanvasPage

- [ ] **Step 4: Git log summary**

```bash
git log --oneline
```

- [ ] **Step 5: Report**

All tests pass, compilation clean, all files present.

---

## Verification Checklist

- [ ] `pnpm test` — all tests pass
- [ ] TypeScript compilation clean (both packages)
- [ ] `POST /api/execution/execute` — executes workflow, returns results
- [ ] `GET /api/credits/balance` — returns user balance
- [ ] Socket.io `/execution` namespace — clients can join rooms
- [ ] `node:status` events broadcast to correct project room
- [ ] Optimistic lock prevents concurrent overspend
- [ ] Pre-validation catches missing models, pricing, insufficient balance
- [ ] Single-node execution only runs target + upstream
- [ ] ImageConfigPanel ▶ button calls execution API
- [ ] Navbar shows credit balance
- [ ] ImageGenNode updates status in real-time
