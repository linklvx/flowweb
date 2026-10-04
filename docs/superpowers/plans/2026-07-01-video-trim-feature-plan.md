<!-- doc-status: historical | verified_at: n/a -->
# 视频剪辑按钮功能 — TDD 实施计划

## 前置依赖

开发环境需提前安装：

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows
choco install ffmpeg  # 或从 https://ffmpeg.org 下载
```

验证安装：`ffmpeg -version && ffprobe -version`

确保本地、CI、生产环境的 FFmpeg 版本尽量对齐（推荐 6.x+），避免编码参数兼容差异。

## 总览

基于 Spec `docs/superpowers/specs/2026-07-01-video-trim-feature.md`，按 TDD 红-绿-重构循环逐任务执行。

**铁律**：先写测试 → 确认失败 → 写实现 → 测试通过 → 提交。每完成一个 task 即标记。

## 依赖关系

```
Phase 1 (数据层)
  ├── Task 1.1 nodeStore 扩展
  └── Task 1.2 Prisma 模型
        ↓
Phase 2 (后端核心)
  ├── Task 2.1 常量/类型
  ├── Task 2.2 Service 层
  ├── Task 2.3 Processor (FFmpeg)
  ├── Task 2.4 Controller
  └── Task 2.5 Module 注册
        ↓
Phase 3 (前端服务层)
  ├── Task 3.1 video-trim.api.ts
  └── Task 3.2 useTrimTaskStatus hook
        ↓
Phase 4 (前端 UI)
  ├── Task 4.1 VideoTrimPanel 组件
  ├── Task 4.2 VideoNodeToolbar 接入
  └── Task 4.3 VideoGenNode 集成
        ↓
Phase 5 (联调与边界)
  ├── Task 5.1 Socket.io 事件
  ├── Task 5.2 键盘快捷键
  └── Task 5.3 边界验证
```

---

## Phase 1 — 数据层

### Task 1.1: VideoNodeData 扩展 + nodeStore actions

**文件**: `apps/web/src/stores/nodeStore.ts`

**TDD**:
1. **RED** — 写 `nodeStore.trim.test.ts`
   - `it('should default trimStart to 0 and trimEnd to undefined')` — 验证新增节点默认值
   - `it('should update trimStart and trimEnd via updateVideoTrim')` — 调用 action 后验证值
   - `it('should set trim task status via setTrimTaskStatus')` — action 更新状态
   - `it('should set trimmed result via setTrimmedResult')` — action 设置 outputFileId
   
   注意：回滚逻辑属于组件层行为（用旧值调 `updateVideoTrim`），store 只负责纯数据更新，不感知「回滚」语义。回滚用例收敛到 Task 4.3。
2. **GREEN** — 实现：
   ```typescript
   // VideoNodeData 新增
   trimStart?: number;
   trimEnd?: number;
   trimTaskStatus?: 'idle' | 'processing' | 'done' | 'error';
   trimmedFileId?: string;

   // 新增 actions
   updateVideoTrim: (nodeId, trimStart, trimEnd) => ...
   setTrimTaskStatus: (nodeId, status) => ...
   setTrimmedResult: (nodeId, fileId) => ...
   ```

**验证**: `pnpm --filter web exec vitest run src/stores/nodeStore.trim.test.ts`

---

### Task 1.2: Prisma VideoTrimTask 模型

**文件**: `apps/api/prisma/schema.prisma`

**TDD**: Prisma 模型本身无单元测试，通过后续 Service 测试间接验证。

**实现**:
```prisma
model VideoTrimTask {
  id            String    @id @default(cuid())
  userId        String
  workflowId    String
  nodeId        String
  sourceFileId  String
  startTime     Float
  endTime       Float
  status        String    @default("queued")
  outputFileId  String?
  errorMsg      String?
  createdAt     DateTime  @default(now())
  finishedAt    DateTime?

  @@index([nodeId])
  @@index([userId])
}
```

**验证**: 
1. `pnpm --filter api exec prisma migrate dev --name add_video_trim_task` — 生成迁移 SQL
2. `pnpm --filter api exec prisma generate` 无报错
3. 提交包含 `prisma/migrations/` 下的 SQL 迁移文件

**上线顺序**：先执行 `prisma migrate deploy`，再部署新应用代码。

---

## Phase 2 — 后端核心

### Task 2.1: 常量 + 类型定义

**文件**: 
- `apps/api/src/modules/execution/video-trim.constants.ts` (NEW)
- `apps/api/src/modules/execution/video-trim.types.ts` (NEW)

**TDD**: 常量和类型无运行时逻辑，跳过测试。

**实现**:
```typescript
// constants.ts
export const VIDEO_TRIM_QUEUE = 'video-trim';
export const VIDEO_TRIM_CONNECTION = 'default';
export const MIN_TRIM_DURATION = 0.5; // 最小裁剪时长(秒)
export const TEMP_DIR = '/tmp/video-trim/'; // 临时文件根目录，每任务隔离为 ${TEMP_DIR}/${taskId}/

