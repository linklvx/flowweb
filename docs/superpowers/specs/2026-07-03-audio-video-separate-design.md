<!-- doc-status: historical | verified_at: n/a -->
# 音视频分离功能 Spec（v5 — 终版）

## 变更记录

| 版本 | 修订内容 |
|------|---------|
| v1 | 初始方案：前端 FFmpeg.wasm → 调整为后端处理 |
| v2 | 架构合规：BullMQ 队列 + Prisma 持久化 + ffprobe 兼容性 + 权限校验 + Hook 复用 |
| v3 | 健壮性：Controller 轻量化 + 预签名 URL 实时生成 + Redis 原子并发 + 状态流转补全 + Media 血缘 + 错误分级 + 多层清理 |
| v4 | 一致性：BullMQ Job 状态对齐 + Redis 计数泄漏兜底 + 幂等锁原子化 + 路径遍历修复 + 公共能力抽离 + 前端状态统一收敛 + 结构化错误 |
| v5 | 细节完善：分布式锁持有者标识 + nodeProcessMap 全量迁移 + 队列并发适配 CPU 密集型 + Media 元数据补全 + Sentry 标签化 + Handle 标识 + Prometheus 指标 + 下载独立超时 + 子节点语义命名 |

---

## 一、功能概述

点击视频节点悬浮工具条「音频分离」下拉菜单中的「音视频分离」，后端 FFmpeg 流复制分离 → 上传 MinIO → 自动创建纯视频节点 + 纯音频节点，均与源节点连线。

**一期范围**：仅「音视频分离」（split）。「仅保留人声」「仅保留背景音」需 AI 模型，按钮 disabled + tooltip "即将上线"。

---

## 二、交互流程

```
选中视频节点 → VideoNodeToolbar [音频分离] 下拉
  ├── [音视频分离]     ← 本次实现
  ├── [仅保留人声]     ← disabled + tooltip "即将上线"
  └── [仅保留背景音]   ← disabled + tooltip "即将上线"
        │ 点击「音视频分离」
        ▼
  下拉关闭，按钮 loading → POST /api/execution/video-separate (< 100ms)
        │
        ├─ 网络错误/接口报错 → Toast 提示 + 恢复按钮状态
        ├─ Socket 推送 processing → "分离中..."
        ├─ Socket 推送 done { videoFileId, audioFileId }
        │     → Toast "音视频分离完成"
        │     → 右侧创建 2 个子节点（纯视频 + 纯音频）
        │     → 自动连线，选中视频子节点
        └─ Socket 推送 error { error }
              → Toast "分离失败：{原因}" → 恢复按钮
```

---

## 三、后端架构

### 3.1 层级职责边界

| 层级 | 职责 | 禁止 |
|------|------|------|
| **Controller** | 参数校验（DB 字段）、权限校验、委托 Service | 禁止 ffprobe / FFmpeg / 文件 IO / 业务逻辑 |
| **Service** | 业务逻辑：文件所有权校验、Redis 分布式锁、幂等性检查、Redis 并发计数、Prisma 任务创建、BullMQ 入队、状态查询 | 禁止 ffprobe / FFmpeg |
| **Processor (Worker)** | 本地文件下载、ffprobe 检测、FFmpeg 执行、MinIO 上传、产物 Media 创建、Socket 推送、临时文件清理 | — |
| **MediaProcessService（新建公共层）** | 带超时的 FFmpeg 执行、ffprobe 轨道/编码检测、MinIO 上传 + Media 创建通用方法、临时文件清理工具 | — |

### 3.2 公共能力抽离：MediaProcessService

video-trim 与 video-separate 在 FFmpeg 执行封装、ffprobe 检测、MinIO 上传 + Media 记录创建等方面高度重合。抽离通用 `MediaProcessService` 基础服务层：

```typescript
// apps/api/src/modules/media-process/media-process.service.ts（新建）
@Injectable()
export class MediaProcessService {
  // ── ffprobe 检测 ──
  async detectAudio(inputPath: string): Promise<boolean>;
  async detectAudioCodec(inputPath: string): Promise<string | null>;
  async detectDuration(inputPath: string): Promise<number>;

  // ── FFmpeg 执行（含 OS 级超时管控）──
  async runFfmpeg(args: string[], timeoutMs?: number): Promise<void>;

  // ── MinIO 上传 + Media 创建（统一写入规范）──
  async uploadAndCreateMedia(params: {
    filePath: string;
    userId: string;
    projectId: string;
    nodeId: string;
    originalName: string;
    mimeType: string;
    sourceFileId: string;
    bizType: string;
  }): Promise<Media>;

  // ── 临时文件清理 ──
  async cleanupTempDir(taskId: string, baseDir: string): Promise<void>;
  async cleanupStaleDirs(baseDir: string, maxAgeMs: number): Promise<void>;
}
```

**重构影响**：video-trim 的 processor 和 service 中的 `runFfmpeg`、`detectAudio`、`cleanupTempDir` 等逻辑迁移到 `MediaProcessService`。已有行为不变，测试继续通过。video-separate 直接复用，不重复实现。

### 3.3 状态流转（DB 与 BullMQ 严格对齐）

```
queued → processing → done
                   ↘ error (failed)
```

- `queued`：任务已入队（Controller 返回）
- `processing`：Worker 开始执行（入口处立即更新 + Socket 推送）
- `done`：分离成功（BullMQ completed）
- `error`：分离失败（**BullMQ failed**，通过 `job.moveToFailed()` 手动标记）

**关键约束**：`VideoSeparateTask.status` 与 BullMQ Job 状态必须一一对应。业务错误（NonRetryableError）使用 `job.moveToFailed()` 手动标记失败，不 return completed。

### 3.4 Prisma 新增模型

