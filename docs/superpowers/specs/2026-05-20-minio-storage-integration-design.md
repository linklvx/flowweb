# MinIO 对象存储集成 — 设计文档

**版本**: 1.1  
**日期**: 2026-05-20  
**MinIO 版本**: RELEASE.2025-12-18T08-51-09Z LTS  
**状态**: MVP 设计

---

## 1. 概述

### 1.1 目标

将 FlowAI 画布应用的媒体资源管理从"外部 URL 引用"升级为"MinIO 对象存储 + 文件上传"，覆盖三大场景：

| 场景 | 类型标记 | 访问方式 | 上传方 |
|------|----------|----------|--------|
| 用户上传参考图/帧 | `uploaded` | 预签名 URL | 前端直传 MinIO |
| AI 生成图片/视频 | `generated` | 预签名 URL | 后端 Worker 上传 |
| 临时文件 | `temp` | 预签名 URL（7 天过期） | 任意 |

### 1.2 核心原则

- **安全优先**: 所有私有资源统一使用预签名 URL，无公开访问
- **fileId 解耦**: 前端/数据库只存 `fileId`，URL 通过统一接口按需获取
- **异步处理**: IO 密集型操作（AI 结果下载/上传）在 BullMQ Worker 中执行
- **零过度设计**: 不做多租户、CDN、分片上传 — 保留扩展点，需要时再加

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────┐     presigned POST    ┌───────────┐
│   前端 Vite  │ ──────────────────→  │   MinIO    │
│   :5173     │                       │   :9000    │
└──────┬──────┘                       └─────┬─────┘
       │ presign/confirm                    │ SDK upload
       ▼                                    ▼
┌─────────────┐     BullMQ Queue    ┌──────────────┐
│  NestJS API │ ←─────────────────  │    Worker    │
│   :3000     │     AI result       │   (BullMQ)   │
└──────┬──────┘     download/upload  └──────┬───────┘
       │                                    │
       ▼                                    ▼
┌─────────────┐                     ┌──────────────┐
│  PostgreSQL  │                     │  AI API 服务  │
│  (Media表)   │                     │  (外部)       │
└─────────────┘                     └──────────────┘
```

### 2.2 Bucket 结构

```
flowai/                                          ← 私有 Bucket
├── uploads/{userId}/{YYYY-MM-DD}/{uuid}.{ext}   ← 用户上传参考图
├── results/{userId}/{projectId}/{nodeId}/{YYYY-MM-DD}/{uuid}.{ext}  ← AI 生成
└── temp/{userId}/{YYYY-MM-DD}/{uuid}.{ext}      ← 临时文件 (7天过期)
```

设计要点:
- **日期分区**: `{YYYY-MM-DD}` 防止单目录文件膨胀超过 100 万
- **userId 顶层隔离**: 替代 tenantId（当前无多租户需求）
- **projectId/nodeId**: results 目录关联到具体项目和节点

### 2.3 数据模型

```prisma
model Media {
  id           String    @id @default(uuid())
  userId       String

  // 存储信息
  bucket       String    @default("flowai")
  key          String    // MinIO 对象键
  originalName String    // 用户上传的原始文件名
  mimeType     String
  size         Int       // 字节数

  // 业务关联
  projectId    String?
  nodeId       String?
  taskId       String?

  // 状态与类型
  status       String    @default("pending")  // pending | completed | failed
  type         String    // uploaded | generated | temp

  // 时间戳
  createdAt    DateTime  @default(now())
  expiresAt    DateTime? // 临时文件过期时间

  @@index([userId])
  @@index([projectId])
  @@index([nodeId])
  @@index([taskId])
  @@index([expiresAt])
}
```

**关键设计**:
- 前端 node data 只存 `fileId`（如 `{ referenceImage: "abc-123" }`），不存原始 URL
- `status` 字段追踪上传状态:
  - `uploaded` 类型: `pending` → `completed` / `failed`（两阶段: presign → confirm）
  - `generated` 类型: 直接 `completed`（后端同步上传完成后创建）
  - `temp` 类型: `pending`（临时文件不需要 confirm）
- `expiresAt` 用于 temp 类型文件的自动清理

---

## 3. 核心流程

### 3.1 用户上传流程（图片参考图 / 视频参考帧）

```
用户选择/拖拽文件
  │
  ▼