// types.ts
export interface VideoTrimJobData {
  taskId: string;
  userId: string;
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  hasAudio: boolean;
}
export type VideoTrimJobResult = { outputPath: string };
```

---

### Task 2.2: VideoTrimService

**文件**: `apps/api/src/modules/execution/video-trim.service.ts` (NEW)

**TDD** — 写 `video-trim.service.spec.ts`:
1. **RED**:
   - `it('should throw 400 if startTime < 0')`
   - `it('should throw 400 if endTime > actual duration')` — mock ffprobe 返回值
   - `it('should throw 400 if duration < 0.5s')`
   - `it('should throw 400 if source video < 0.5s')`
   - `it('should throw 500 when ffprobe fails to read file')` — mock ffprobe rejection，覆盖源文件损坏/不存在
   - `it('should throw 403 if file does not belong to user')`
   - `it('should return existing taskId if duplicate submission')` — mock 已有 queued 任务，返回 200 + 已有 taskId
   - `it('should create task and enqueue job')` — 正常流程，验证 workflowId 写入 DB
   - `it('should detect no audio track and set hasAudio=false')` — mock ffprobe 返回空
   - `it('should update task status and emit socket event on completion')`
2. **GREEN** — 实现 service:
   - `validateParams(startTime, endTime, actualDuration)` → throw 400
   - `validateFileOwnership(fileId, userId, workflowId)` → throw 403
   - `checkDuplicate(nodeId)` → 返回已有 taskId 或 null
   - `detectAudio(inputPath)` → ffprobe 检测
   - `submitTrim(params)` → params 含 `{ fileId, startTime, endTime, nodeId, userId, workflowId }`，创建 DB 记录 + 入队 + 返回 taskId
   - `handleTaskCompleted(taskId, outputFileId)` → 更新 DB + Socket.io 推送
   - `handleTaskFailed(taskId, error)` → 更新 DB + Socket.io 推送
   - `getTaskStatus(taskId)` → 查询 DB 返回状态

**验证**: `pnpm --filter api exec vitest run src/modules/execution/video-trim.service.spec.ts`

---

### Task 2.3: VideoTrimProcessor (FFmpeg Worker)

**文件**: 
- `apps/api/src/modules/execution/video-trim.processor.ts` (NEW)
- `apps/api/src/modules/execution/video-trim.utils.ts` (NEW — 纯函数抽离)

**TDD** — 写 `video-trim.utils.spec.ts` + `video-trim.processor.spec.ts`:

**utils 测试**（纯函数，无需实例化 Processor，执行更快）:
1. **RED**:
   - `it('should build correct FFmpeg command with audio')` — 验证命令字符串包含 `-c:a aac`
   - `it('should build correct FFmpeg command without audio')` — 验证命令字符串包含 `-an`
   - `it('should place first -ss before -i and second -ss after -i')` — 顺序校验：参数数组中第一个 `-ss` 出现在 `-i` 之前，第二个 `-ss` 出现在 `-i` 之后，确保混合 seek 策略生效
   - `it('should handle startTime < 1s correctly without negative seek')` — `startTime=0.3` 时 preSeek 为 0，不出现负数
   - `it('should handle startTime >= 1s with normal mixed seek')` — `startTime=5` 时 preSeek=4, postSeek=1
   - `it('should use taskId-isolated temp directory')` — 验证输出路径为 `${TEMP_DIR}/${taskId}/output.mp4`
2. **GREEN** — 实现 `video-trim.utils.ts`:
   - `buildFfmpegArgs(jobData, config)` → `string[]` 纯函数
   - 边界处理：`const preSeek = Math.max(0, startTime - 1); const postSeek = startTime - preSeek;`
   - 参数顺序：`['-ss', preSeek, '-i', inputPath, '-ss', postSeek, '-t', duration, ...]`
   - 输出路径：`${TEMP_DIR}/${taskId}/output.mp4`

**processor 测试**:
1. **RED**:
   - `it('should clean up entire task temp directory on completed')` — mock fs, 验证 rmdir `${TEMP_DIR}/${taskId}/`
   - `it('should clean up entire task temp directory on failed')` — mock fs, 验证 rmdir `${TEMP_DIR}/${taskId}/`
   - `it('should read encoder config from env via ConfigService')` — mock env variable
2. **GREEN** — 实现:
   - `process(job)` → 调用 `buildFfmpegArgs()` + 执行 FFmpeg + 进度上报 + 清理钩子
   - 注入 `ConfigService` 读取环境变量
   - 注入 `VideoTrimService` 回调 `handleTaskCompleted`/`handleTaskFailed`

**验证**: `pnpm --filter api exec vitest run src/modules/execution/video-trim.utils.spec.ts src/modules/execution/video-trim.processor.spec.ts`

---

### Task 2.4: VideoTrimController

**文件**: `apps/api/src/modules/execution/video-trim.controller.ts` (NEW)

**TDD** — 写 `video-trim.controller.spec.ts`:
1. **RED**:
   - `it('should return 201 with taskId on valid POST /video-trim')`
   - `it('should return 401 when no auth token')`
   - `it('should return 403 when fileId belongs to another user')`
   - `it('should return 400 when validation fails')`
   - `it('should return 200 with existing taskId when duplicate submission')` — 幂等场景，重复提交不属于错误
   - `it('should return task status on GET /video-trim/:taskId')`
   - `it('should return 404 when task not found')`
2. **GREEN** — 实现:
   ```typescript
   @Controller('api/execution')
   export class VideoTrimController {
     @Post('video-trim')
     async submitTrim(@Body() body, @Req() req) {
       // 从 Better Auth 中间件获取 userId，从工作流上下文获取 workflowId
       const userId = req.user?.id;
       const workflowId = req.workflowId; // 由工作流权限中间件注入
       return this.service.submitTrim({ ...body, userId, workflowId });
     }

     @Get('video-trim/:taskId')
     async getTaskStatus(@Param('taskId') taskId: string) { ... }
   }
   ```

**验证**: `pnpm --filter api exec vitest run src/modules/execution/video-trim.controller.spec.ts`

---

### Task 2.5: Execution Module 注册

**文件**: `apps/api/src/modules/execution/execution.module.ts`

**TDD**: 模块注册通过集成测试或启动验证，无单测。

**实现**:
```typescript
BullModule.registerQueue({ name: VIDEO_TRIM_QUEUE, configKey: VIDEO_TRIM_CONNECTION }),
// providers 新增: VideoTrimService, VideoTrimProcessor
// controllers 新增: VideoTrimController
```

**验证**: `pnpm --filter api exec nest start --watch` 无模块加载报错

---

## Phase 3 — 前端服务层

### Task 3.1: video-trim.api.ts 收敛层

**文件**: `apps/web/src/services/video-trim.api.ts` (NEW)

**TDD** — 写 `video-trim.api.test.ts`:
1. **RED**:
   - `it('should POST submitTrim with correct body')` — mock fetch, 验证 URL/body
   - `it('should GET task status by taskId')` — mock fetch, 验证 URL
   - `it('should throw on network error')` — mock fetch rejection
2. **GREEN** — 实现:
   ```typescript
   export const videoTrimApi = {
     submitTrim: (params: VideoTrimRequest) => apiFetch('/api/execution/video-trim', { method: 'POST', body: JSON.stringify(params) }),
     getTaskStatus: (taskId: string) => apiFetch(`/api/execution/video-trim/${taskId}`),
   };
   ```
   复用项目现有 `apiFetch` 封装。

**验证**: `pnpm --filter web exec vitest run src/services/video-trim.api.test.ts`

---

### Task 3.2: useTrimTaskStatus hook

**文件**: `apps/web/src/hooks/useTrimTaskStatus.ts` (NEW)

**TDD** — 写 `useTrimTaskStatus.test.ts`:
1. **RED**:
   - `it('should not start polling or socket subscription when taskId is null')` — 空值初始状态，不应有任何副作用
   - `it('should start polling when socket disconnected')` — mock socket, 验证 setInterval
   - `it('should stop polling when socket reconnects')`
   - `it('should stop all sync when status is done')`
   - `it('should stop all sync when status is error')`
   - `it('should clean up timers on unmount')`
   - `it('should update status from socket event')`
2. **GREEN** — 实现 hook:
   ```typescript
   function useTrimTaskStatus(taskId: string | null): {
     status: TaskStatus;
     outputFileId: string | null;
     error: string | null;
   }
   ```
   内部逻辑：
   - `useEffect` 依赖 `taskId`，`taskId` 为 null 时直接 return，不执行订阅逻辑
   - 订阅 Socket.io `video-trim:status` 事件
   - Socket 断开时启动 3s interval 轮询
   - 终态时清除所有订阅
   - useEffect return 做 cleanup

**验证**: `pnpm --filter web exec vitest run src/hooks/useTrimTaskStatus.test.ts`

---

## Phase 4 — 前端 UI

### Task 4.1: VideoTrimPanel 组件

**文件**: `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.tsx` (NEW)

**Props**:
```typescript
interface VideoTrimPanelProps {
  videoRef: RefObject<HTMLVideoElement>;
  duration: number;              // 视频总时长
  initialTrimStart: number;      // 快照值
  initialTrimEnd: number;
  onConfirm: (start: number, end: number) => void;
  onCancel: () => void;
  taskStatus?: 'idle' | 'processing' | 'done' | 'error';
  error?: string | null;
}
```

**TDD** — 写 `VideoTrimPanel.test.tsx`:
1. **RED**:
   - `it('should render range slider with correct min/max')`
   - `it('should display current trim start/end time labels')`
   - `it('should display trim duration')`
   - `it('should call onConfirm with current values when confirm clicked')`
   - `it('should call onCancel when cancel clicked')`
   - `it('should disable confirm button when trim range < 0.5s')`
   - `it('should show minimum duration tooltip when range < 0.5s')`
   - `it('should clamp start to 0 when dragging left handle beyond minimum')` — 左滑块不超过 0
   - `it('should clamp end to duration when dragging right handle beyond maximum')` — 右滑块不超过总时长
   - `it('should enforce 0.5s minimum gap between sliders')` — 拖拽左滑块逼近右滑块时，右滑块同步右移保持间距
   - `it('should have nodrag nopan nowheel class on root container')`
   - `it('should show loading state when taskStatus is processing')`
   - `it('should have aria-disabled on confirm button when disabled')`
   - `it('should have aria-busy on slider area when processing')`
   - `it('should not create new video element')` — 验证无 `<video>` tag
   
   **Ant Design Slider 拖拽测试策略**：拖拽交互编写成本高，`onChange` 回调的逻辑正确性通过单测验证；拖拽行为归入手动验证清单（Task 5.3），避免单测过度耦合组件内部实现。
2. **GREEN** — 实现组件:
   - Ant Design `<Slider range>` + `marks` 显示时间刻度
   - 步长 0.1s, 最小间距 0.5s, `onChange` 中强制约束 start >= 0 和 end <= duration
   - 时间格式化 `mm:ss.ms`
   - 确认/取消按钮，disabled 态加 `aria-disabled`，processing 态加 `aria-busy`
   - `nodrag nopan nowheel` 容器

**验证**: `pnpm --filter web exec vitest run src/pages/canvas/components/nodes/VideoTrimPanel.test.tsx`

---

### Task 4.2: VideoNodeToolbar 接入

**文件**: `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx`

**TDD**: 无独立测试（纯 prop 传递），通过 Task 4.3 的集成测试覆盖。

**修改**:
```typescript
interface VideoNodeToolbarProps {
  // ... 现有 props
  onTrim?: () => void;  // NEW
}
// 剪辑按钮 onClick → onTrim
```

---

### Task 4.3: VideoGenNode 集成

**文件**: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`