```prisma
model VideoSeparateTask {
  id            String    @id @default(cuid())
  userId        String
  workflowId    String
  nodeId        String
  sourceFileId  String
  mode          String    @default("split")
  status        String    @default("queued")  // queued | processing | done | error
  videoFileId   String?
  audioFileId   String?
  errorMsg      String?
  errorType     String?                        // 结构化错误分类
  createdAt     DateTime  @default(now())
  finishedAt    DateTime?

  @@index([nodeId])
  @@index([userId])
  @@index([sourceFileId])
}
```

`errorType` 字段用于结构化错误分类（`NO_AUDIO_TRACK` / `FILE_CORRUPTED` / `CODEC_UNSUPPORTED` / `MINIO_UPLOAD_FAILED` / `FFMPEG_TIMEOUT` 等），便于监控面板统计失败原因分布。

### 3.5 后端 API

#### Controller

```typescript
@Controller('api/execution')
export class VideoSeparateController {
  @Post('video-separate')
  async submitSeparate(@Body() dto: VideoSeparateRequest, @Req() req: AuthenticatedRequest) {
    return this.separateService.submitSeparate({
      ...dto,
      userId: req.user.id,
      workflowId: req.workflowId,  // 由全局 AuthGuard 注入，已校验工作流编辑权限
    });
  }

  @Get('video-separate/:taskId')
  async getTaskStatus(@Param('taskId') taskId: string, @Req() req: AuthenticatedRequest) {
    return this.separateService.getTaskStatus(taskId, req.user.id);
  }
}
```

> **路由权限确认**：`/api/execution/*` 路由已受全局 `AuthGuard` 保护，中间件已校验用户登录态及 workflowId 编辑权限，无需额外处理。

#### Service 核心流程

```typescript
async submitSeparate(params): Promise<{ taskId: string }> {
  const { fileId, nodeId, userId, workflowId } = params;

  // ── Controller 层（轻量，< 100ms）──

  // 1. 文件所有权校验
  const media = await this.prisma.media.findFirst({
    where: { id: fileId, userId },
    select: { id: true, size: true, mimeType: true, originalName: true, key: true, projectId: true },
  });
  if (!media) throw new ForbiddenException('file not found or access denied');

  // 2. DB 字段轻量校验
  if (media.size > MAX_FILE_SIZE) {
    throw new BadRequestException('文件过大（>2GB），请拆分后处理');
  }
  if (!SUPPORTED_VIDEO_MIME_TYPES.includes(media.mimeType)) {
    throw new BadRequestException(`不支持的视频格式：${media.mimeType}`);
  }

  // 3. Redis 分布式锁（SETNX, 3s TTL, uuid 持有者标识）→ 保证幂等性原子化
  const lockKey = `lock:video-separate:${nodeId}`;
  const lockValue = crypto.randomUUID();  // 持有者标识，预留手动释放校验能力
  const locked = await this.redis.set(lockKey, lockValue, 'EX', 3, 'NX');
  if (!locked) {
    throw new BadRequestException('操作过于频繁，请稍后重试');
  }

  try {
    // 4. 幂等性检查（锁内二次确认）
    const existing = await this.prisma.videoSeparateTask.findFirst({
      where: { nodeId, status: { in: ['queued', 'processing'] } },
      select: { id: true },
    });
    if (existing) return { taskId: existing.id };

    // 5. 创建任务记录 + 入队
    const task = await this.prisma.videoSeparateTask.create({
      data: { userId, workflowId, nodeId, sourceFileId: fileId, mode: 'split', status: 'queued' },
    });

    await this.separateQueue.add('video-separate', {
      taskId: task.id, userId, sourceFileId: fileId,
      sourceKey: media.key, sourceOriginalName: media.originalName,
      sourceMimeType: media.mimeType, sourceSize: media.size,
      projectId: media.projectId ?? workflowId, nodeId,
    }, { jobId: task.id });

    // 6. 入队成功后再 INCR 并发计数（避免入队失败泄漏）
    const concurrencyKey = `user:media-task:${userId}`;
    await this.redis.incr(concurrencyKey);
    await this.redis.expire(concurrencyKey, 3600); // TTL 1h，对齐任务最大生命周期

    return { taskId: task.id };
  } catch (error) {
    // 入队失败：锁自动过期（3s），不增加计数
    throw error;
  }
}
```

#### Worker 核心流程（含 job.moveToFailed 修正）