POST /api/storage/presign
  Body: { fileName, fileSize, fileType, type: "uploaded" }
  → 后端创建 Media 记录 (status=pending)
  → 生成带安全限制的 presigned POST URL (CreatePresignedPostCommand)
  ← { fileId, uploadUrl, key, fields }
  │
  ▼
前端 POST uploadUrl → MinIO (FormData)
  将 fields 和 file 拼入 FormData
  浏览器直传，axios onUploadProgress 监控进度
  │
  ▼
POST /api/storage/confirm
  Body: { fileId, key, fileSize }
  → 后端验证 MinIO 文件存在 + 大小校验
  → 更新 Media status=completed
  ← { fileId }
  │
  ▼
前端将 fileId 写入节点 data
```

**前端 POST 上传代码关键点**:
```typescript
const formData = new FormData();
// 先 append presigned fields (key, policy, signature, etc.)
Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
// 最后 append 文件
formData.append('file', file);

await axios.post(uploadUrl, formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  onUploadProgress: (e) => { /* 进度回调 */ },
});
```

### 3.2 AI 生成结果存储流程

```
用户点击执行节点
  │
  ▼
NestJS 创建 Task 记录 → 提交 BullMQ 队列
  │
  ▼
Worker: 调用 AI API 提交生成任务
  │
  ▼
AI 返回临时 resultUrl (有效期 15min~24h)
  │
  ▼
Worker: 提交 "ai-result-download" 任务到 BullMQ
  │
  ▼
下载 Worker: 用 axios (带重试) 下载 AI 结果
  → MinIO SDK 上传到 results/ 目录
  → 创建 Media 记录 (type=generated, status=completed)
  → 更新 Task 状态
  │
  ▼
Socket.io 推送 fileId 给前端
  │
  ▼
前端 GET /api/media/:fileId/url → 获得预签名 URL → 渲染
```

### 3.3 媒体访问流程

```
前端需要显示媒体
  │
  ▼
GET /api/media/:fileId/url
  │
  ▼
后端验证: 同时按 id + userId 查询 Media (防 ID 遍历)
  │
  ▼
Redis 缓存命中? → 直接返回
  │         │
  否       是
  │         │
  ▼         └→ 返回 cachedUrl
生成预签名 URL (15 分钟有效)
  │
  ▼
写入 Redis: key=media:url:{userId}:{fileId}, TTL=840s (14 分钟)
  │
  ▼
返回 { url }
```

### 3.4 临时文件清理流程

```
BullMQ Repeatable Job: "temp-file-cleanup"
Cron: 0 2 * * * (每天凌晨 2 点)
  │
  ▼
查询 Media: type=temp AND expiresAt < now()
  │
  ▼
批量 MinIO: deleteFile(key) for each
批量 DB:     deleteMany where id in (...)
  │
  ▼
日志: Cleaned up {N} temp files
```

---

## 4. API 设计

### 4.1 POST /api/storage/presign

生成预签名上传 URL（使用 `CreatePresignedPostCommand`，基于 POST 表单上传）。

**Request** (Auth required):
```json
{
  "fileName": "reference.png",
  "fileSize": 2048000,
  "fileType": "image/png",
  "type": "uploaded"
}
```

**Response**:
```json
{
  "code": 0,
  "data": {
    "fileId": "uuid",
    "uploadUrl": "http://127.0.0.1:9000/flowai",
    "key": "uploads/userId/2026-05-20/uuid.png",
    "fields": {
      "key": "uploads/userId/2026-05-20/uuid.png",
      "Policy": "...",
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": "...",
      "X-Amz-Date": "...",
      "X-Amz-Signature": "..."
    }
  }
}
```

**安全限制** (在生成 presigned POST 时，通过 `Conditions` 参数):
```
Conditions:
  - content-length-range: [fileSize - 1024, fileSize + 1024]
  - eq $Content-Type: fileType