**TDD** — 更新/新增 `VideoGenNode.test.tsx`:
1. **RED**:
   - `it('should show toolbar when selected and hasMedia and not trimMode')`
   - `it('should show TrimPanel when trimMode is true')`
   - `it('should hide toolbar when TrimPanel is open')`
   - `it('should snapshot current trim on panel open')` — 验证 initialTrimState
   - `it('should rollback to snapshot on cancel')` — 验证 nodeStore 值回滚
   - `it('should keep trim values on confirm')`
   - `it('should reuse same video element for toolbar and trim panel')` — 验证 videoRef
   - `it('should capture duration from video loadedmetadata event')` — mock video element, 模拟 `loadedmetadata` 事件触发，验证 duration 赋值
2. **GREEN** — 实现:
   - `const [trimMode, setTrimMode] = useState(false)`
   - `const initialTrimState = useRef({ trimStart: 0, trimEnd: 0 })`
   - `const videoRef = useRef<HTMLVideoElement>(null)` — 上提至根层级
   - `handleOpenTrim` → 快照 + setTrimMode(true)
   - `handleConfirmTrim` → 调 API + setTrimMode(false)
   - `handleCancelTrim` → 回滚 + setTrimMode(false)
   - 条件渲染 VideoTrimPanel / VideoNodeToolbar