```typescript
async process(job: Job<VideoSeparateJobData>): Promise<VideoSeparateJobResult> {
  const { taskId, userId, sourceFileId, sourceKey, sourceOriginalName, sourceMimeType, projectId, nodeId } = job.data;

  // path.join 防路径遍历 + path.extname 白名单校验
  const rawExt = path.extname(sourceOriginalName).toLowerCase().replace('.', '');
  const ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : 'mp4';
  const safeBaseName = path.basename(sourceOriginalName, path.extname(sourceOriginalName))
    .replace(/[^a-zA-Z0-9_\-一-鿿]/g, '_');
  const outputDir = path.join(TEMP_SEPARATE_DIR, taskId);

  try {
    // 入口：更新状态为 processing + Socket 推送
    await this.separateService.setTaskProcessing(taskId);
    await job.updateProgress(5);

    // 创建临时目录
    await mkdir(outputDir, { recursive: true });

    // 实时生成预签名 URL（30min）
    const presignedUrl = await this.minio.generatePresignedGetUrl(sourceKey, 1800);

    // 下载源文件到本地（独立超时 10min + 1 次重试，覆盖 MinIO 临时波动）
    const inputPath = path.join(outputDir, `input.${ext}`);
    await this.downloadWithRetry(presignedUrl, inputPath, { timeoutMs: 600_000, retries: 1 });
    await job.updateProgress(20);

    // ffprobe 元数据采集（复用 MediaProcessService — 一次 ffprobe 全量提取）
    const metadata = await this.mediaProcess.detectMetadata(inputPath);
    // metadata: { duration, width, height, videoCodec, audioCodec, bitrate, ... }
    // 用于后续写入 Media 表，前端无需重复调用 ffprobe

    // ffprobe 检测（复用 MediaProcessService）
    const hasAudio = await this.mediaProcess.detectAudio(inputPath);
    if (!hasAudio) {
      throw new NonRetryableError('NO_AUDIO_TRACK', '视频不包含音频轨道');
    }
    const audioCodec = await this.mediaProcess.detectAudioCodec(inputPath);

    // 提取纯视频
    const videoOutput = path.join(outputDir, `output_video.${ext}`);
    await this.mediaProcess.runFfmpeg(['-i', inputPath, '-an', '-c:v', 'copy', '-y', videoOutput]);
    await job.updateProgress(50);

    // 提取纯音频（根据编码决定 copy / aac 转码）
    const audioOutput = path.join(outputDir, 'output_audio.m4a');
    const audioArgs = (audioCodec === 'aac' || audioCodec === 'mp3')
      ? ['-i', inputPath, '-vn', '-c:a', 'copy', '-y', audioOutput]
      : ['-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', '-y', audioOutput];
    await this.mediaProcess.runFfmpeg(audioArgs);
    await job.updateProgress(80);

    // 上传产物 + 创建 Media（复用 MediaProcessService，写入 ffprobe 元数据）
    const videoMedia = await this.mediaProcess.uploadAndCreateMedia({
      filePath: videoOutput, userId, projectId, nodeId,
      originalName: `${safeBaseName}_无音频.${ext}`,
      mimeType: sourceMimeType, sourceFileId, bizType: 'video_separate',
      metadata: {                                // ffprobe 元数据
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        videoCodec: metadata.videoCodec,
        bitrate: metadata.bitrate,
      },
    });
    const audioMedia = await this.mediaProcess.uploadAndCreateMedia({
      filePath: audioOutput, userId, projectId, nodeId,
      originalName: `${safeBaseName}_分离音频.m4a`,
      mimeType: 'audio/mp4', sourceFileId, bizType: 'video_separate',
      metadata: {
        duration: metadata.duration,
        audioCodec: audioCodec,
        bitrate: metadata.audioBitrate,
      },
    });

    await job.updateProgress(100);

    // 标记完成 + Socket 推送
    await this.separateService.handleTaskCompleted(taskId, videoMedia.id, audioMedia.id);

    // Redis 并发计数释放
    await this.redis.decr(`user:media-task:${userId}`);

    return { videoFileId: videoMedia.id, audioFileId: audioMedia.id };

  } catch (error) {
    // Redis 并发计数释放（无论成功失败都释放）
    await this.redis.decr(`user:media-task:${userId}`);

    if (error instanceof NonRetryableError) {
      // 业务错误：更新 DB → job.moveToFailed() → return（不 throw）
      await this.separateService.handleTaskFailed(taskId, error.message, error.errorType);
      await job.moveToFailed({ message: error.message });
      return { videoFileId: null, audioFileId: null };
      // ↑ BullMQ 将此 Job 标记为 failed，与 DB status='error' 严格一致
    }

    // 基础设施错误：更新 DB → throw（触发 BullMQ 3 次重试）
    const errorType = this.classifyError(error);
    await this.separateService.handleTaskFailed(taskId, error.message, errorType);
    throw error;
  } finally {
    // 多层清理保证
    await this.mediaProcess.cleanupTempDir(taskId, TEMP_SEPARATE_DIR);
  }
}
```

### 3.6 NonRetryableError 与 job.moveToFailed 设计

```typescript
// video-separate.types.ts
export class NonRetryableError extends Error {
  constructor(
    public readonly errorType: string,   // NO_AUDIO_TRACK | FILE_CORRUPTED | CODEC_UNSUPPORTED
    message: string,
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
```

**状态一致性保证**：

| 场景 | DB VideoSeparateTask.status | BullMQ Job 状态 | 方式 |
|------|---------------------------|----------------|------|
| 业务错误（无音频轨） | `error` | `failed` | `job.moveToFailed()` |
| 基础设施错误（MinIO 超时） | `error` | `failed`（3 次重试后） | throw Error |
| 分离成功 | `done` | `completed` | 正常 return |

### 3.7 FFmpeg 错误结构化存储

```typescript
private classifyError(error: Error): string {
  const msg = error.message;
  if (msg.includes('No such file') || msg.includes('Invalid data')) return 'FILE_CORRUPTED';
  if (msg.includes('Connection refused') || msg.includes('ETIMEDOUT')) return 'MINIO_UPLOAD_FAILED';
  if (msg.includes('SIGKILL') || msg.includes('timeout')) return 'FFMPEG_TIMEOUT';
  if (msg.includes('Unsupported codec')) return 'CODEC_UNSUPPORTED';
  return 'UNKNOWN';
}
```

- `errorType` 存入 DB 字段，用于 Prometheus 统计
- 完整 stderr 上报 Sentry，**将 errorType、taskId、fileSize、userId 作为 Sentry Tag**：
  ```typescript
  Sentry.captureException(error, {
    tags: {
      module: 'video-separate',
      errorType: errorType,
      taskId: taskId,
      fileSize: sourceSize,
      userId: userId,
    },
    extra: {
      stderr: fullStderr,
      args: ffmpegArgs,
    },
  });
  ```
  Tag 化后可实现按错误类型聚合、按文件大小范围筛选、按用户关联排查，快速定位高频问题。

### 3.8 Redis 并发计数泄漏兜底

**三层防护**：