```

**S3Client 初始化关键配置**:
```typescript
this.s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  credentials: {
    accessKeyId: '...',
    secretAccessKey: '...',
  },
  forcePathStyle: true,  // ★ 必须！MinIO 使用路径风格 URL
});
```

### 4.2 POST /api/storage/confirm

确认上传完成。

**Request** (Auth required):
```json
{
  "fileId": "uuid",
  "key": "uploads/userId/2026-05-20/uuid.png",
  "fileSize": 2048000
}
```

**验证逻辑**:
1. MinIO `statObject(key)` 验证文件存在
2. `stats.size` 与 `fileSize` 比较（容差 ±1024）
3. 不匹配 → 删除 MinIO 文件 + 返回错误

**Response**:
```json
{
  "code": 0,
  "data": { "fileId": "uuid" }
}
```

### 4.3 GET /api/media/:fileId/url

获取媒体预签名下载 URL。

**Request** (Auth required):
```
GET /api/media/abc-123/url
```

**验证逻辑**:
- `prisma.media.findUnique({ where: { id: fileId, userId: currentUser.id } })`
- 不存在 → 404

**缓存逻辑**:
- Redis key: `media:url:{userId}:{fileId}`
- 命中 → 直接返回
- 未命中 → 生成 presigned GET URL (15min) → 写缓存 (14min TTL)

**Response**:
```json
{
  "code": 0,
  "data": { "url": "http://127.0.0.1:9000/flowai/results/...?..." }
}
```

---

## 5. 安全设计

### 5.1 预签名 URL 安全限制

所有上传 presigned URL 必须包含以下 conditions:

| 条件 | 值 | 目的 |
|------|-----|------|
| `content-length-range` | [fileSize-1024, fileSize+1024] | 防超大文件攻击 |
| `eq $Content-Type` | fileType | 防上传可执行文件 |

### 5.2 权限验证

- **上传/确认**: 通过 Auth Guard，用户只能操作自己的文件
- **媒体访问**: `findUnique({ where: { id, userId } })` — 同时按 id 和 userId 查询
- **Redis 缓存隔离**: `media:url:{userId}:{fileId}` — 防止跨用户缓存污染

### 5.3 MinIO IAM 最小权限

生产环境创建专用用户 `flowai-app`，策略:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
      "s3:GetObjectAttributes"
    ],
    "Resource": [
      "arn:aws:s3:::flowai",
      "arn:aws:s3:::flowai/*"
    ]
  }]
}
```

### 5.4 MinIO CORS 配置

```json
{
  "CORSRules": [{
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://flowai.nat100.top"
    ],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD", "OPTIONS"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}
```

### 5.5 文件格式白名单

| 类别 | 允许格式 | 最大大小 |
|------|----------|----------|
| 图片 | image/jpeg, image/png, image/webp, image/gif | 20MB |
| 视频 | video/mp4, video/webm, video/quicktime | 500MB |

---

## 6. 错误处理与重试机制

### 6.1 AI 结果下载重试

使用 `axios-retry`，指数退避:

- 重试次数: 3
- 延迟: 1s → 2s → 4s
- 触发条件: 网络错误 / 5xx 响应

### 6.2 上传失败处理

- presigned URL 有效期 15 分钟，超时需重新获取
- confirm 验证失败 → 删除 MinIO 残留文件 + Media 记录
- 前端上传错误 → 显示错误提示，允许重试

### 6.3 BullMQ 任务失败

- AI 下载任务失败 → 自动重试 (BullMQ 默认 `attempts: 3, backoff: exponential`)
- 临时文件清理失败 → 下次 cron 自动重试

---

## 7. 运维与监控

### 7.1 临时文件自动清理