**验证**: `pnpm --filter web exec vitest run src/pages/canvas/components/nodes/VideoGenNode.test.tsx`

---

## Phase 5 — 联调与边界

### Task 5.1: Socket.io 事件对接

**文件**: `apps/api/src/modules/gateway/execution.gateway.ts` + 前端 hook

**TDD** — 扩展已有的 gateway spec + hook test:
1. **RED**:
   - `it('should emit video-trim:status to project room on completion')`
   - `it('should emit video-trim:status on failure')`
2. **GREEN**:
   - Gateway 新增 `emitTrimStatus(projectId, data)` 方法
   - 事件名 `video-trim:status`，payload `{ nodeId, taskId, status, outputFileId?, error? }`
   - Service `handleTaskCompleted`/`handleTaskFailed` 中调用 gateway

**验证**: `pnpm --filter api exec vitest run src/modules/gateway/execution.gateway.spec.ts`

---

### Task 5.2: 键盘快捷键

**文件**: `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.tsx`

**TDD** — 扩展 VideoTrimPanel 测试:
1. **RED**:
   - `it('should adjust trimStart +0.1s on ArrowRight when start handle focused')`
   - `it('should adjust trimStart -0.1s on ArrowLeft when start handle focused')`
   - `it('should call onCancel on Escape')`
   - `it('should toggle video play/pause on Space')` — preventDefault 验证