| 层级 | 机制 | 说明 |
|------|------|------|
| 1. 入队后 INCR | 仅在 `separateQueue.add()` 成功后 `INCR` | 入队失败不计数 |
| 2. TTL 自动过期 | `EXPIRE key 3600`（1 小时） | 对齐任务最大生命周期 |
| 3. 定时任务校准 | 每日凌晨 2:00 扫描 >1h 的 queued/processing 任务 | 自动标记超时失败 + 扣减计数 + Sentry 告警 |

```typescript
// 定时任务（cron: 0 2 * * *）
async reconcileStaleTasks() {
  const staleTasks = await this.prisma.videoSeparateTask.findMany({
    where: {
      status: { in: ['queued', 'processing'] },
      createdAt: { lt: new Date(Date.now() - 3600_000) }, // 1 小时前
    },
    select: { id: true, userId: true, nodeId: true },
  });

  for (const task of staleTasks) {
    await this.prisma.videoSeparateTask.update({
      where: { id: task.id },
      data: { status: 'error', errorMsg: '任务超时，系统自动取消', errorType: 'TASK_TIMEOUT', finishedAt: new Date() },
    });
    await this.redis.decr(`user:media-task:${task.userId}`);
    this.logger.warn(`Stale task ${task.id} auto-failed for user ${task.userId}`);
  }
}
```

> **可选增强**：将简单计数 (`INCR`/`DECR`) 升级为 Redis Set 存储活跃 `taskId`，通过 `SCARD` 判断并发数，校准任务可直接从 Set 中 `SREM` 剔除，无需依赖计数绝对值。

### 3.9 幂等性分布式锁

```typescript
// Redis SETNX，锁 key: lock:video-separate:{nodeId}，TTL 3s
const lockKey = `lock:video-separate:${nodeId}`;
const locked = await this.redis.set(lockKey, '1', 'EX', 3, 'NX');
if (!locked) {
  throw new BadRequestException('操作过于频繁，请稍后重试');
}
```

- 3 秒锁覆盖正常请求往返时间（< 100ms），足够防止重复点击
- 锁自动过期，无需手动释放，避免死锁

### 3.10 路径安全

```typescript
import path from 'path';

const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

// 使用 path.extname + 白名单校验
const rawExt = path.extname(sourceOriginalName).toLowerCase().replace('.', '');
const ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : 'mp4';

// 使用 path.basename 剥离路径，过滤特殊字符
const safeBaseName = path.basename(sourceOriginalName, path.extname(sourceOriginalName))
  .replace(/[^a-zA-Z0-9_\-一-鿿]/g, '_');

// 使用 path.join 拼接路径（禁止字符串拼接）
const outputDir = path.join(TEMP_SEPARATE_DIR, taskId);
const inputPath = path.join(outputDir, `input.${ext}`);
```

### 3.11 Socket.io 事件

```typescript
// ExecutionGateway 新增
emitSeparateStatus(workflowId: string, data: {
  nodeId: string;
  taskId: string;
  status: 'processing' | 'done' | 'error';
  videoFileId?: string;
  audioFileId?: string;
  error?: string;
}) {
  this.server.to(`project:${workflowId}`).emit('video-separate:status', data);
}
```

### 3.12 文件下载独立超时与重试

```typescript
// MediaProcessService 内
async downloadWithRetry(
  url: string,
  destPath: string,
  options: { timeoutMs: number; retries: number },
): Promise<void> {
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      await this.downloadFile(url, destPath, options.timeoutMs);
      return;
    } catch (err) {
      if (attempt === options.retries) throw err;
      this.logger.warn(`Download retry ${attempt + 1}/${options.retries}: ${err.message}`);
    }
  }
}
```

- 独立超时 10 分钟（不依赖 FFmpeg 整体 5 分钟限制，大文件下载需要更长时间）
- 1 次重试，覆盖 MinIO 临时网络波动
- 下载失败不触发全任务重试，仅在 Worker 内重试下载本身

### 3.13 Prometheus 指标命名规范

```typescript
// 对齐项目现有监控命名风格
const metrics = {
  // 任务执行耗时直方图（秒）
  media_separate_duration_seconds: new Histogram({
    name: 'media_separate_duration_seconds',
    help: 'Video separate task duration in seconds',
    buckets: [5, 10, 30, 60, 120, 300],
  }),

  // 任务总数计数器
  media_separate_total: new Counter({
    name: 'media_separate_total',
    help: 'Total video separate tasks',
    labelNames: ['status'],  // done | error
  }),

  // 错误数计数器（按 errorType 分类）
  media_separate_errors_total: new Counter({
    name: 'media_separate_errors_total',
    help: 'Video separate errors by type',
    labelNames: ['error_type'],  // NO_AUDIO_TRACK | FILE_CORRUPTED | FFMPEG_TIMEOUT | ...
  }),

  // 队列等待长度
  media_separate_queue_size: new Gauge({
    name: 'media_separate_queue_size',
    help: 'Current video-separate queue waiting count',
  }),
};
```

### 3.14 节点连线 Handle 标识

分离操作创建的子节点连线，明确指定 handle 标识：

| 连线 | sourceHandle | targetHandle | 语义 |
|------|-------------|-------------|------|
| 源 → 纯视频子节点 | `output:video` | `input:default` | 视频输出 |
| 源 → 纯音频子节点 | `output:audio` | `input:default` | 音频输出 |

```typescript
// canvasStore.addEdge 调用时传递 handle 标识
const videoEdge: Edge = {
  id: getId('edge'),
  source: sourceId,
  target: videoChildId,
  sourceHandle: 'output:video',
  targetHandle: 'input:default',
};
const audioEdge: Edge = {
  id: getId('edge'),
  source: sourceId,
  target: audioChildId,
  sourceHandle: 'output:audio',
  targetHandle: 'input:default',
};
```