- 机制: BullMQ Repeatable Job，cron `0 2 * * *`
- 每次最多处理 1000 条
- 先删 MinIO 文件，再删 DB 记录

### 7.2 环境变量与配置

**环境变量** (`.env`):
```env
# MinIO
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=flowai
MINIO_USE_SSL=false
```

**Zod 类型校验** (添加到 `apps/api/src/config/env.ts`):
```typescript
MINIO_ENDPOINT: z.string().url(),
MINIO_ACCESS_KEY: z.string().min(3),
MINIO_SECRET_KEY: z.string().min(8),
MINIO_BUCKET: z.string().default('flowai'),
MINIO_USE_SSL: z.coerce.boolean().default(false),
```

**S3Client 初始化** (关键: `forcePathStyle: true`):
```typescript
this.s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: config.get('MINIO_ENDPOINT'),
  credentials: {
    accessKeyId: config.get('MINIO_ACCESS_KEY'),
    secretAccessKey: config.get('MINIO_SECRET_KEY'),
  },
  forcePathStyle: true,  // ★ MinIO 必须使用路径风格 URL
});
```

**MinIO 启动与 Bucket 创建**:
```bash
# 启动 MinIO (API :9000, Console :9001)
minio.exe server D:\minio-data --console-address :9001

# 手动创建 bucket
mc alias set myminio http://127.0.0.1:9000 minioadmin minioadmin
mc mb myminio/flowai
```

**⚠️ 重要注意事项**:
- **端口区分**: MinIO API 端口为 `9000`（上传下载），控制台端口为 `9001`（管理界面），请勿混淆。浏览器访问 `http://127.0.0.1:9001` 可打开管理控制台（用户名/密码: minioadmin/minioadmin）
- **ENDPOINT 末尾不加斜杠**: `MINIO_ENDPOINT=http://127.0.0.1:9000`（不是 `http://127.0.0.1:9000/`）
- **Windows 路径限制**: 数据目录必须使用纯英文路径，不能包含中文和空格。正确: `D:\minio\data`，错误: `D:\我的项目\minio-data`、`D:\Program Files\minio-data`
- **预签名 URL 格式**: 正确 → `http://127.0.0.1:9000/flowai/uploads/...?X-Amz-...`（路径风格）；错误 → `http://flowai.127.0.0.1:9000/uploads/...`（虚拟主机风格，说明缺少 `forcePathStyle: true`）

**预签名 POST 上传 — 前端关键约束**:
- FormData 中的 `key` 必须**原样使用**后端返回的 `fields.key`，禁止前端自行拼接 key
- FormData 中先 append `fields` 中的所有字段，最后 append 文件（`formData.append('file', file)`）

> **注意**: MinIO 不会自动创建 bucket。首次部署前必须手动执行 `mc mb` 或在启动配置中创建。

### 7.3 监控建议（设计阶段记录，后续实施）

- MinIO 存储容量（通过 mc admin info）
- 每日上传/AI 生成文件数量和大小
- presigned URL 缓存命中率
- 上传/AI 下载失败率

---

## 8. 待实施清单

### 后端 (NestJS)

| 模块 | 内容 |
|------|------|
| MinIO SDK 封装 | Service: upload, delete, presignGet, presignPost, statObject; **S3Client 必须配置 `forcePathStyle: true`** |
| StorageModule | Controller: POST /presign (CreatePresignedPostCommand), POST /confirm |
| MediaModule | Controller: GET /:fileId/url; Service: getMediaUrl (Redis 缓存, key=`media:url:{userId}:{fileId}`) |
| Media Prisma Model | schema.prisma + migration |
| AI Download Worker | BullMQ processor: axios-retry 下载 AI 结果 → MinIO SDK 上传 → 创建 Media (status=completed) |
| Temp Cleanup Worker | BullMQ repeatable job: 每天凌晨 2 点清理过期 temp |
| Env Schema | 新增 MINIO_* 变量到 Zod schema（含类型校验） |

### 前端 (Vite + React)