2. **GREEN**:
   - `useEffect` 挂载 `keydown` 事件监听
   - Slider 内置方向键可通过 Ant Design `keyboard` prop 实现
   - Escape / Space 通过全局 keydown 处理

**验证**: `pnpm --filter web exec vitest run src/pages/canvas/components/nodes/VideoTrimPanel.test.tsx`

---

### Task 5.3: 边界场景验证

**手动验证清单**（在浏览器中逐项检查）：

| 验证项 | 操作 | 预期 |
|--------|------|------|
| 视频未加载完成 | 选中未加载完视频的节点 | 剪辑按钮 disabled |
| 滑块范围 < 0.5s | 拖动入点/出点使差值 < 0.5s | 确认按钮 disabled + 提示 |
| 取消回滚 | 拖动滑块 → 点取消 → 重新打开面板 | 参数恢复打开前状态 |
| 重复提交 | 快速双击确认 | 后端返回已有 taskId，前端按钮立即 disabled |
| 裁剪成功 | 完整流程确认 | 节点状态更新，显示结果视频 |
| 无音频视频 | 裁剪无音轨视频 | 后端不报错，输出视频正常 |
| 节点删除 | 合并 pending 时删除节点 | 面板关闭，无残留定时器 |
| Esc 关闭 | 面板激活时按 Esc | 面板关闭 + 参数回滚 |
| Space 播放 | 面板激活时按 Space | 视频播放/暂停 |

