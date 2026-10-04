<!-- doc-status: historical | verified_at: n/a -->
# Phase 3: Model Configuration & Pricing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build admin model management with multi-dimensional pricing engine and integrate dynamic model selection into the frontend ImageConfigPanel.

**Architecture:** 5 new Prisma models (NodeType → AIModel → ModelResolution/ModelDuration → PricingRule) with admin CRUD APIs. Public API for frontend model list loading and real-time credit calculation. ImageConfigPanel updated to load models dynamically.

**Tech Stack:** NestJS 10.4.18, Prisma 5.22.0, PostgreSQL 16, React 18.3.1, Zustand 4.5.5, Vitest

---

## File Structure Map

```
Modified files:
  apps/api/prisma/schema.prisma                [Add 5 models]
  apps/api/src/app.module.ts                   [Add AdminModule]
  apps/web/src/router.tsx                      [Add /admin route]
  apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx  [Dynamic model loading]

New files:
  # Backend — Admin Module
  apps/api/src/modules/admin/
    admin.module.ts
    node-type/
      node-type.controller.ts, node-type.service.ts, *.spec.ts
    model/
      model.controller.ts, model.service.ts, *.spec.ts
    pricing/
      pricing.controller.ts, pricing.service.ts, *.spec.ts
    public/
      public.controller.ts, public.service.ts, *.spec.ts

  # Frontend — Admin Pages
  apps/web/src/pages/admin/
    page.tsx, index.ts, page.test.tsx
    components/
      NodeTypeTabs.tsx, NodeTypeTabs.test.tsx
      ModelTable.tsx, ModelTable.test.tsx
      ModelFormModal.tsx, ModelFormModal.test.tsx
      PricingRuleTable.tsx, PricingRuleTable.test.tsx
      PricingRuleFormModal.tsx, PricingRuleFormModal.test.tsx

  # Frontend — API
  apps/web/src/api/adminApi.ts
  apps/web/src/api/pricingApi.ts
```

---

## Group 1: Database

### Task 1: Prisma Schema Migration — 5 New Models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Append 5 models to schema.prisma**

```prisma
model NodeType {
  id          String     @id @default(cuid())
  name        String
  key         String     @unique
  description String?
  active      Boolean    @default(true)
  models      AIModel[]
  pricingRules PricingRule[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

model AIModel {
  id          String     @id @default(cuid())
  nodeTypeId  String
  nodeType    NodeType   @relation(fields: [nodeTypeId], references: [id], onDelete: Cascade)
  name        String
  provider    String
  apiUrl      String
  apiKey      String?
  sortOrder   Int        @default(0)
  recommended Boolean    @default(false)
  active      Boolean    @default(true)
  resolutions ModelResolution[]
  durations   ModelDuration[]
  pricingRules PricingRule[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([nodeTypeId, active])
  @@index([nodeTypeId, sortOrder])
}

model ModelResolution {
  id        String      @id @default(cuid())
  modelId   String
  model     AIModel     @relation(fields: [modelId], references: [id], onDelete: Cascade)
  label     String
  width     Int
  height    Int
  pricingRules PricingRule[]
  createdAt DateTime    @default(now())

  @@index([modelId])
}

model ModelDuration {
  id        String      @id @default(cuid())
  modelId   String
  model     AIModel     @relation(fields: [modelId], references: [id], onDelete: Cascade)
  label     String
  seconds   Int
  pricingRules PricingRule[]
  createdAt DateTime    @default(now())

  @@index([modelId])
}

model PricingRule {
  id           String          @id @default(cuid())
  nodeTypeId   String
  nodeType     NodeType        @relation(fields: [nodeTypeId], references: [id], onDelete: Cascade)
  modelId      String
  model        AIModel         @relation(fields: [modelId], references: [id], onDelete: Cascade)
  resolutionId String?
  resolution   ModelResolution? @relation(fields: [resolutionId], references: [id])
  durationId   String?
  duration     ModelDuration?   @relation(fields: [durationId], references: [id])
  creditCost   Int
  active       Boolean         @default(true)
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@unique([nodeTypeId, modelId, resolutionId, durationId])
  @@index([nodeTypeId])
  @@index([modelId])
}
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add_model_pricing_tables
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: add NodeType, AIModel, ModelResolution, ModelDuration, PricingRule models"
```

---

## Group 2: Backend Admin APIs

### Task 2: NodeType Admin Service + Controller

**Files:**
- Create: `apps/api/src/modules/admin/admin.module.ts`
- Create: `apps/api/src/modules/admin/node-type/node-type.service.ts`
- Create: `apps/api/src/modules/admin/node-type/node-type.service.spec.ts`
- Create: `apps/api/src/modules/admin/node-type/node-type.controller.ts`
- Create: `apps/api/src/modules/admin/node-type/node-type.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` — add AdminModule

- [ ] **Step 1: Write failing test for NodeTypeService**

```typescript
// node-type.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NodeTypeService } from './node-type.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('NodeTypeService', () => {
  let service: NodeTypeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      nodeType: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeTypeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<NodeTypeService>(NodeTypeService);
  });

  it('should list all node types', async () => {
    const mock = [{ id: '1', name: '文本生成', key: 'text', active: true, createdAt: new Date(), updatedAt: new Date() }];
    prisma.nodeType.findMany.mockResolvedValue(mock);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
  });

  it('should create a node type', async () => {
    const dto = { name: '图片生成', key: 'image', description: 'AI图片生成' };
    prisma.nodeType.create.mockResolvedValue({ id: '1', ...dto, active: true, createdAt: new Date(), updatedAt: new Date() });
    const result = await service.create(dto);
    expect(result.key).toBe('image');
  });

  it('should update a node type', async () => {
    prisma.nodeType.update.mockResolvedValue({ id: '1', name: 'updated', key: 'text', active: false, createdAt: new Date(), updatedAt: new Date() });
    const result = await service.update('1', { active: false });
    expect(result.active).toBe(false);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement NodeTypeService**

```typescript
// node-type.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class NodeTypeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.nodeType.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findById(id: string) {
    return this.prisma.nodeType.findUnique({ where: { id }, include: { models: true } });
  }

  async create(data: { name: string; key: string; description?: string }) {
    return this.prisma.nodeType.create({ data });
  }

  async update(id: string, data: { name?: string; description?: string; active?: boolean }) {
    return this.prisma.nodeType.update({ where: { id }, data });
  }
}
```

- [ ] **Step 3: Write controller test + implement NodeTypeController**

```typescript
// node-type.controller.ts
import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { NodeTypeService } from './node-type.service';

