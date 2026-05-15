# Phase 6 BullMQ 完成 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 Phase 6 半成品代码，升级 bull→bullmq，完成 NestJS BullModule 集成（forRoot + registerQueue + @Processor + @InjectQueue），移除所有 require('bull') 代码。

**Architecture:** AppModule 注册 BullModule.forRoot，ExecutionModule 注册 BullModule.registerQueue，ExecutionProcessor 作为 NestJS provider 自动发现，controller 通过 @InjectQueue 注入队列，Redis 配置统一走 REDIS_URL 环境变量。

**Tech Stack:** bullmq 5.75.1, @nestjs/bullmq 10.2.1, ioredis 5.4.1, NestJS 10.4.18, Redis 7

---

## File Structure Map

```
Modified files:
  apps/api/package.json                                          [Replace deps]
  apps/api/src/config/env.ts                                     [REDIS_URL default]
  apps/api/src/app.module.ts                                     [Add BullModule.forRoot]
  apps/api/src/modules/execution/execution.module.ts             [Add BullModule + processor]
  apps/api/src/modules/execution/execution.controller.ts         [DI queue, @Req enqueue]
  apps/api/src/modules/execution/execution.processor.ts          [bullmq, Logger, progress]
  apps/api/src/modules/execution/execution.controller.spec.ts    [Mock queue, test enqueue]
  apps/api/src/main.ts                                           [Remove inline worker]

New files:
  apps/api/src/modules/execution/execution.types.ts              [Job data types]
  apps/api/src/modules/execution/execution.constants.ts          [Queue name constants]
  apps/api/src/modules/execution/execution.processor.spec.ts     [Processor tests]
```

---

### Task 1: Replace Dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Remove old packages**

```bash
cd /d/flowweb/apps/api && pnpm remove bull @nestjs/bull
```

Expected: packages removed from package.json and lockfile.

- [ ] **Step 2: Install new packages with exact versions**

```bash
cd /d/flowweb/apps/api && pnpm add bullmq@5.75.1 @nestjs/bullmq@10.2.1 ioredis@5.4.1
```

Expected: packages installed with exact versions in package.json.

- [ ] **Step 3: Verify package.json**

```bash
cd /d/flowweb/apps/api && node -e "const p = require('./package.json'); const d = p.dependencies; console.log('bullmq:', d.bullmq); console.log('@nestjs/bullmq:', d['@nestjs/bullmq']); console.log('ioredis:', d.ioredis); console.log('bull present:', 'bull' in d); console.log('@nestjs/bull present:', '@nestjs/bull' in d);"
```

Expected output:
```
bullmq: 5.75.1
@nestjs/bullmq: 10.2.1
ioredis: 5.4.1
bull present: false
@nestjs/bull present: false
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "deps: replace bull/@nestjs/bull with bullmq@5.75.1 + @nestjs/bullmq@10.2.1"
```

---

### Task 2: Add Job Types and Constants

**Files:**
- Create: `apps/api/src/modules/execution/execution.types.ts`
- Create: `apps/api/src/modules/execution/execution.constants.ts`

- [ ] **Step 1: Create execution.types.ts**

```typescript
export interface ExecutionJobData {
  projectId: string;
  nodeId?: string;
  userId: string;
}

export type ExecutionJobResult = any;
```

- [ ] **Step 2: Create execution.constants.ts**

```typescript
export const EXECUTION_QUEUE_NAME = 'execution';
export const EXECUTION_CONNECTION_NAME = 'default';
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/execution/execution.types.ts apps/api/src/modules/execution/execution.constants.ts
git commit -m "feat: add ExecutionJobData types and queue constants"
```

---

### Task 3: Update REDIS_URL Env Config

**Files:**
- Modify: `apps/api/src/config/env.ts`

- [ ] **Step 1: Change REDIS_URL from optional to with default**

Read `apps/api/src/config/env.ts`. Find the line:
```typescript
REDIS_URL: z.string().optional(),
```
Replace with:
```typescript
REDIS_URL: z.string().default('redis://localhost:6379/0'),
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/config/env.ts
git commit -m "feat: set REDIS_URL default to redis://localhost:6379/0"
```

---

### Task 4: Register BullModule.forRoot in AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Add BullModule.forRoot import and registration**