---

## 执行顺序与提交策略

每个 Task 完成即可单独提交，不必等到整 Phase 结束，便于回滚与 Code Review。提交前缀统一为 `feat(video-trim):`。

```
Phase 1
  Task 1.1 → 提交 "feat(video-trim): extend VideoNodeData and nodeStore actions"
  Task 1.2 → 提交 "feat(video-trim): add VideoTrimTask Prisma model"

Phase 2
  Task 2.1 → 提交 "feat(video-trim): add video-trim constants and types"
  Task 2.2 → 提交 "feat(video-trim): add VideoTrimService with validation and idempotency"
  Task 2.3 → 提交 "feat(video-trim): add VideoTrimProcessor and FFmpeg utils"
  Task 2.4 → 提交 "feat(video-trim): add VideoTrimController endpoints"
  Task 2.5 → 提交 "feat(video-trim): register video-trim module and queue"

Phase 3
  Task 3.1 → 提交 "feat(video-trim): add video-trim API client layer"
  Task 3.2 → 提交 "feat(video-trim): add useTrimTaskStatus hook with dual-track sync"

Phase 4
  Task 4.1 → 提交 "feat(video-trim): add VideoTrimPanel component"
  Task 4.2 → 提交 "feat(video-trim): wire trim button in VideoNodeToolbar"
  Task 4.3 → 提交 "feat(video-trim): integrate trim panel into VideoGenNode"

Phase 5
  Task 5.1 → 提交 "feat(video-trim): add socket.io trim status events"
  Task 5.2 → 提交 "feat(video-trim): add keyboard shortcuts to trim panel"
```

每个 Task 内部严格遵循 RED → GREEN → REFACTOR 循环。

## 每 Phase 回归校验命令

```
Phase 1 完成 → pnpm --filter web exec vitest run src/stores/nodeStore.trim.test.ts
Phase 2 完成 → pnpm --filter api exec vitest run src/modules/execution/
Phase 3 完成 → pnpm --filter web exec vitest run src/services/video-trim.api.test.ts src/hooks/useTrimTaskStatus.test.ts
Phase 4 完成 → pnpm --filter web exec vitest run src/pages/canvas/components/nodes/VideoTrimPanel.test.tsx src/pages/canvas/components/nodes/VideoGenNode.test.tsx
Phase 5 完成 → pnpm --filter api exec vitest run src/modules/gateway/ + 手动验证清单
全部完成 → pnpm test (全量测试，确保无回归)
```

## 执行风险提示

| 风险 | 缓解措施 |
|------|---------|
| Ant Design Slider 拖拽测试成本高 | 优先测试 `onChange` 回调逻辑，拖拽交互归入手动验证清单（Task 5.3） |
| Socket.io 测试需真实连接 | Gateway 测试 mock Socket 实例，确保单测可在无网络环境下独立运行 |
| FFmpeg 版本兼容差异 | 本地/CI/生产环境 FFmpeg 版本尽量对齐（推荐 6.x+），编码参数通过环境变量可调 |
| BullMQ 队列需 Redis 运行 | Service/Processor 单测 mock Queue，不依赖真实 Redis 连接 |