### 3.15 子节点语义化命名

新创建的子节点默认标题继承源节点标题 + 操作后缀：

```typescript
// 源节点标题（从 VideoGenNode 的 label state 读取）
const sourceTitle = useNodeStore.getState().nodes[id]?.data?.label || 'Video';

// 子节点初始数据
videoChildData: { label: `${sourceTitle}-无音频`, ... }
audioChildData: { label: `${sourceTitle}-分离音频`, ... }
```

> 注：当前 VideoGenNode/AudioGenNode 的 label 存储在组件内部 state，需同步到 nodeStore.data 中。若尚未同步，一期可先将 label 写入 nodeData.label 字段。

### 3.16 nodeProcessMap 全量迁移（本期统一完成）

本次迭代将 canvasStore 中所有分散的处理状态字段统一迁移到 `nodeProcessMap`：

| 迁移前（分散字段） | 迁移后（nodeProcessMap） |
|-------------------|------------------------|
| `splittingNodeId: string \| null` | `nodeProcessMap[id] = { processType: 'splitting', ... }` |
| `splitAbortMap: Record<string, AbortController>` | `nodeProcessMap[id].abortController` |
| `separatingNodeId`（本期新增） | `nodeProcessMap[id] = { processType: 'separating', ... }` |
| 视频裁剪处理态（组件内部 state） | `nodeProcessMap[id] = { processType: 'trimming', ... }` |

迁移后删除 `splittingNodeId`、`splitAbortMap` 等旧字段，统一通过 `nodeProcessMap` 读写。

---

GET 状态查询接口权限校验：

```typescript
async getTaskStatus(taskId: string, userId: string) {
  const task = await this.prisma.videoSeparateTask.findUnique({
    where: { id: taskId },
    select: { status: true, videoFileId: true, audioFileId: true, errorMsg: true, userId: true },
  });
  if (!task || task.userId !== userId) {
    throw new ForbiddenException('task not found or access denied');
  }
  return { status: task.status, videoFileId: task.videoFileId, audioFileId: task.audioFileId, error: task.errorMsg };
}
```

---

## 四、前端架构

### 4.1 队列选择

**独立 `video-separate` 队列**，与现有 `video-trim`、`ai-image-edit` 等保持一致。多队列合并为后续优化项。

### 4.2 队列常量全局统一管理 + 并发数适配

```typescript
// apps/api/src/config/queue.constants.ts（新建）
export const QUEUE_NAMES = {
  EXECUTION: 'execution',
  VIDEO_TRIM: 'video-trim',
  VIDEO_SEPARATE: 'video-separate',
  AI_IMAGE_EDIT: 'ai-image-edit',
  AI_DOWNLOAD: 'ai-result-download',
  THUMBNAIL_GENERATOR: 'thumbnail-generator',
  TEMP_CLEANUP: 'temp-file-cleanup',
} as const;

// FFmpeg 为 CPU 密集型任务，并发过高会导致上下文切换开销增大、整体吞吐量下降
// 流复制（-c copy）为主的场景：CPU 核心数；转码为主的场景：核心数 × 0.7
const CPU_CORES = require('os').cpus().length;
export const QUEUE_CONCURRENCY = {
  DEFAULT: CPU_CORES,
  VIDEO_SEPARATE: Math.max(1, Math.floor(CPU_CORES)),     // 流复制为主
  VIDEO_TRIM: Math.max(1, Math.floor(CPU_CORES * 0.7)),   // 转码为主
} as const;
```

### 4.3 Hook 通用化

两层架构：基础 `useAsyncMediaTask` + 业务 Hook。

```typescript
// apps/web/src/hooks/useAsyncMediaTask.ts（新建 ~50 行）
interface AsyncMediaTaskOptions {
  taskId: string | null;
  socket: any;
  nodeId?: string;
  socketEvent: string;
  pollFn: (taskId: string) => Promise<{ status: string; [key: string]: any }>;
}

export function useAsyncMediaTask(options: AsyncMediaTaskOptions): AsyncMediaTaskResult {
  // Socket 监听 + 轮询降级 + 状态管理
}

// apps/web/src/hooks/useVideoSeparateTask.ts（新建 ~20 行）
export function useVideoSeparateTask(taskId, socket, nodeId?) {
  return useAsyncMediaTask({
    taskId, socket, nodeId,
    socketEvent: 'video-separate:status',
    pollFn: videoSeparateApi.getTaskStatus,
  });
}

// useTrimTaskStatus 重构为基于 useAsyncMediaTask（~15 行）
```

### 4.4 前端状态统一收敛至 nodeProcessMap

**放弃**独立 `separatingNodeId` + `separateAbortMap` 字段。**统一**使用 `nodeProcessMap` 管理所有节点处理态：

```typescript
// apps/web/src/stores/canvasStore.ts

type ProcessType = 'generating' | 'trimming' | 'separating' | 'splitting' | 'uploading';

interface NodeProcessState {
  processType: ProcessType;
  status: 'processing' | 'done' | 'error';
  progress?: number;
  errorMsg?: string;
  abortController?: AbortController;
}

interface CanvasState {
  // 替代分散的 splittingNodeId / separatingNodeId / ... 等字段
  nodeProcessMap: Record<string, NodeProcessState>;

  // 操作方法
  startNodeProcess: (nodeId: string, processType: ProcessType, abortController?: AbortController) => void;
  updateNodeProcessProgress: (nodeId: string, progress: number) => void;
  finishNodeProcess: (nodeId: string, status: 'done' | 'error', errorMsg?: string) => void;
  cancelNodeProcess: (nodeId: string) => void;
}
```