Read `apps/api/src/app.module.ts`. Make these changes:

Add import at top:
```typescript
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from './config/env';
```

Add before @Module decorator:
```typescript
const env = validateEnv();
```

Add BullModule.forRoot as first item in imports array:
```typescript
@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: env.REDIS_URL },
      connectionName: 'default',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 * 7 },
        timeout: 300000,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    // ... rest unchanged
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /d/flowweb/apps/api && npx tsc --noEmit
```

Expected: No errors. (Other modules may fail but app.module.ts must be clean.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat: register BullModule.forRoot with Redis connection and default job options"
```

---

### Task 5: Update ExecutionModule — Register Queue + Processor

**Files:**
- Modify: `apps/api/src/modules/execution/execution.module.ts`

- [ ] **Step 1: Add BullModule.registerQueue, ExecutionProcessor, and exports**

Read `apps/api/src/modules/execution/execution.module.ts`. Replace entire file:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { ExecutionProcessor } from './execution.processor';
import { CreditModule } from '../credit/credit.module';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { EXECUTION_QUEUE_NAME, EXECUTION_CONNECTION_NAME } from './execution.constants';

@Module({
  imports: [
    CreditModule,
    BullModule.registerQueue({
      name: EXECUTION_QUEUE_NAME,
      connectionName: EXECUTION_CONNECTION_NAME,
    }),
  ],
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    TopologyService,
    ValidationService,
    ApiCallerService,
    ExecutionGateway,
    ExecutionProcessor,
  ],
  exports: [ExecutionService],
})
export class ExecutionModule {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/execution/execution.module.ts
git commit -m "feat: register execution queue and processor in ExecutionModule"
```

---

### Task 6: Rewrite ExecutionProcessor with bullmq

**Files:**
- Modify: `apps/api/src/modules/execution/execution.processor.ts`
- Create: `apps/api/src/modules/execution/execution.processor.spec.ts`

- [ ] **Step 1: Write FAILING processor test**

Create `apps/api/src/modules/execution/execution.processor.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionProcessor } from './execution.processor';
import { ExecutionService } from './execution.service';
import { Job } from 'bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionProcessor', () => {
  let processor: ExecutionProcessor;
  let execService: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    execService = {
      execute: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionProcessor,
        { provide: ExecutionService, useValue: execService },
      ],
    }).compile();

    processor = module.get<ExecutionProcessor>(ExecutionProcessor);
  });

  it('should process job and call service.execute with correct params', async () => {
    const job = {
      id: 'job-1',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    const result = await processor.handleExecution(job);

    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1');
    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('should handle job without nodeId', async () => {
    const job = {
      id: 'job-2',
      data: { projectId: 'p1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.handleExecution(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', undefined, 'u1');
  });

  it('should throw error on failure and trigger retry', async () => {
    execService.execute.mockRejectedValue(new Error('AI service down'));

    const job = {
      id: 'job-3',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await expect(processor.handleExecution(job)).rejects.toThrow('AI service down');
    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).not.toHaveBeenCalledWith(100);
  });
});
```

Run test → FAIL (processor uses old bull imports, won't compile with new types):

```bash
cd /d/flowweb/apps/api && pnpm test -- --run src/modules/execution/execution.processor.spec.ts
```

Expected: FAIL with compilation errors about bull imports.

- [ ] **Step 2: Rewrite execution.processor.ts**

Replace entire file:

```typescript
import { Processor, Process } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { ExecutionJobData, ExecutionJobResult } from './execution.types';

@Processor('execution')
export class ExecutionProcessor {
  private readonly logger = new Logger(ExecutionProcessor.name);

  constructor(private readonly executionService: ExecutionService) {}

  @Process()
  async handleExecution(job: Job<ExecutionJobData, ExecutionJobResult>) {
    this.logger.log(`开始处理任务 ${job.id}`);
    await job.updateProgress(10);

    try {
      const { projectId, nodeId, userId } = job.data;
      const result = await this.executionService.execute(projectId, nodeId, userId);
      await job.updateProgress(100);
      this.logger.log(`任务 ${job.id} 完成`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`任务 ${job.id} 失败: ${message}`, stack);
      throw error;
    }
  }
}
```

- [ ] **Step 3: Run processor tests → PASS**

```bash
cd /d/flowweb/apps/api && pnpm test -- --run src/modules/execution/execution.processor.spec.ts
```

Expected: 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/execution/execution.processor.ts apps/api/src/modules/execution/execution.processor.spec.ts
git commit -m "feat: rewrite ExecutionProcessor with bullmq, Logger, and progress updates"
```

---

### Task 7: Rewrite ExecutionController with @InjectQueue

**Files:**
- Modify: `apps/api/src/modules/execution/execution.controller.ts`
- Modify: `apps/api/src/modules/execution/execution.controller.spec.ts`

- [ ] **Step 1: Write FAILING controller test for enqueue and getJob**

Read `apps/api/src/modules/execution/execution.controller.spec.ts`. Replace entire file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionController', () => {
  let controller: ExecutionController;
  let service: { execute: ReturnType<typeof vi.fn> };
  let queue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      execute: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };
    queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: vi.fn().mockResolvedValue({
        id: 'job-123',
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [
        { provide: ExecutionService, useValue: service },
        { provide: getQueueToken('execution'), useValue: queue },
      ],
    }).compile();

    controller = module.get<ExecutionController>(ExecutionController);
  });

  describe('execute', () => {
    it('should call service.execute with provided parameters', async () => {
      const body = { projectId: 'p1', nodeId: 'n2', userId: 'user-1' };
      const result = await controller.execute(body);
      expect(service.execute).toHaveBeenCalledWith('p1', 'n2', 'user-1');
      expect(result).toEqual({ success: true, errors: [] });
    });

    it('should default userId to default-user when not provided', async () => {
      const body = { projectId: 'p1' };
      await controller.execute(body);
      expect(service.execute).toHaveBeenCalledWith('p1', undefined, 'default-user');
    });
  });

  describe('enqueue', () => {
    it('should add job to queue and return jobId', async () => {
      const req = { user: { id: 'user-1' } } as any;
      const body = { projectId: 'p1', nodeId: 'n2' };
      const result = await controller.enqueue(body, req);
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: 'n2',
        userId: 'user-1',
      });
      expect(result).toEqual({ jobId: 'job-123', status: 'queued' });
    });

    it('should handle missing user on request', async () => {
      const req = {} as any;
      const body = { projectId: 'p1' };
      const result = await controller.enqueue(body, req);
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: undefined,
        userId: undefined,
      });
      expect(result.status).toBe('queued');
    });
  });

  describe('getJob', () => {
    it('should return job state and progress', async () => {
      const result = await controller.getJob('job-123');
      expect(queue.getJob).toHaveBeenCalledWith('job-123');
      expect(result).toEqual({ id: 'job-123', state: 'completed', progress: 100 });
    });

    it('should return error when job not found', async () => {
      queue.getJob.mockResolvedValue(null);
      const result = await controller.getJob('nonexistent');
      expect(result).toEqual({ error: 'Job not found' });
    });
  });
});
```

Run → FAIL:

```bash
cd /d/flowweb/apps/api && pnpm test -- --run src/modules/execution/execution.controller.spec.ts
```

Expected: FAIL — controller still uses `require('bull')`, no @InjectQueue constructor param.

- [ ] **Step 2: Rewrite execution.controller.ts**

Replace entire file:

```typescript
import { Controller, Post, Get, Body, Param, Inject, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExecutionService } from './execution.service';
import { Request } from 'express';

@Controller('api/execution')
export class ExecutionController {
  constructor(
    @Inject(ExecutionService) private readonly service: ExecutionService,
    @InjectQueue('execution') private readonly executionQueue: Queue,
  ) {}

  @Post('execute')
  execute(@Body() body: { projectId: string; nodeId?: string; userId?: string }) {
    return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user');
  }

  @Post('enqueue')
  async enqueue(
    @Body() body: { projectId: string; nodeId?: string },
    @Req() req: Request,
  ) {
    const job = await this.executionQueue.add('execution', {
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: (req as any).user?.id,
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.executionQueue.getJob(id);
    if (!job) return { error: 'Job not found' };
    const state = await job.getState();
    return { id: job.id, state, progress: job.progress };
  }
}
```

- [ ] **Step 3: Run controller tests → PASS**

```bash
cd /d/flowweb/apps/api && pnpm test -- --run src/modules/execution/execution.controller.spec.ts
```

Expected: 6 tests PASS (2 execute + 2 enqueue + 2 getJob).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/execution/execution.controller.ts apps/api/src/modules/execution/execution.controller.spec.ts
git commit -m "feat: rewrite ExecutionController with @InjectQueue and @Req enqueue"
```

---

### Task 8: Clean main.ts — Remove Inline Worker

**Files:**
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Remove inline worker code and unused import**

Read `apps/api/src/main.ts`. Make these changes:

1. Remove the import line (line 6):
```typescript
import { ExecutionService } from './modules/execution/execution.service';
```
(Delete this line entirely)

2. Remove the worker block (lines 17-28):
```typescript
// DELETE this entire block:
const executionService = app.get(ExecutionService);
const Queue = require('bull');
const worker = new Queue('execution', { redis: { host: 'localhost', port: 6379 } });
worker.process(async (job: any) => {
  const { projectId, nodeId, userId } = job.data;
  console.log('[Worker] Processing job', job.id, projectId, nodeId);
  const result = await executionService.execute(projectId, nodeId, userId || 'default-user');
  console.log('[Worker] Job', job.id, 'done:', result.success);
  return result;
});
console.log('[Worker] BullMQ worker started');
```

After removal, main.ts should look like:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { validateEnv } from './config/env';

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: 'http://localhost:5173', credentials: true });

  await app.listen(env.PORT);
  console.log(`Server running on port ${env.PORT}`);
}

bootstrap();
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "refactor: remove inline Bull worker from main.ts (now handled by BullModule)"
```

---

### Task 9: Verify No require('bull') Remains

**Files:**
- (None modified — verification only)

- [ ] **Step 1: Global search for require('bull')**

```bash
cd /d/flowweb && grep -r "require('bull')" apps/api/src/ || echo "No matches found"
```

Expected: `No matches found`

- [ ] **Step 2: Global search for import bull**

```bash
cd /d/flowweb && grep -r "from 'bull'" apps/api/src/ --include="*.ts" || echo "No matches found"
```

Expected: `No matches found` (note: `from 'bullmq'` is fine)

- [ ] **Step 3: Global search for new Queue()**

```bash
cd /d/flowweb && grep -r "new Queue(" apps/api/src/ --include="*.ts" || echo "No matches found"
```

Expected: `No matches found`

- [ ] **Step 4: Commit if any findings fixed**

(If all clean, no commit needed. If fixes required, commit them.)

---

### Task 10: Full Integration Verification

**Files:**
- (None modified — verification only)

- [ ] **Step 1: Run all API tests**

```bash
cd /d/flowweb/apps/api && pnpm test -- --run
```

Expected: All tests PASS (144+ tests).

- [ ] **Step 2: TypeScript compilation check**

```bash
cd /d/flowweb/apps/api && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Ensure Redis is running**

```bash
cd /d/flowweb && tasklist | findstr redis-server || echo "Redis not running — start it"
```

If not running:
```bash
cd /d/flowweb && .claude/redis/redis-server.exe --port 6379 &
```

- [ ] **Step 4: Start API server and verify BullMQ connection**

```bash
cd /d/flowweb/apps/api && timeout 10 pnpm dev 2>&1 | head -20 || true
```

Expected: Log message indicating BullMQ connected to Redis. Kill server after check.

- [ ] **Step 5: Run all tests across monorepo**

```bash
cd /d/flowweb && pnpm test
```

Expected: All tests pass in both apps/api and apps/web.

- [ ] **Step 6: Report results**

Collect test counts and any failures. If all pass, Phase 6 is complete.

---

## Verification Checklist

- [ ] `pnpm test` — all tests pass
- [ ] `tsc --noEmit` — no type errors
- [ ] No `require('bull')` or `import ... from 'bull'` in codebase
- [ ] No `new Queue(` in codebase
- [ ] `BullModule.forRoot` registered in app.module.ts
- [ ] `BullModule.registerQueue` registered in execution.module.ts
- [ ] `ExecutionProcessor` in providers array
- [ ] `@InjectQueue('execution')` in controller constructor
- [ ] `REDIS_URL` has default `redis://localhost:6379/0`
- [ ] `execution.types.ts` and `execution.constants.ts` exist
- [ ] main.ts has no Bull/worker code
