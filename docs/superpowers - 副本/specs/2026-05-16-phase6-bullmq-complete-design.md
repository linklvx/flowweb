# Phase 6: BullMQ Async Queue — 完成设计

> **Status:** Approved
> **Date:** 2026-05-16
> **Scope:** 清理 Phase 6 半成品代码，升级 bull→bullmq，完成 NestJS BullModule 集成

## 1. 背景

Phase 6 原有实现处于半成品状态：
- 两条平行的 Bull 实现路径（`require('bull')` 在 main.ts 和 controller 中各创建独立 Queue 实例）
- `ExecutionProcessor` 代码已写但未注册到 NestJS DI
- Redis 配置硬编码（`localhost:6379`），未使用环境变量
- `BullModule.forRoot` 和 `BullModule.registerQueue` 均未注册

本次完成目标：
1. 移除所有原始 `require('bull')` 代码
2. 升级 `bull`→`bullmq`，`@nestjs/bull`→`@nestjs/bullmq`
3. 完成 NestJS BullModule 集成（forRoot + registerQueue + @Processor + @InjectQueue）
4. Redis 配置统一走 `REDIS_URL` 环境变量
5. 添加任务进度更新和结构化日志

## 2. 依赖变更

```json
// apps/api/package.json
{
  "dependencies": {
    "bullmq": "5.75.1",
    "@nestjs/bullmq": "10.2.1",
    "ioredis": "5.4.1"
  }
}
```

移除：`bull`、`@nestjs/bull`

## 3. 架构

### 3.1 模块拓扑

```
AppModule
  └─ BullModule.forRoot({ connectionName: 'default', ... })
      └─ ExecutionModule
          └─ BullModule.registerQueue({ name: 'execution', connectionName: 'default' })
              ├─ ExecutionController (@InjectQueue('execution'))
              └─ ExecutionProcessor (@Processor('execution'))
```

### 3.2 请求流

```
POST /api/execution/enqueue { projectId, nodeId }
  → ExecutionController.enqueue()
  → this.executionQueue.add('execution', { projectId, nodeId, userId })
  → 返回 { jobId, status: 'queued' }

ExecutionProcessor (后台 Worker):
  → 从 Redis 拉取任务
  → job.updateProgress(10)
  → executionService.execute(projectId, nodeId, userId)
  → job.updateProgress(100)
  → 返回结果
  → 失败自动重试 (3次, 指数退避)
```

### 3.3 环境变量

```typescript
// apps/api/src/config/env.ts
REDIS_URL: z.string().default('redis://localhost:6379/0'),
```

### 3.4 全局默认任务选项

```typescript
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
})
```

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/api/package.json` | 修改 | 替换依赖 |
| `apps/api/src/config/env.ts` | 修改 | REDIS_URL 加默认值 |
| `apps/api/src/app.module.ts` | 修改 | 添加 BullModule.forRoot |
| `apps/api/src/modules/execution/execution.module.ts` | 修改 | 添加 BullModule.registerQueue + ExecutionProcessor |
| `apps/api/src/modules/execution/execution.controller.ts` | 修改 | 删除 require('bull')，改用 @InjectQueue |
| `apps/api/src/modules/execution/execution.processor.ts` | 修改 | bull→bullmq import，添加 Logger + updateProgress |
| `apps/api/src/main.ts` | 修改 | 删除内联 Worker 代码块 |
| `apps/api/src/modules/execution/execution.types.ts` | 新增 | 任务数据类型定义 |
| `apps/api/src/modules/execution/execution.constants.ts` | 新增 | 队列名/连接名常量 |

## 5. 关键代码

### 5.1 app.module.ts

```typescript
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from './config/env';

const env = validateEnv();

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
    // ... 其他模块
  ],
})
export class AppModule {}
```

### 5.2 execution.module.ts

```typescript
import { BullModule } from '@nestjs/bullmq';
import { ExecutionProcessor } from './execution.processor';

@Module({
  imports: [
    CreditModule,
    BullModule.registerQueue({
      name: 'execution',
      connectionName: 'default',
    }),
  ],
  controllers: [ExecutionController],
  providers: [ExecutionService, TopologyService, ValidationService, ApiCallerService, ExecutionGateway, ExecutionProcessor],
  exports: [ExecutionService],
})
export class ExecutionModule {}
```

### 5.3 execution.controller.ts

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Req } from '@nestjs/common';
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
  async enqueue(@Body() body: { projectId: string; nodeId?: string }, @Req() req: Request) {
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

### 5.4 execution.processor.ts

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

### 5.5 execution.types.ts (新增)

```typescript
export interface ExecutionJobData {
  projectId: string;
  nodeId?: string;
  userId: string;
}

export type ExecutionJobResult = any;
```

### 5.6 execution.constants.ts (新增)

```typescript
export const EXECUTION_QUEUE_NAME = 'execution';
export const EXECUTION_CONNECTION_NAME = 'default';
```

所有使用队列名称和连接名称的地方引用这些常量，避免硬编码字符串。

### 5.7 main.ts

删除以下代码块（第17-28行）：
```typescript
// DELETE START
const executionService = app.get(ExecutionService);
const Queue = require('bull');
const worker = new Queue('execution', { redis: { host: 'localhost', port: 6379 } });
worker.process(async (job: any) => {
  const { projectId, nodeId, userId } = job.data;
  const result = await executionService.execute(projectId, nodeId, userId || 'default-user');
  return result;
});
console.log('[Worker] BullMQ worker started');
// DELETE END
```

## 6. 测试策略 (TDD)

### 6.1 单元测试

- **ExecutionProcessor**: mock ExecutionService，验证 `execute()` 被调用、进度更新被触发、错误正确抛出
- **ExecutionController**: mock Queue，验证 `enqueue` 调用 `queue.add()`、`getJob` 返回正确状态

### 6.2 集成测试

- 验证 `BullModule.forRoot` + `registerQueue` 正确注册（应用启动不报错）
- 验证 `@InjectQueue` 正确注入

## 7. 验证标准

所有以下项目必须全部通过：

- [ ] `pnpm test` 全部通过
- [ ] TypeScript 编译无错误 (`tsc --noEmit`)
- [ ] 代码库全局搜索：不存在 `require('bull')` 或 `import * as Bull from 'bull'`
- [ ] 代码库全局搜索：不存在 `new Queue()` 手动创建队列实例
- [ ] 应用启动日志显示：`BullMQ connected to redis://localhost:6379/0`
- [ ] `POST /api/execution/enqueue` 返回 `{ jobId: string, status: 'queued' }`
- [ ] 提交任务后，Redis 中出现 `bull:execution:job:{jobId}` 键
- [ ] ExecutionProcessor 日志显示："开始处理任务 {jobId}" 和 "任务 {jobId} 完成"
- [ ] 任务进度从 10% 更新到 100%
- [ ] 模拟任务失败（如抛出异常），观察日志确认自动重试 3 次
- [ ] 任务成功完成 1 小时后，自动从 Redis 中删除
- [ ] 任务失败 7 天后，自动从 Redis 中删除

## 8. 不在范围内

- Bull Board UI（队列监控面板）
- 任务取消
- 优先级队列
- 速率限制
- 沙箱 Worker 模式