@Controller('api/admin/node-types')
export class NodeTypeController {
  constructor(private readonly service: NodeTypeService) {}

  @Get()
  findAll() { return this.service.findAll(); }

  @Get(':id')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  create(@Body() body: { name: string; key: string; description?: string }) {
    return this.service.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; active?: boolean }) {
    return this.service.update(id, body);
  }
}
```

- [ ] **Step 4: Wire AdminModule + AppModule**

```typescript
// admin.module.ts
import { Module } from '@nestjs/common';
import { NodeTypeService } from './node-type/node-type.service';
import { NodeTypeController } from './node-type/node-type.controller';

@Module({
  controllers: [NodeTypeController],
  providers: [NodeTypeService],
})
export class AdminModule {}
```

Add `AdminModule` to `apps/api/src/app.module.ts` imports.

- [ ] **Step 5: Run tests → GREEN → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/admin/ apps/api/src/app.module.ts
git commit -m "feat: add NodeType admin service and controller"
```

---

### Task 3: AIModel Admin Service + Controller

**Files:**
- Create: `apps/api/src/modules/admin/model/model.service.ts`
- Create: `apps/api/src/modules/admin/model/model.controller.ts`
- Create corresponding spec files

- [ ] **Step 1: Write failing test for ModelService**

```typescript
// model.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ModelService } from './model.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ModelService', () => {
  let service: ModelService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aIModel: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      modelResolution: { create: vi.fn(), delete: vi.fn() },
      modelDuration: { create: vi.fn(), delete: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ModelService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ModelService>(ModelService);
  });

  it('should list models for a node type', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', name: 'SD XL' }]);
    const result = await service.findByNodeType('nt1');
    expect(result).toHaveLength(1);
    expect(prisma.aIModel.findMany).toHaveBeenCalledWith({
      where: { nodeTypeId: 'nt1' },
      include: { resolutions: true, durations: true },
      orderBy: { sortOrder: 'asc' },
    });
  });

  it('should create a model with resolutions and durations', async () => {
    prisma.aIModel.create.mockResolvedValue({ id: 'm1', name: 'test' });
    const result = await service.create({
      nodeTypeId: 'nt1',
      name: 'SD XL', provider: 'Stability', apiUrl: 'https://api.example.com',
      resolutions: [{ label: '1024×1024', width: 1024, height: 1024 }],
      durations: undefined,
    });
    expect(result.id).toBe('m1');
    expect(prisma.modelResolution.create).toHaveBeenCalled();
  });

  it('should toggle model active status', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: true });
    prisma.aIModel.update.mockResolvedValue({ id: 'm1', active: false });
    const result = await service.toggle('m1');
    expect(result.active).toBe(false);
  });

  it('should add resolution to model', async () => {
    prisma.modelResolution.create.mockResolvedValue({ id: 'r1', label: '2048×2048', width: 2048, height: 2048 });
    const result = await service.addResolution('m1', { label: '2048×2048', width: 2048, height: 2048 });
    expect(result.label).toBe('2048×2048');
  });

  it('should add duration to model', async () => {
    prisma.modelDuration.create.mockResolvedValue({ id: 'd1', label: '15秒', seconds: 15 });
    const result = await service.addDuration('m1', { label: '15秒', seconds: 15 });
    expect(result.seconds).toBe(15);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement ModelService**

```typescript
// model.service.ts
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface CreateModelDto {
  nodeTypeId: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey?: string;
  sortOrder?: number;
  recommended?: boolean;
  resolutions?: { label: string; width: number; height: number }[];
  durations?: { label: string; seconds: number }[];
}

@Injectable()
export class ModelService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByNodeType(nodeTypeId: string) {
    return this.prisma.aIModel.findMany({
      where: { nodeTypeId },
      include: { resolutions: true, durations: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
      include: { resolutions: true, durations: true },
    });
    if (!model) throw new NotFoundException('Model not found');
    return model;
  }

  async create(dto: CreateModelDto) {
    const { resolutions, durations, ...modelData } = dto;
    const model = await this.prisma.aIModel.create({ data: modelData });

    if (resolutions?.length) {
      for (const r of resolutions) {
        await this.prisma.modelResolution.create({ data: { ...r, modelId: model.id } });
      }
    }
    if (durations?.length) {
      for (const d of durations) {
        await this.prisma.modelDuration.create({ data: { ...d, modelId: model.id } });
      }
    }
    return this.findById(model.id);
  }

  async update(id: string, data: { name?: string; provider?: string; apiUrl?: string; sortOrder?: number; recommended?: boolean }) {
    return this.prisma.aIModel.update({ where: { id }, data });
  }

  async toggle(id: string) {
    const model = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('Model not found');
    return this.prisma.aIModel.update({ where: { id }, data: { active: !model.active } });
  }

  async delete(id: string) {
    return this.prisma.aIModel.delete({ where: { id } });
  }

  async addResolution(modelId: string, data: { label: string; width: number; height: number }) {
    return this.prisma.modelResolution.create({ data: { ...data, modelId } });
  }

  async removeResolution(id: string) {
    return this.prisma.modelResolution.delete({ where: { id } });
  }

  async addDuration(modelId: string, data: { label: string; seconds: number }) {
    return this.prisma.modelDuration.create({ data: { ...data, modelId } });
  }