**迁移说明**：
- 现有 `splittingNodeId` + `splitAbortMap` 逻辑迁移到 `nodeProcessMap` 的 `processType: 'splitting'` 条目
- `startNodeProcess(id, 'separating', ac)` 替代 `separatingNodeId = id`
- `finishNodeProcess(id, 'done')` 清除状态
- 删除节点时统一调用 `cancelNodeProcess(id)`

### 4.5 前端提交失败状态恢复

```typescript
// VideoGenNode.tsx 提交逻辑
const handleSeparate = useCallback(async (type: 'split') => {
  const targetFileId = fileId || referenceVideo;
  if (!targetFileId) return;

  setAudioSeparatingType(type);
  canvasStore.startNodeProcess(id, 'separating');

  try {
    const { taskId } = await videoSeparateApi.submitSeparate({
      fileId: targetFileId,
      nodeId: id,
      mode: type,
    });
    setSeparateTaskId(taskId);
  } catch (err) {
    // 网络错误/接口报错 → 恢复状态
    const msg = err instanceof Error ? err.message : '请求失败';
    message.error(msg);
    setAudioSeparatingType(null);
    canvasStore.finishNodeProcess(id, 'error', msg);
  }
}, [fileId, referenceVideo, id, canvasStore]);
```

### 4.6 子节点数据完整性校验

```typescript
// 创建子节点前校验
const NODE_TYPE_REGISTRY = ['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen'];

function validateChildNodeType(type: string): void {
  if (!NODE_TYPE_REGISTRY.includes(type)) {
    throw new Error(`Unknown node type: ${type}`);
  }
}

// 创建音频子节点
validateChildNodeType('audioGen');
canvasStore.addChildNodes(id, [
  {
    data: {
      fileId: videoFileId,
      status: 'done',
      // 视频节点字段补全
    },
    gridRow: 0, gridCol: 0,
    nodeType: 'videoGen',
  },
  {
    data: {
      fileId: audioFileId,
      status: 'done',
      // 音频节点字段补全（与普通上传节点保持一致）
    },
    gridRow: 1, gridCol: 0,
    nodeType: 'audioGen',
  },
]);
```

### 4.7 Socket 回调中的节点存在性检查

```typescript
const handleSeparateStatus = (data) => {
  if (data.taskId !== separateTaskId) return;

  if (data.status === 'done') {
    const sourceNode = useCanvasStore.getState().nodes.find(n => n.id === id);
    if (!sourceNode) return; // 源节点已删除，静默丢弃
    // ... 创建子节点
  }
};
```

### 4.8 addChildNodes 碰撞检测

```typescript
function resolveGridPosition(
  baseX, baseY, gridRow, gridCol,
  nodeW, nodeH, existingNodes, gap,
): { x: number; y: number } {
  let col = gridCol;
  for (let attempt = 0; attempt < 10; attempt++) {
    const x = baseX + col * (nodeW + gap);
    const y = baseY + gridRow * (nodeH + gap);
    if (!overlaps(x, y, nodeW, nodeH, existingNodes)) return { x, y };
    col++;
  }
  return { x: baseX, y: baseY + (gridRow + 1) * (nodeH + gap) };
}
```

---

## 五、约束与边界

| 约束项 | 值 | 说明 |
|--------|-----|------|
| 最大文件大小 | 2GB | DB `media.size` 字段前置校验 |
| 支持格式 | mp4, mov, webm, mkv, avi | DB `media.mimeType` + 扩展名白名单 |
| Worker 超时 | 5 分钟 | OS 级 `SIGKILL`（`MediaProcessService.runFfmpeg`） |
| 文件下载超时 | 10 分钟 + 1 次重试 | 独立于 FFmpeg 超时，覆盖大文件下载 + MinIO 波动 |
| BullMQ 重试 | 3 次，指数退避 2s | 仅基础设施错误，业务错误用 `job.moveToFailed()` |
| 队列并发 | CPU 核心数 | FFmpeg CPU 密集型任务，避免上下文切换开销 |
| 用户并发上限 | 3 个 | Redis INCR 原子计数（入队成功后 +1） |
| 并发计数 TTL | 1 小时 | 对齐任务最大生命周期 |
| 幂等锁 TTL | 3 秒 | Redis SETNX（uuid 持有者标识），自动过期 |
| 预签名 URL 有效期 | 30 分钟 | Worker 内实时生成 |
| 临时文件清理 | Worker finally + 启动清理 + 每日 cron | 三层保证 |
| 定时校准任务 | 每日凌晨 2:00 | 扫描 >1h 的 stale 任务 |

---

## 六、边界情况

| 场景 | 处理 |
|------|------|
| 无音频轨 | Worker ffprobe → `NonRetryableError('NO_AUDIO_TRACK')` → `job.moveToFailed()` |
| 非 AAC 编码（Opus/AC3） | Worker 降级转码 AAC |
| 文件所有权校验失败 | `ForbiddenException`（403） |
| 文件 > 2GB | `BadRequestException` |
| 不支持格式 | `BadRequestException`（基于 mimeType） |
| 短时间内重复点击 | Redis SETNX 锁（3s）→ "操作频繁" |
| 同一 nodeId 已有活跃任务 | 锁内幂等检查 → 返回已有 taskId |
| 用户并发 > 3 | Redis 原子计数 → "处理任务过多" |
| 入队失败（BullMQ 异常） | 不增加计数，锁自动过期 |
| 预签名 URL 过期 | Worker 内实时生成，不复用 Controller URL |
| FFmpeg 僵死 | OS 级 5min timeout → SIGKILL（`MediaProcessService`） |
| MinIO 下载失败 | throw Error → BullMQ 重试 3 次 |
| 文件损坏/编码不支持 | `NonRetryableError('FILE_CORRUPTED')` → `job.moveToFailed()` |
| Worker 进程崩溃（OOM/KILL） | 计数 TTL 1h + 每日 cron 校准兜底 |
| 处理中途源节点被删除 | 前端 Socket 回调检查节点存在性 → 静默丢弃 |
| 前端提交请求失败 | 恢复按钮状态 + Toast 错误 |
| 路径遍历攻击（文件名含 `../`） | `path.basename` + 扩展名白名单 + `path.join` |
| 越权查询他人任务 | GET API 校验 `task.userId === userId` → 403 |
| 组件卸载/重渲染 | 状态在 `nodeProcessMap` 中，不丢失 |