| 组件/功能 | 内容 |
|------|------|
| FileUpload 组件 | 拖拽/点击上传，进度条，支持图片/视频格式限制；POST FormData 上传 |
| ImageConfigPanel | 新增参考图上传（替换无参考图现状） |
| VideoConfigPanel | 替换 URL 输入框为上传组件（start/end/multi-frame） |
| `useMediaUrl(fileId)` hook | 三态返回 `{ url, loading, error }`；调用 `/api/media/:id/url` → 返回 URL |
| Node data 适配 | 将所有 `resultUrl/videoUrl/startImageUrl` 改为 `fileId` |

**useMediaUrl hook 关键设计**:
```typescript
export function useMediaUrl(fileId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!fileId) { setUrl(null); return; }
    setLoading(true);
    setError(null);
    api.get(`/api/media/${fileId}/url`)
      .then(res => setUrl(res.data.data.url))
      .catch(err => setError(err))
      .finally(() => setLoading(false));
  }, [fileId]);

  return { url, loading, error };
}
```

### 依赖

| 包 | 用途 |
|------|------|
| `@aws-sdk/client-s3` | S3 兼容客户端（MinIO 使用 AWS SDK v3） |
| `@aws-sdk/s3-request-presigner` | 预签名 URL 生成 (`getSignedUrl`) |
| `@aws-sdk/s3-presigned-post` | 预签名 POST 上传 (`createPresignedPost`) |
| `axios` | HTTP 客户端（AI 结果下载 + 前端上传进度） |
| `axios-retry` | 指数退避重试 |

### MinIO 部署

```bash
# 下载 MinIO Windows 二进制 (LTS)
# https://dl.min.io/server/minio/release/windows-amd64/minio.exe

# 启动 (API :9000, Console :9001)
minio.exe server D:\minio-data --console-address :9001

# 首次部署：创建 bucket
mc alias set myminio http://127.0.0.1:9000 minioadmin minioadmin
mc mb myminio/flowai

# 配置 CORS
mc admin config set myminio cors <<EOF
{...}
EOF
```

---

## 9. 未来扩展

| 功能 | 触发条件 | 实现方式 |
|------|----------|----------|
| CDN 加速 | 用户 > 100 人，跨地区访问慢 | `getMediaUrl` 替换 MinIO 地址为 CDN |
| 多租户隔离 | 出现企业客户 | Media 表加 `tenantId`，目录改 `{tenantId}/{userId}/...` |
| 分片上传 | 视频文件常 > 1GB | 扩展 `/api/storage/presign` 支持 Multipart |
| 冷热分层 | 存储 > 10TB | MinIO 控制台配置生命周期规则，代码无需改动 |
| 协作共享 | 用户提出协作需求 | 新增 Share 表，扩展 `getMediaUrl` 权限验证 |

---

## 10. 设计决策记录

| 决策 | 理由 |
|------|------|
| 预签名直传 vs 后端中转 | 大文件不消耗 NestJS 带宽，MinIO 原生支持 |
| POST (FormData) vs PUT | POST 支持更严格的 Conditions 限制，安全性更好 |
| forcePathStyle: true | MinIO 默认路径风格 URL，AWS SDK 默认虚拟主机风格，必须显式指定 |
| fileId vs 直接 URL | 解耦存储和展示，未来加 CDN/迁移只改一处 |
| 日期分区 | 低成本防止单目录文件膨胀 |
| Redis 缓存 14 分钟 | 比 URL 有效期短 1 分钟，消除缓存过期窗口 |
| Redis key 含 userId | 防止跨用户缓存污染，零性能损失 |
| BullMQ 定时清理 | 复用已有基础设施，不引入 cron 框架 |
| generated 类型直接 completed | 后端同步上传，无需两阶段确认 |
| 暂不加 tenantId | 无多租户需求，userId 隔离足够 |
| 暂不加 CDN | 无 CDN 服务，保留 `/api/media/:id/url` 扩展点 |
| 暂不加分片上传 | 500MB 内 presigned POST 足够 |