  async removeDuration(id: string) {
    return this.prisma.modelDuration.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Implement ModelController**

```typescript
// model.controller.ts
import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ModelService } from './model.service';

@Controller('api/admin')
export class ModelController {
  constructor(private readonly service: ModelService) {}

  @Get('node-types/:id/models')
  findByNodeType(@Param('id') id: string) { return this.service.findByNodeType(id); }

  @Get('models/:id')
  findById(@Param('id') id: string) { return this.service.findById(id); }

  @Post('node-types/:id/models')
  create(@Param('id') nodeTypeId: string, @Body() body: any) {
    return this.service.create({ ...body, nodeTypeId });
  }

  @Put('models/:id')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Post('models/:id/toggle')
  toggle(@Param('id') id: string) { return this.service.toggle(id); }

  @Delete('models/:id')
  delete(@Param('id') id: string) { return this.service.delete(id); }

  @Post('models/:id/resolutions')
  addResolution(@Param('id') id: string, @Body() body: { label: string; width: number; height: number }) {
    return this.service.addResolution(id, body);
  }

  @Delete('models/:mid/resolutions/:rid')
  removeResolution(@Param('rid') id: string) { return this.service.removeResolution(id); }

  @Post('models/:id/durations')
  addDuration(@Param('id') id: string, @Body() body: { label: string; seconds: number }) {
    return this.service.addDuration(id, body);
  }

  @Delete('models/:mid/durations/:did')
  removeDuration(@Param('did') id: string) { return this.service.removeDuration(id); }
}
```

Update `admin.module.ts` to register `ModelService` and `ModelController`.

- [ ] **Step 4: Run tests → GREEN → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/admin/
git commit -m "feat: add AIModel admin service and controller"
```

---

### Task 4: PricingRule Admin Service + Controller

**Files:**
- Create: `apps/api/src/modules/admin/pricing/pricing.service.ts`
- Create: `apps/api/src/modules/admin/pricing/pricing.controller.ts`
- Create corresponding spec files

- [ ] **Step 1: Write failing test for PricingService**

```typescript
// pricing.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PricingService', () => {
  let service: PricingService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      pricingRule: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        upsert: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<PricingService>(PricingService);
  });

  it('should find rules with filters', async () => {
    await service.findAll({ nodeTypeId: 'nt1', modelId: 'm1' });
    expect(prisma.pricingRule.findMany).toHaveBeenCalledWith({
      where: { nodeTypeId: 'nt1', modelId: 'm1', active: undefined },
      include: { model: true, resolution: true, duration: true },
      orderBy: { creditCost: 'asc' },
    });
  });

  it('should create a pricing rule', async () => {
    prisma.pricingRule.create.mockResolvedValue({ id: 'r1', creditCost: 5 });
    const result = await service.create({
      nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 5,
    });
    expect(result.creditCost).toBe(5);
  });

  it('should calculate pricing for text node', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ id: 'r1', creditCost: 3 });
    const result = await service.calculatePrice({ modelId: 'm1' });
    expect(result).toBe(3);
  });

  it('should calculate pricing for image node (with resolution)', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ id: 'r1', creditCost: 10 });
    const result = await service.calculatePrice({ modelId: 'm1', resolutionId: 'r1' });
    expect(result).toBe(10);
  });

  it('should return 0 if no rule matches', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue(null);
    const result = await service.calculatePrice({ modelId: 'm1' });
    expect(result).toBe(0);
  });

  it('should batch create pricing rules', async () => {
    prisma.pricingRule.upsert.mockResolvedValue({ id: 'r1', creditCost: 8 });
    const rules = [
      { nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 8 },
    ];
    const result = await service.batchCreate(rules);
    expect(result).toHaveLength(1);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement PricingService**

```typescript
// pricing.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface CreateRuleDto {
  nodeTypeId: string;
  modelId: string;
  resolutionId?: string;
  durationId?: string;
  creditCost: number;
}

interface CalculateDto {
  modelId: string;
  resolutionId?: string;
  durationId?: string;
}

@Injectable()
export class PricingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll(filters: { nodeTypeId?: string; modelId?: string; active?: boolean }) {
    return this.prisma.pricingRule.findMany({
      where: {
        nodeTypeId: filters.nodeTypeId,
        modelId: filters.modelId,
        active: filters.active,
      },
      include: { model: true, resolution: true, duration: true },
      orderBy: { creditCost: 'asc' },
    });
  }

  async create(dto: CreateRuleDto) {
    return this.prisma.pricingRule.create({ data: dto });
  }

  async update(id: string, data: { creditCost?: number; active?: boolean }) {
    return this.prisma.pricingRule.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.pricingRule.delete({ where: { id } });
  }

  async batchCreate(rules: CreateRuleDto[]) {
    const results = [];
    for (const rule of rules) {
      const r = await this.prisma.pricingRule.upsert({
        where: {
          nodeTypeId_modelId_resolutionId_durationId: {
            nodeTypeId: rule.nodeTypeId,
            modelId: rule.modelId,
            resolutionId: rule.resolutionId ?? null,
            durationId: rule.durationId ?? null,
          },
        },
        update: { creditCost: rule.creditCost },
        create: {
          nodeTypeId: rule.nodeTypeId,
          modelId: rule.modelId,
          resolutionId: rule.resolutionId,
          durationId: rule.durationId,
          creditCost: rule.creditCost,
        },
      });
      results.push(r);
    }
    return results;
  }

  async calculatePrice(dto: CalculateDto): Promise<number> {
    const rule = await this.prisma.pricingRule.findFirst({
      where: {
        modelId: dto.modelId,
        resolutionId: dto.resolutionId ?? null,
        durationId: dto.durationId ?? null,
        active: true,
      },
    });
    return rule?.creditCost ?? 0;
  }
}
```

- [ ] **Step 3: Implement PricingController**

```typescript
// pricing.controller.ts
import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { PricingService } from './pricing.service';

@Controller('api/admin/pricing-rules')
export class PricingController {
  constructor(private readonly service: PricingService) {}

  @Get()
  findAll(@Query('nodeTypeId') nodeTypeId?: string, @Query('modelId') modelId?: string) {
    return this.service.findAll({ nodeTypeId, modelId });
  }

  @Post()
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  delete(@Param('id') id: string) { return this.service.delete(id); }

  @Post('batch')
  batchCreate(@Body() body: { rules: any[] }) { return this.service.batchCreate(body.rules); }
}
```

Update `admin.module.ts` to register `PricingService` and `PricingController`.

- [ ] **Step 4: Run tests → GREEN → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/admin/
git commit -m "feat: add PricingRule admin service and controller with batch upsert"
```

---

### Task 5: Public API — Model List + Price Calculator

**Files:**
- Create: `apps/api/src/modules/admin/public/public.service.ts`
- Create: `apps/api/src/modules/admin/public/public.controller.ts`
- Create corresponding spec files

- [ ] **Step 1: Write failing test for PublicService**

```typescript
// public.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PublicService } from './public.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PublicService', () => {
  let service: PublicService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      nodeType: { findUnique: vi.fn() },
      pricingRule: { findFirst: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PublicService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<PublicService>(PublicService);
  });

  it('should get models by node type key', async () => {
    prisma.nodeType.findUnique.mockResolvedValue({
      id: 'nt1',
      models: [
        {
          id: 'm1', name: 'SD XL', provider: 'Stability', active: true, recommended: true, sortOrder: 1,
          resolutions: [{ id: 'r1', label: '1024×1024', width: 1024, height: 1024 }],
          durations: [],
        },
      ],
    });
    const result = await service.getModelsByNodeKey('image');
    expect(result).toHaveLength(1);
    expect(result[0].resolutions).toHaveLength(1);
    expect(prisma.nodeType.findUnique).toHaveBeenCalledWith({
      where: { key: 'image' },
      include: {
        models: {
          where: { active: true },
          include: { resolutions: true, durations: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  });

  it('should calculate price', async () => {
    prisma.pricingRule.findFirst.mockResolvedValue({ creditCost: 8 });
    const result = await service.calculatePrice('m1', 'r1', undefined);
    expect(result).toBe(8);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement PublicService**

```typescript
// public.service.ts
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getModelsByNodeKey(key: string) {
    const nodeType = await this.prisma.nodeType.findUnique({
      where: { key },
      include: {
        models: {
          where: { active: true },
          include: { resolutions: true, durations: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!nodeType) throw new NotFoundException(`Node type '${key}' not found`);
    return nodeType.models;
  }

  async calculatePrice(modelId: string, resolutionId?: string, durationId?: string): Promise<number> {
    const rule = await this.prisma.pricingRule.findFirst({
      where: {
        modelId,
        resolutionId: resolutionId || null,
        durationId: durationId || null,
        active: true,
      },
    });
    return rule?.creditCost ?? 0;
  }
}
```

- [ ] **Step 3: Implement PublicController**

```typescript
// public.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('api')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get('node-types/:key/models')
  getModels(@Param('key') key: string) {
    return this.service.getModelsByNodeKey(key);
  }

  @Get('pricing/calculate')
  calculate(
    @Query('modelId') modelId: string,
    @Query('resolutionId') resolutionId?: string,
    @Query('durationId') durationId?: string,
  ) {
    return this.service.calculatePrice(modelId, resolutionId, durationId);
  }
}
```

Update `admin.module.ts` to register `PublicService` and `PublicController`.

- [ ] **Step 4: Run tests → GREEN → Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/modules/admin/
git commit -m "feat: add public API for model list and real-time pricing"
```

---

## Group 3: Frontend Admin Pages

### Task 6: Admin Layout + NodeTypeTabs

**Files:**
- Create: `apps/web/src/pages/admin/page.tsx`, `index.ts`
- Create: `apps/web/src/pages/admin/components/NodeTypeTabs.tsx`, `NodeTypeTabs.test.tsx`
- Create: `apps/web/src/api/adminApi.ts`

- [ ] **Step 1: Write adminApi client**

```typescript
// apps/web/src/api/adminApi.ts
import { apiFetch } from './client';

export interface NodeTypeData {
  id: string; name: string; key: string; description?: string; active: boolean;
}

export interface ModelData {
  id: string; nodeTypeId: string; name: string; provider: string; apiUrl: string;
  sortOrder: number; recommended: boolean; active: boolean;
  resolutions: { id: string; label: string; width: number; height: number }[];
  durations: { id: string; label: string; seconds: number }[];
}

export interface PricingRuleData {
  id: string; nodeTypeId: string; modelId: string;
  resolutionId?: string; durationId?: string;
  creditCost: number; active: boolean;
  model?: { name: string };
  resolution?: { label: string };
  duration?: { label: string };
}

export async function fetchNodeTypes(): Promise<NodeTypeData[]> {
  return apiFetch('/admin/node-types');
}

export async function fetchModels(nodeTypeId: string): Promise<ModelData[]> {
  return apiFetch(`/admin/node-types/${nodeTypeId}/models`);
}

export async function createModel(nodeTypeId: string, data: any): Promise<ModelData> {
  return apiFetch(`/admin/node-types/${nodeTypeId}/models`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateModel(id: string, data: any): Promise<ModelData> {
  return apiFetch(`/admin/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function toggleModel(id: string): Promise<ModelData> {
  return apiFetch(`/admin/models/${id}/toggle`, { method: 'POST' });
}

export async function deleteModel(id: string): Promise<void> {
  return apiFetch(`/admin/models/${id}`, { method: 'DELETE' });
}

export async function addResolution(modelId: string, data: { label: string; width: number; height: number }) {
  return apiFetch(`/admin/models/${modelId}/resolutions`, { method: 'POST', body: JSON.stringify(data) });
}

export async function addDuration(modelId: string, data: { label: string; seconds: number }) {
  return apiFetch(`/admin/models/${modelId}/durations`, { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchPricingRules(nodeTypeId?: string, modelId?: string): Promise<PricingRuleData[]> {
  const params = new URLSearchParams();
  if (nodeTypeId) params.set('nodeTypeId', nodeTypeId);
  if (modelId) params.set('modelId', modelId);
  return apiFetch(`/admin/pricing-rules?${params}`);
}

export async function createPricingRule(data: any): Promise<PricingRuleData> {
  return apiFetch('/admin/pricing-rules', { method: 'POST', body: JSON.stringify(data) });
}

export async function updatePricingRule(id: string, data: any): Promise<PricingRuleData> {
  return apiFetch(`/admin/pricing-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deletePricingRule(id: string): Promise<void> {
  return apiFetch(`/admin/pricing-rules/${id}`, { method: 'DELETE' });
}

export async function batchCreatePricingRules(rules: any[]) {
  return apiFetch('/admin/pricing-rules/batch', { method: 'POST', body: JSON.stringify({ rules }) });
}
```

- [ ] **Step 2: Create AdminPage + NodeTypeTabs**

```tsx
// apps/web/src/pages/admin/page.tsx
import { useState, useEffect } from 'react';
import { fetchNodeTypes, type NodeTypeData } from '@/api/adminApi';
import { NodeTypeTabs } from './components/NodeTypeTabs';
import { ModelTable } from './components/ModelTable';
import { PricingRuleTable } from './components/PricingRuleTable';

export function AdminPage() {
  const [nodeTypes, setNodeTypes] = useState<NodeTypeData[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    fetchNodeTypes().then(setNodeTypes);
  }, []);

  const activeNodeType = nodeTypes.find((nt) => nt.id === activeTab);

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-6">
      <h1 className="text-xl font-bold text-[#e2e8f0] mb-6">⚙ 模型管理后台</h1>
      {nodeTypes.length > 0 && (
        <NodeTypeTabs
          nodeTypes={nodeTypes}
          activeId={activeTab || nodeTypes[0]?.id}
          onChange={setActiveTab}
        />
      )}
      {activeNodeType && (
        <>
          <ModelTable nodeTypeId={activeNodeType.id} nodeTypeKey={activeNodeType.key} />
          <div className="mt-8">
            <PricingRuleTable nodeTypeId={activeNodeType.id} />
          </div>
        </>
      )}
    </div>
  );
}
```

```tsx
// NodeTypeTabs.tsx
import { type NodeTypeData } from '@/api/adminApi';

interface Props {
  nodeTypes: NodeTypeData[];
  activeId: string;
  onChange: (id: string) => void;
}

export function NodeTypeTabs({ nodeTypes, activeId, onChange }: Props) {
  return (
    <div className="flex gap-2 mb-6">
      {nodeTypes.map((nt) => (
        <button
          key={nt.id}
          onClick={() => onChange(nt.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            nt.id === activeId
              ? 'bg-[#4ade80] text-black'
              : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] hover:border-[#4ade80]'
          }`}
        >
          {nt.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/ apps/web/src/api/adminApi.ts
git commit -m "feat: add admin page layout with NodeTypeTabs and adminApi client"
```

---

### Task 7: ModelTable + ModelFormModal

**Files:**
- Create: `apps/web/src/pages/admin/components/ModelTable.tsx`
- Create: `apps/web/src/pages/admin/components/ModelFormModal.tsx`
- Create corresponding test files

- [ ] **Step 1: Implement ModelFormModal**

```tsx
// ModelFormModal.tsx
import { useState } from 'react';
import { type ModelData } from '@/api/adminApi';

interface Props {
  visible: boolean;
  model?: ModelData | null;
  nodeTypeKey: string;
  onSave: (data: any) => void;
  onCancel: () => void;
}

export function ModelFormModal({ visible, model, nodeTypeKey, onSave, onCancel }: Props) {
  const [name, setName] = useState(model?.name ?? '');
  const [provider, setProvider] = useState(model?.provider ?? '');
  const [apiUrl, setApiUrl] = useState(model?.apiUrl ?? '');
  const [sortOrder, setSortOrder] = useState(model?.sortOrder ?? 0);
  const [recommended, setRecommended] = useState(model?.recommended ?? false);
  const [resolutionLabel, setResolutionLabel] = useState('');
  const [resolutionW, setResolutionW] = useState(1024);
  const [resolutionH, setResolutionH] = useState(1024);
  const [resolutions, setResolutions] = useState<{ label: string; width: number; height: number }[]>(
    model?.resolutions?.map((r) => ({ label: r.label, width: r.width, height: r.height })) ?? []
  );
  const [durationLabel, setDurationLabel] = useState('');
  const [durationSec, setDurationSec] = useState(15);
  const [durations, setDurations] = useState<{ label: string; seconds: number }[]>(
    model?.durations?.map((d) => ({ label: d.label, seconds: d.seconds })) ?? []
  );

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-4">{model ? '编辑模型' : '添加模型'}</h3>
        <div className="grid gap-3">
          <input placeholder="模型名称" value={name} onChange={(e) => setName(e.target.value)} className="bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          <input placeholder="服务商" value={provider} onChange={(e) => setProvider(e.target.value)} className="bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          <input placeholder="API URL" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-[10px] text-[#888]">排序</span>
              <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc] mt-1" />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={recommended} onChange={(e) => setRecommended(e.target.checked)} />
              <span className="text-xs text-[#888]">推荐</span>
            </label>
          </div>
          {/* Resolutions */}
          {(nodeTypeKey === 'image' || nodeTypeKey === 'video') && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">分辨率</div>
              <div className="flex gap-2 mb-2">
                <input placeholder="标签" value={resolutionLabel} onChange={(e) => setResolutionLabel(e.target.value)} className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <input type="number" placeholder="宽" value={resolutionW} onChange={(e) => setResolutionW(Number(e.target.value))} className="w-20 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <input type="number" placeholder="高" value={resolutionH} onChange={(e) => setResolutionH(Number(e.target.value))} className="w-20 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <button onClick={() => { setResolutions([...resolutions, { label: resolutionLabel, width: resolutionW, height: resolutionH }]); setResolutionLabel(''); }} className="bg-[#4ade80] text-black px-2 py-1 rounded text-xs">+</button>
              </div>
              {resolutions.map((r, i) => <span key={i} className="text-[10px] text-[#60a5fa] mr-2">{r.label}</span>)}
            </div>
          )}
          {/* Durations (video only) */}
          {nodeTypeKey === 'video' && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">时长</div>
              <div className="flex gap-2 mb-2">
                <input placeholder="标签" value={durationLabel} onChange={(e) => setDurationLabel(e.target.value)} className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <input type="number" placeholder="秒" value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))} className="w-20 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <button onClick={() => { setDurations([...durations, { label: durationLabel, seconds: durationSec }]); setDurationLabel(''); }} className="bg-[#4ade80] text-black px-2 py-1 rounded text-xs">+</button>
              </div>
              {durations.map((d, i) => <span key={i} className="text-[10px] text-[#c084fc] mr-2">{d.label}</span>)}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded-md text-xs text-[#ccc] border border-[#333]">取消</button>
          <button onClick={() => onSave({ name, provider, apiUrl, sortOrder, recommended, resolutions, durations })} className="px-4 py-2 rounded-md text-xs bg-[#4ade80] text-black font-bold">保存</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement ModelTable**

```tsx
// ModelTable.tsx
import { useState, useEffect } from 'react';
import { fetchModels, createModel, updateModel, toggleModel, deleteModel, addResolution, addDuration, type ModelData } from '@/api/adminApi';
import { ModelFormModal } from './ModelFormModal';

interface Props { nodeTypeId: string; nodeTypeKey: string; }

export function ModelTable({ nodeTypeId, nodeTypeKey }: Props) {
  const [models, setModels] = useState<ModelData[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelData | null>(null);

  const load = () => fetchModels(nodeTypeId).then(setModels);

  useEffect(() => { load(); }, [nodeTypeId]);

  const handleSave = async (data: any) => {
    if (editingModel) {
      await updateModel(editingModel.id, data);
    } else {
      const created = await createModel(nodeTypeId, data);
      for (const r of data.resolutions || []) await addResolution(created.id, r);
      for (const d of data.durations || []) await addDuration(created.id, d);
    }
    setModalVisible(false);
    setEditingModel(null);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[#e2e8f0]">模型列表</h3>
        <button onClick={() => { setEditingModel(null); setModalVisible(true); }} className="px-3 py-1.5 rounded-md text-xs bg-[#4ade80] text-black font-bold">+ 添加模型</button>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[#888] border-b border-[#333]">
            <th className="text-left py-2">名称</th>
            <th className="text-left py-2">服务商</th>
            <th className="text-left py-2">排序</th>
            <th className="text-left py-2">状态</th>
            <th className="text-right py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} className="border-b border-[#222]">
              <td className="py-2 text-[#e2e8f0]">{m.recommended && '⭐ '}{m.name}</td>
              <td className="py-2 text-[#94a3b8]">{m.provider}</td>
              <td className="py-2 text-[#94a3b8]">{m.sortOrder}</td>
              <td className="py-2">
                <span className={`px-2 py-0.5 rounded text-[10px] ${m.active ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'bg-[#ef4444]/20 text-[#ef4444]'}`}>
                  {m.active ? '上线' : '下线'}
                </span>
              </td>
              <td className="py-2 text-right">
                <button onClick={() => { setEditingModel(m); setModalVisible(true); }} className="text-[#60a5fa] mr-2">编辑</button>
                <button onClick={async () => { await toggleModel(m.id); load(); }} className="text-[#f59e0b] mr-2">
                  {m.active ? '下线' : '上线'}
                </button>
                <button onClick={async () => { await deleteModel(m.id); load(); }} className="text-[#ef4444]">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ModelFormModal visible={modalVisible} model={editingModel} nodeTypeKey={nodeTypeKey} onSave={handleSave} onCancel={() => { setModalVisible(false); setEditingModel(null); }} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/components/ModelTable.tsx apps/web/src/pages/admin/components/ModelFormModal.tsx
git commit -m "feat: add ModelTable and ModelFormModal for model CRUD"
```

---

### Task 8: PricingRuleTable + PricingRuleFormModal

**Files:**
- Create: `apps/web/src/pages/admin/components/PricingRuleTable.tsx`
- Create: `apps/web/src/pages/admin/components/PricingRuleFormModal.tsx`

- [ ] **Step 1: Implement PricingRuleFormModal**

```tsx
// PricingRuleFormModal.tsx
import { useState } from 'react';

interface Props {
  visible: boolean;
  models: { id: string; name: string; resolutions: any[]; durations: any[] }[];
  onSave: (data: any) => void;
  onCancel: () => void;
}

export function PricingRuleFormModal({ visible, models, onSave, onCancel }: Props) {
  const [modelId, setModelId] = useState('');
  const [resolutionId, setResolutionId] = useState('');
  const [durationId, setDurationId] = useState('');
  const [creditCost, setCreditCost] = useState(5);

  const selectedModel = models.find((m) => m.id === modelId);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 w-[400px]">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-4">添加定价规则</h3>
        <div className="grid gap-3">
          <div>
            <div className="text-[10px] text-[#888] mb-1">模型</div>
            <select value={modelId} onChange={(e) => { setModelId(e.target.value); setResolutionId(''); setDurationId(''); }} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]">
              <option value="">选择模型</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {selectedModel?.resolutions?.length > 0 && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">分辨率</div>
              <select value={resolutionId} onChange={(e) => setResolutionId(e.target.value)} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]">
                <option value="">不限</option>
                {selectedModel.resolutions.map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          )}
          {selectedModel?.durations?.length > 0 && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">时长</div>
              <select value={durationId} onChange={(e) => setDurationId(e.target.value)} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]">
                <option value="">不限</option>
                {selectedModel.durations.map((d: any) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <div className="text-[10px] text-[#888] mb-1">消耗积分</div>
            <input type="number" value={creditCost} onChange={(e) => setCreditCost(Number(e.target.value))} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded-md text-xs text-[#ccc] border border-[#333]">取消</button>
          <button onClick={() => onSave({ modelId, resolutionId: resolutionId || undefined, durationId: durationId || undefined, creditCost })} className="px-4 py-2 rounded-md text-xs bg-[#4ade80] text-black font-bold">保存</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement PricingRuleTable**

```tsx
// PricingRuleTable.tsx
import { useState, useEffect } from 'react';
import { fetchPricingRules, fetchModels, createPricingRule, updatePricingRule, deletePricingRule, type PricingRuleData, type ModelData } from '@/api/adminApi';
import { PricingRuleFormModal } from './PricingRuleFormModal';

interface Props { nodeTypeId: string; }

export function PricingRuleTable({ nodeTypeId }: Props) {
  const [rules, setRules] = useState<PricingRuleData[]>([]);
  const [models, setModels] = useState<ModelData[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  const load = async () => {
    const [r, m] = await Promise.all([fetchPricingRules(nodeTypeId), fetchModels(nodeTypeId)]);
    setRules(r); setModels(m);
  };

  useEffect(() => { load(); }, [nodeTypeId]);

  const handleSave = async (data: any) => {
    await createPricingRule({ ...data, nodeTypeId });
    setModalVisible(false);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[#e2e8f0]">定价规则</h3>
        <button onClick={() => setModalVisible(true)} className="px-3 py-1.5 rounded-md text-xs bg-[#f59e0b] text-black font-bold">+ 添加规则</button>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[#888] border-b border-[#333]">
            <th className="text-left py-2">模型</th>
            <th className="text-left py-2">分辨率</th>
            <th className="text-left py-2">时长</th>
            <th className="text-left py-2">积分</th>
            <th className="text-right py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-[#222]">
              <td className="py-2 text-[#e2e8f0]">{r.model?.name ?? r.modelId}</td>
              <td className="py-2 text-[#94a3b8]">{r.resolution?.label ?? '—'}</td>
              <td className="py-2 text-[#94a3b8]">{r.duration?.label ?? '—'}</td>
              <td className="py-2 text-[#f59e0b]">{r.creditCost} 积分</td>
              <td className="py-2 text-right">
                <button onClick={async () => { await deletePricingRule(r.id); load(); }} className="text-[#ef4444]">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PricingRuleFormModal visible={modalVisible} models={models} onSave={handleSave} onCancel={() => setModalVisible(false)} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/components/PricingRuleTable.tsx apps/web/src/pages/admin/components/PricingRuleFormModal.tsx
git commit -m "feat: add PricingRuleTable and PricingRuleFormModal"
```

---

## Group 4: Frontend Integration

### Task 9: Dynamic ImageConfigPanel Update

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`

- [ ] **Step 1: Add model list loading + credit calculation**

Replace the hardcoded MODELS/RESOLUTIONS in ImageConfigPanel with API calls:

Add these imports to ImageConfigPanel.tsx:
```typescript
import { useState, useEffect } from 'react';
```

Replace the hardcoded arrays with:
```typescript
interface ModelInfo {
  id: string; name: string; provider: string;
  resolutions: { id: string; label: string }[];
  durations: { id: string; label: string }[];
}

function ImageConfigPanelComponent({ nodeId }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState(0);
  // ... existing store hooks

  // Load models on mount
  useEffect(() => {
    fetch('/api/node-types/image/models')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) setModels(json.data);
      })
      .catch(() => {});
  }, []);

  // Recalculate price when model/resolution changes
  const updatePrice = useCallback(async (modelId: string, resolutionId?: string, durationId?: string) => {
    const params = new URLSearchParams({ modelId });
    if (resolutionId) params.set('resolutionId', resolutionId);
    if (durationId) params.set('durationId', durationId);
    const res = await fetch(`/api/pricing/calculate?${params}`);
    const json = await res.json();
    if (json.code === 0) setCreditCost(json.data);
  }, []);
```

Update the model dropdown to use dynamic models:
```tsx
<select
  value={nodeData?.model ?? ''}
  onChange={(e) => {
    updateConfig(nodeId, { model: e.target.value, resolution: '' });
    updatePrice(e.target.value, undefined, undefined);
  }}
  className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
>
  <option value="">选择模型</option>
  {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
</select>
```

Update the resolution dropdown to use dynamic resolutions:
```tsx
const selectedModel = models.find(m => m.id === nodeData?.model);
// ...
<select
  value={nodeData?.resolution ?? ''}
  onChange={(e) => {
    updateConfig(nodeId, { resolution: e.target.value });
    updatePrice(nodeData?.model, e.target.value, undefined);
  }}
>
  <option value="">默认</option>
  {(selectedModel?.resolutions || DEFAULT_RESOLUTIONS).map((r) => <option key={r.id || r} value={r.id || r}>{r.label || r}</option>)}
</select>
```

Replace credit display text:
```tsx
<span className="text-xs text-[#f59e0b]">消耗积分: {creditCost || '—'}</span>
```

- [ ] **Step 2: Verify tests pass + Commit**

```bash
cd apps/web && pnpm test -- --run
git add apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx
git commit -m "feat: update ImageConfigPanel with dynamic model loading and pricing"
```

---

### Task 10: Router Update — Add /admin Route

**Files:**
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Add admin route**

```typescript
// Add to router.tsx imports:
import { AdminPage } from '@/pages/admin';

// Add to routes array:
{ path: '/admin', element: <AdminPage /> },
```

- [ ] **Step 2: Verify compilation + Commit**

```bash
cd apps/web && npx tsc -b --noEmit
git add apps/web/src/router.tsx
git commit -m "feat: add /admin route for model management"
```

---

## Group 5: Seed Data & Integration

### Task 11: Database Seed — Models + Pricing Rules

**Files:**
- Modify: `apps/api/prisma/seed.ts` — extend with Phase 3 data

- [ ] **Step 1: Add seed data for model configuration**

Extend `apps/api/prisma/seed.ts` with:

```typescript
// ====== Phase 3: Model Configuration Seed ======

// Create node types
const textNode = await prisma.nodeType.upsert({
  where: { key: 'text' },
  update: {},
  create: { name: '文本生成', key: 'text', description: '文本Prompt输入与优化' },
});

const imageNode = await prisma.nodeType.upsert({
  where: { key: 'image' },
  update: {},
  create: { name: '图片生成', key: 'image', description: '文生图、图生图' },
});

const videoNode = await prisma.nodeType.upsert({
  where: { key: 'video' },
  update: {},
  create: { name: '视频生成', key: 'video', description: '文生视频、图生视频' },
});

// Create models for image node
const sdXL = await prisma.aIModel.upsert({
  where: { id: 'seed-model-sdxl' },
  update: {},
  create: { id: 'seed-model-sdxl', nodeTypeId: imageNode.id, name: 'Stable Diffusion XL', provider: 'Stability AI', apiUrl: 'https://api.stability.ai/v1/generation', sortOrder: 1, recommended: true },
});

const dalle = await prisma.aIModel.upsert({
  where: { id: 'seed-model-dalle' },
  update: {},
  create: { id: 'seed-model-dalle', nodeTypeId: imageNode.id, name: 'DALL-E 3', provider: 'OpenAI', apiUrl: 'https://api.openai.com/v1/images/generations', sortOrder: 2, recommended: false },
});

const mj = await prisma.aIModel.upsert({
  where: { id: 'seed-model-mj' },
  update: {},
  create: { id: 'seed-model-mj', nodeTypeId: imageNode.id, name: 'Midjourney v6', provider: 'Midjourney', apiUrl: 'https://api.midjourney.com/v1/imagine', sortOrder: 3, recommended: false },
});

// Create resolutions
const res1024 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-1024' }, update: {}, create: { id: 'seed-res-1024', modelId: sdXL.id, label: '1024×1024', width: 1024, height: 1024 } });
const res2048 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-2048' }, update: {}, create: { id: 'seed-res-2048', modelId: sdXL.id, label: '2048×2048', width: 2048, height: 2048 } });
const res512 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-512' }, update: {}, create: { id: 'seed-res-512', modelId: dalle.id, label: '512×512', width: 512, height: 512 } });
const res1024d = await prisma.modelResolution.upsert({ where: { id: 'seed-res-1024d' }, update: {}, create: { id: 'seed-res-1024d', modelId: dalle.id, label: '1024×1024', width: 1024, height: 1024 } });
const res_mj_1024 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-mj-1024' }, update: {}, create: { id: 'seed-res-mj-1024', modelId: mj.id, label: '1024×1024', width: 1024, height: 1024 } });

// Create pricing rules for image node
const imagePricingRules = [
  { nodeTypeId: imageNode.id, modelId: sdXL.id, resolutionId: res1024.id, creditCost: 3 },
  { nodeTypeId: imageNode.id, modelId: sdXL.id, resolutionId: res2048.id, creditCost: 6 },
  { nodeTypeId: imageNode.id, modelId: dalle.id, resolutionId: res512.id, creditCost: 2 },
  { nodeTypeId: imageNode.id, modelId: dalle.id, resolutionId: res1024d.id, creditCost: 5 },
  { nodeTypeId: imageNode.id, modelId: mj.id, resolutionId: res_mj_1024.id, creditCost: 8 },
];

for (const rule of imagePricingRules) {
  await prisma.pricingRule.upsert({
    where: {
      nodeTypeId_modelId_resolutionId_durationId: {
        nodeTypeId: rule.nodeTypeId,
        modelId: rule.modelId,
        resolutionId: rule.resolutionId,
        durationId: null,
      },
    },
    update: { creditCost: rule.creditCost },
    create: rule,
  });
}

// Text model (simple)
const gpt4 = await prisma.aIModel.upsert({
  where: { id: 'seed-model-gpt4' },
  update: {},
  create: { id: 'seed-model-gpt4', nodeTypeId: textNode.id, name: 'GPT-4o', provider: 'OpenAI', apiUrl: 'https://api.openai.com/v1/chat/completions', sortOrder: 1, recommended: true },
});

await prisma.pricingRule.upsert({
  where: { nodeTypeId_modelId_resolutionId_durationId: { nodeTypeId: textNode.id, modelId: gpt4.id, resolutionId: null, durationId: null } },
  update: { creditCost: 2 },
  create: { nodeTypeId: textNode.id, modelId: gpt4.id, creditCost: 2 },
});

console.log('Phase 3 seed complete: 3 node types, 4 models, pricing rules');
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat: extend seed with Phase 3 model/pricing data"
```

---

### Task 12: Full Stack Integration Verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 3: Verify file structure**

Check all files from File Structure Map exist.

- [ ] **Step 4: Git log summary**

```bash
git log --oneline
```

- [ ] **Step 5: Report results**

---

## Verification Checklist

- [ ] `pnpm test` — all tests pass
- [ ] `apps/api` — tsc --noEmit clean
- [ ] `apps/web` — tsc -b --noEmit clean
- [ ] GET /api/node-types/image/models — returns active models with resolutions
- [ ] GET /api/pricing/calculate?modelId=X&resolutionId=Y — returns correct credit cost
- [ ] /admin page loads with NodeType tabs
- [ ] ModelTable shows models, add/edit/delete works
- [ ] PricingRuleTable shows rules, add/delete works
- [ ] ImageConfigPanel loads models dynamically from API
- [ ] Credit cost updates when model/resolution changes