---

## 七、非功能需求

| 指标 | 目标 |
|------|------|
| Controller 响应耗时 | < 100ms（无 ffprobe / 文件 IO） |
| 分离总耗时（流复制，<500MB） | < 30s |
| 分离总耗时（转码，<500MB） | < 90s |
| 纯视频产物格式 | 与源文件相同容器 |
| 纯音频产物格式 | m4a（AAC） |
| 产物文件名 | `{原文件名}_无音频.mp4` / `{原文件名}_分离音频.m4a` |
| 子节点布局 | 源节点右侧 120px，视频(row 0) 音频(row 1)，gridCol++ 碰撞偏移 |
| 前端新 npm 依赖 | **零** |
| Sentry 上报 | FFmpeg 完整 stderr + taskId + fileId + 文件大小 |
| Prometheus 指标 | 分离耗时、成功率、失败原因分类（errorType） |
| DB 与 BullMQ 状态一致性 | 严格一一对应（`job.moveToFailed` 保证） |

---

## 八、核心测试用例（TDD 前置）

### 8.1 后端 Service

| # | 测试用例 | 验证点 |
|---|---------|--------|
| 1 | submitSeparate 正常入队 | 返回 taskId，status='queued' |
| 2 | 文件无所有权 → ForbiddenException | 403 |
| 3 | 文件 > 2GB → BadRequestException | 错误信息含"过大" |
| 4 | 不支持 mimeType → BadRequestException | 错误信息含"不支持" |
| 5 | Redis SETNX 锁 → 并发 2 请求 → 1 通过 1 拒绝 | 幂等锁生效 |
| 6 | 锁内幂等性：同一 nodeId 已有 queued → 返回已有 taskId | 幂等返回 |
| 7 | 用户并发第 4 个任务 → BadRequestException | Redis 计数生效 |
| 8 | BullMQ 入队失败 → 不 INCR 计数 | 计数不变 |
| 9 | getTaskStatus 正常返回 | status + videoFileId + audioFileId |
| 10 | getTaskStatus 跨用户查询 → ForbiddenException | userId 校验 |

### 8.2 MediaProcessService（公共层）

| # | 测试用例 | 验证点 |
|---|---------|--------|
| 11 | detectAudio：有音频轨 → true | ffprobe 检测正确 |
| 12 | detectAudio：无音频轨 → false | 静默视频 |
| 13 | detectAudioCodec：AAC 编码 → 'aac' | 编码识别正确 |
| 14 | runFfmpeg：正常执行 → resolve | 进程退出码 0 |
| 15 | runFfmpeg：超时 → SIGKILL → reject | 5min 超时 |
| 16 | uploadAndCreateMedia：含 sourceFileId + bizType | 血缘字段完整 |
| 17 | cleanupTempDir：目录删除 | 目录不存在 |

### 8.3 后端 Worker

| # | 测试用例 | 验证点 |
|---|---------|--------|
| 18 | 入口更新 status='processing' + Socket 推送 | processing 事件 |
| 19 | path.join 防路径遍历（文件名含 `../`） | 安全处理 |
| 20 | 下载失败 → 1 次重试成功 | 重试后正常继续 |
| 21 | 下载 2 次均失败 → throw Error → BullMQ 重试 | 全任务重试 |
| 22 | ffprobe detectMetadata 返回完整元数据 | duration/width/height/codec 非空 |
| 23 | AAC 音频 → 流复制 | videoFileId + audioFileId |
| 24 | Opus 音频 → 降级转码 AAC | audioFileId 非空 |
| 25 | 无音频轨 → NonRetryableError → job.moveToFailed() | BullMQ Job='failed', DB='error' |
| 26 | DB error + BullMQ failed 状态一致 | 严格一一对应 |
| 27 | MinIO 下载失败 → throw → BullMQ 重试 3 次 | 自动重试 |
| 28 | 3 次重试后仍失败 → status='error' | errorType + errorMsg |
| 29 | finally 块清理临时目录 | 目录不存在 |
| 30 | Redis DECR 释放并发计数 | 计数 -1 |
| 31 | 产物文件名语义化（含"无音频"/"分离音频"） | originalName |
| 32 | 产物 Media 含 metadata（duration/codec 等） | metadata JSON 非空 |
| 33 | Sentry 上报含 tags（errorType/taskId/fileSize/userId） | tags 字段完整 |
| 34 | Prometheus 指标正确注册 | histogram/counter/gauge |
| 35 | 进程启动清理残留目录 | `/tmp/video-separate/*` 为空 |

### 8.4 定时校准任务

| # | 测试用例 | 验证点 |
|---|---------|--------|
| 36 | 扫描 >1h 的 queued/processing 任务 | 标记 error + DECR 计数 |
| 37 | 正常任务（<1h）不被扫到 | 不误伤 |

### 8.5 前端

| # | 测试用例 | 验证点 |
|---|---------|--------|
| 41 | useAsyncMediaTask：Socket 事件 → 状态更新 | 状态正确 |
| 42 | useAsyncMediaTask：轮询降级 | pollFn 被调用 |
| 43 | useAsyncMediaTask：终端状态停止轮询 | clearInterval |
| 44 | useVideoSeparateTask 监听正确事件 | 'video-separate:status' |
| 45 | 提交失败（网络错误）→ 按钮恢复 | audioSeparatingType = null |
| 46 | nodeProcessMap.startNodeProcess → 状态写入 | processType='separating' |
| 47 | nodeProcessMap.finishNodeProcess → 状态清除 | 条目删除 |
| 48 | 删除节点 → cancelNodeProcess 调用 | AbortController.abort() |
| 49 | splittingNodeId → nodeProcessMap 迁移兼容 | 图片切分功能正常 |
| 50 | 「音视频分离」→ onAudioSeparate('split') | 回调正确 |
| 51 | 「仅保留人声」disabled + tooltip | UI 正确 |
| 52 | 子节点标题继承源节点标题 + "-无音频" | label 字段正确 |
| 53 | 子节点标题继承源节点标题 + "-分离音频" | label 字段正确 |

### 8.6 集成测试

| # | 测试用例 | 验证点 |
|---|---------|--------|
| 54 | 端到端分离成功 → 2 个子节点 + 2 条 edge（含 handle 标识） | nodes +2, edges +2, handle 正确 |
| 55 | 端到端分离成功 → 选中视频子节点 | selectedId = videoChild.id |
| 56 | 端到端分离失败 → 不创建节点 | nodes/edges 不变 |
| 57 | 源节点删除后分离完成 → 不崩溃 | 静默丢弃 |
| 58 | 碰撞检测：目标位置已有节点 → gridCol++ | 无重叠 |
| 59 | 子节点数据完整性：audioGen 节点字段齐全 | fileId/status/label 正确 |
| 60 | Media 表含 ffprobe 元数据 | duration/width/height/codec 非空 |
| 61 | Prometheus 指标：分离成功 → duration_seconds + total{status="done"} +1 | 指标值正确 |
| 62 | Prometheus 指标：分离失败 → total{status="error"} +1, errors_total{error_type} +1 | 指标值正确 |
| 63 | Sentry 上报含 tags（errorType/taskId/fileSize/userId） | tags 字段完整 |
| 64 | 源节点无 label → 子节点默认标题 "Video-无音频" | 兜底默认值 |

---

## 九、不在一期范围

- 「仅保留人声」（需 AI 模型）
- 「仅保留背景音」（同上）
- 分离预览/确认弹窗
- 批量分离
- 多队列合并为统一 media-process 队列
- Redis Set 替代简单计数（后续优化项）
- video-trim 重构使用 MediaProcessService（后续优化项，不影响本期交付）

---

## 十、文件变更清单

| 层级 | 文件 | 动作 | 说明 |
|------|------|------|------|
| **数据库** | | | |
| API | `prisma/schema.prisma` | **修改** | 新增 `VideoSeparateTask` 模型（含 `errorType`）；Media 表新增 `metadata` JSON 字段（可选） |
| **后端 — 公共能力层** | | | |
| API | `.../media-process/media-process.module.ts` | **新建** | 模块注册 |
| API | `.../media-process/media-process.service.ts` | **新建** | FFmpeg 执行 + ffprobe 检测（含 `detectMetadata`）+ MinIO 上传 + 临时清理 + `downloadWithRetry` |
| API | `.../config/queue.constants.ts` | **新建** | 队列名称/并发数全局常量（适配 CPU 密集型） |
| **后端 — 分离功能** | | | |
| API | `.../execution/video-separate.constants.ts` | **新建** | 队列名、路径、限制 |
| API | `.../execution/video-separate.types.ts` | **新建** | 类型 + `NonRetryableError` |
| API | `.../execution/video-separate.controller.ts` | **新建** | REST 端点 |
| API | `.../execution/video-separate.service.ts` | **新建** | 业务逻辑：uuid 锁、幂等、计数、入队、状态查询、推送 |
| API | `.../execution/video-separate.processor.ts` | **新建** | BullMQ Worker：下载（独立超时+重试）、ffprobe、FFmpeg、上传（含 metadata）、清理 |
| API | `.../execution/video-separate.cron.ts` | **新建** | 每日校准 stale 任务 |
| API | `.../execution/video-separate.metrics.ts` | **新建** | Prometheus 指标注册 |
| API | `.../execution/execution.module.ts` | **修改** | 注册队列 + Processor + Controller + Cron |
| API | `.../gateway/execution.gateway.ts` | **修改** | 新增 `emitSeparateStatus` |
| **前端** | | | |
| Web | `.../services/video-separate.api.ts` | **新建** | API 客户端（~25 行） |
| Web | `.../hooks/useAsyncMediaTask.ts` | **新建** | 通用异步媒体任务 Hook（~50 行） |
| Web | `.../hooks/useVideoSeparateTask.ts` | **新建** | 分离业务 Hook（~20 行） |
| Web | `.../hooks/useTrimTaskStatus.ts` | **修改** | 重构为基于 `useAsyncMediaTask`（~15 行） |
| Web | `.../nodes/VideoGenNode.tsx` | **修改** | 集成分离流程 + label 同步到 nodeStore + 子节点语义命名 |
| Web | `.../nodes/VideoNodeToolbar.tsx` | **修改** | 仅保留人声/背景音 disabled + tooltip |
| Web | `.../stores/canvasStore.ts` | **修改** | 新增 `nodeProcessMap` + 操作方法 → **全量迁移 splittingNodeId/splitAbortMap**；`addChildNodes` 扩展 `nodeType` + 碰撞检测 + handle 标识 |
| Web | `.../nodes/ImageGenNode.tsx` | **修改** | splittingNodeId/splitAbortMap → nodeProcessMap 适配 |
| Web | `.../pages/canvas/page.tsx` | **修改** | splitAbortMap → nodeProcessMap 适配 |
