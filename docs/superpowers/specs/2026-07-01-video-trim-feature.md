# 视频剪辑按钮功能 Spec

## 参考方案评估

用户提供的参考方案整体架构合理（DOM 交互 + Canvas 抽帧 + 后端 FFmpeg 裁剪），但有以下需要调整的点：

| 项目 | 参考方案 | 调整建议 | 理由 |
|------|---------|---------|------|
| 工具栏渲染 | Portal 外挂（推荐） | **一期保持 inline**，后续统一迁移 | VideoNodeToolbar 已是 inline 模式且工作正常，改 Portal 是独立优化，不应混入本次需求 |
| 裁剪 UI | 独立 Timeline 组件 + 拖拽手柄 + 缩略图抽帧 | **简化为 range-input 面板 + 时间刻度**，缩略图抽帧作为后续增强 | Canvas 抽帧引擎开发量大，且图片节点已有 CropOverlay 模式可参考 |
| 后端 | BullMQ + FFmpeg + MinIO + Socket.io | BullMQ/Socket.io 已有设计，**本次新增 video-trim 队列和 FFmpeg 模块** | 项目已有 `phase6-bullmq-complete-design.md` spec，Socket.io 已在依赖中 |
| Tailwind 主题 | 扩展 `canvas-controls` 色值 | **不新增**，复用现有 CSS 变量 | 项目已有 `--canvas-controls-*` 变量体系，无需重复配置 |
| Zustand 状态 | 按 nodeId 隔离的扁平结构 | **遵循现有 nodeStore/canvasStore 分层**，trim 参数存入 nodeStore | 项目有两层 store 架构，不可破坏 |

---

## 一、功能概述

点击视频节点悬浮工具条的「剪辑」按钮，在节点内展示裁剪面板，用户设置入点/出点后确认，后端异步执行 FFmpeg 精确裁剪，结果替换/新增节点视频。

## 二、交互流程

```
视频节点（已加载视频，选中态）
  └── VideoNodeToolbar（悬浮工具条，inline）
        └── [剪辑] 按钮  ← 本次实现
              │ 点击
              ▼
        VideoTrimPanel（在节点下方弹出，接管视频播放控制）
          ├── 视频预览区（循环播放裁剪范围，复用节点 video 实例）
          ├── 入点/出点 Slider（Ant Design range 模式）
          ├── 时间刻度 / 裁剪时长显示
          ├── [确认裁剪] → 后端校验 → 提交任务 → 显示进度
          └── [取消] → 回滚参数 → 关闭面板
```

### 2.1 键盘快捷键（面板激活时）

| 按键 | 功能 |
|------|------|
| `←` / `→` | 微调当前选中端点 ±0.1s（通过 Tab 切换选中入点/出点） |
| `Shift + ←` / `Shift + →` | 快速步进 ±1s |
| `Space` | 播放/暂停预览 |
| `Esc` | 取消并关闭面板 |

## 三、组件结构

```
VideoGenNode.tsx（修改：新增 trimMode useState + initialTrimState useRef + 条件渲染）
  ├── <video ref={videoRef}>  ← 唯一视频实例（上提至根层级，工具栏和裁剪面板共用）
  ├── VideoNodeToolbar（修改：onTrim 回调，trimMode=false 时显示）
  └── VideoTrimPanel.tsx（NEW — 裁剪面板，trimMode=true 时接管视频播放控制）
        ├── Ant Design Slider range 模式（入点/出点双滑块，步长 0.1s，Shift+拖拽步进 1s）
        ├── 时间刻度标签（当前入点/出点/时长）
        ├── 操作按钮（确认裁剪 / 取消）
        └── 进度状态（processing 时显示加载态）
```

### 3.1 显示逻辑

```
selected && hasMedia && !trimMode  →  显示 VideoNodeToolbar（含剪辑按钮）
selected && hasMedia && trimMode   →  隐藏 VideoNodeToolbar，在节点下方显示 VideoTrimPanel
selected && !fileId && !referenceVideo  →  显示 VideoConfigPanel（生成配置，现有逻辑不变）
```

### 3.2 状态归属（关键设计决策）

`trimMode`（面板展开/收起）属于**瞬态 UI 状态**，不应存入 nodeStore：

| 状态 | 存储位置 | 理由 |
|------|---------|------|
| `trimMode`（面板展开/收起） | VideoGenNode 组件内 `useState` | 瞬态 UI，不参与持久化。若后续需全局访问（如快捷键关闭），可统一放入 `canvasStore.nodeUiState` 分片 |
| `initialTrimState`（打开面板时的快照） | VideoGenNode 组件内 `useRef` | 用于取消时回滚，仅面板打开期间有效 |
| `trimStart` / `trimEnd` | nodeStore（VideoNodeData） | 业务数据，需随画布持久化 |
| `trimTaskStatus` / `trimmedFileId` | nodeStore（VideoNodeData） | 任务结果，需随画布持久化 |

### 3.3 裁剪参数回滚机制

```
打开面板 → 快照当前 trimStart/trimEnd → initialTrimState
  ├── 用户拖动滑块 → 实时更新 nodeStore.trimStart/trimEnd
  ├── 用户点击「确认」→ 提交后端，保留当前值
  └── 用户点击「取消」→ 用 initialTrimState 快照回写 nodeStore，关闭面板
```

关键约束：
- 快照仅在**打开面板瞬间**创建一次，后续拖动不更新快照
- 若节点无历史裁剪配置，快照默认值 `{ trimStart: 0, trimEnd: duration }`
- 回滚是**精确恢复到打开前状态**，而非重置为 0/duration

### 3.4 组件销毁副作用清理

| 事件 | 清理动作 |
|------|---------|
| 面板关闭（取消/确认） | 清除轮询定时器，移除 Socket.io 监听，解绑 `<video>` 事件 |
| 节点删除 | 同上 + 不终止后端任务（异步任务独立生命周期），仅取消前端订阅 |
| 页面刷新/离开 | 前端订阅自然销毁，任务状态保留在 nodeStore，下次渲染自动同步 |

### 3.5 视频元素复用（架构决策）

不建议在 VideoTrimPanel 内新建 `<video>` 标签。将视频元素上提至 VideoGenNode 根层级，工具栏与裁剪面板共用同一视频实例，仅切换播放控制逻辑：

```
VideoGenNode 根层级
  └── <video> ref={videoRef}   ← 唯一视频实例
        ├── VideoNodeToolbar（trimMode=false 时使用）
        └── VideoTrimPanel（trimMode=true 时接管播放控制）
```

好处：避免重复加载视频、占用解码通道、两个 video 元素间的状态同步问题。

### 3.6 React Flow 事件隔离（防踩坑）

VideoTrimPanel 根容器统一添加画布事件阻断类名，全量隔离：

```
VideoTrimPanel 根容器
  └── className="nodrag nopan nowheel"
        ├── 视频预览区 ✓ 不受影响
        ├── Range 滑块 ✓ 不受影响
        ├── 按钮 ✓ 不受影响
        └── 输入框 ✓ 不受影响
```

`nodrag` 阻止触发节点拖拽，`nopan` 阻止触发布平移，`nowheel` 阻止触发滚轮缩放。内部所有交互元素由容器统一兜底，无需单独设置。

## 四、数据结构

### 4.1 VideoNodeData 扩展

```typescript
// nodeStore.ts — VideoNodeData 新增字段
interface VideoNodeData {
  // ... 现有字段
  trimStart?: number;    // 裁剪入点（秒），默认 0
  trimEnd?: number;      // 裁剪出点（秒），默认视频总时长
  trimTaskStatus?: 'idle' | 'processing' | 'done' | 'error';
  trimmedFileId?: string; // 裁剪结果 fileId
}
```

### 4.2 Zustand 状态（nodeStore 新增 action）

```typescript
// nodeStore.ts
updateVideoTrim: (nodeId: string, trimStart: number, trimEnd: number) => void;
setTrimTaskStatus: (nodeId: string, status: string) => void;
setTrimmedResult: (nodeId: string, fileId: string) => void;
```

### 4.3 裁剪提交参数

```typescript
// 前端 → API
interface VideoTrimRequest {
  fileId: string;
  startTime: number;  // 秒
  endTime: number;    // 秒
  nodeId: string;
}
```

## 五、后端 API 设计

### 5.1 新增端点

```
POST /api/execution/video-trim     [Better Auth 鉴权]
  Body: { fileId, startTime, endTime, nodeId }
  Response: { taskId: string }
  校验链：
    1. Better Auth 中间件 → 校验用户登录态
    2. Service 层 → 校验 fileId 归属（仅允许操作用户自身工作流内的文件）
    3. Service 层 → ffprobe 获取真实 duration，二次校验参数合法性（见 §5.2）
    4. Service 层 → 幂等控制（见 §5.3）

GET /api/execution/video-trim/:taskId
  Response: { status: 'queued'|'processing'|'done'|'error', outputFileId?, error? }
```

### 5.2 后端参数二次强校验（防御式编程）

不信任前端传参，Service 层调用 ffprobe 获取源视频真实 duration，强制执行：

```
校验规则：
  startTime >= 0
  endTime <= 真实 duration
  endTime - startTime >= 0.5s（最小裁剪时长）
  源视频 duration < 0.5s → 直接拒绝，返回 "视频时长不足，无法裁剪"

校验失败 → 返回 400 { error: "参数错误", detail: "..." }，不进入队列
```

**注意**：若 ffprobe 调用失败（源文件损坏/不存在），兜底返回 500 并记录错误日志。

### 5.3 任务幂等与并发控制

同一 nodeId 下同时仅允许存在 1 个 `queued` / `processing` 状态的任务：

```
POST /api/execution/video-trim
  → Service 层查询：SELECT * FROM VideoTrimTask WHERE nodeId = ? AND status IN ('queued', 'processing')
  → 存在进行中任务 → 直接返回 { taskId: 已有任务的 id }，不重复入队
  → 不存在 → 创建新任务并入队
```

防止：快速多次点击、网络延迟后重试、页面刷新后重复提交。

### 5.4 裁剪产物资源归属

新增 Prisma 模型，明确资源归属与生命周期：

```prisma
model VideoTrimTask {
  id            String    @id @default(cuid())
  userId        String
  workflowId    String
  nodeId        String
  sourceFileId  String
  startTime     Float
  endTime       Float
  status        String    @default("queued")  // queued | processing | done | error
  outputFileId  String?
  errorMsg      String?
  createdAt     DateTime  @default(now())
  finishedAt    DateTime?

  @@index([nodeId])
  @@index([userId])
}
```

MinIO 输出文件路径规范：`{bucket}/workflows/{workflowId}/{nodeId}/trimmed_{timestamp}.mp4`

便于后续按工作流生命周期批量清理，无孤儿文件。

### 5.5 FFmpeg 精确裁剪策略

采用**混合 seek** 兼顾速度与精度：

```bash
# Step 1: 检测源视频是否有音频轨道
ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 {inputPath}

# Step 2: 有音频
ffmpeg -ss {startTime - 1} -i {inputPath} -ss 1 -t {duration} \
  -c:v {VIDEO_ENCODER} -preset {VIDEO_PRESET} -crf {VIDEO_CRF} -c:a aac -y {outputPath}

# Step 2: 无音频 (添加 -an)
ffmpeg -ss {startTime - 1} -i {inputPath} -ss 1 -t {duration} \
  -c:v {VIDEO_ENCODER} -preset {VIDEO_PRESET} -crf {VIDEO_CRF} -an -y {outputPath}
```

**原理说明**：
- `-ss {startTime - 1}` 在 `-i` 之前：快速 seek 到目标点前的关键帧（速度快）
- `-ss 1` 在 `-i` 之后：从关键帧位置精确解码 1s 后到达目标帧（帧级精确）
- `-t {duration}`：输出时长 = endTime - startTime
- 音频流自动判断：有音频用 `-c:a aac`，无音频添加 `-an`，避免 FFmpeg 报错
- 编码参数 `VIDEO_ENCODER` / `VIDEO_PRESET` / `VIDEO_CRF` 从环境配置读取，不硬编码

**精度说明**：此方案可达到帧级精确（±1 帧），与前端 range 滑块 `0.1s` 精度匹配。

### 5.6 编码参数配置化

`apps/api/.env` 中配置，不硬编码在业务代码：

```bash
VIDEO_TRIM_ENCODER=libx264      # 视频编码器
VIDEO_TRIM_PRESET=fast          # 编码速度预设 (fast/medium/slow)
VIDEO_TRIM_CRF=23               # 质量控制 (18-28, 越小质量越高)
```

### 5.7 临时文件兜底清理

| 清理点 | 机制 | 说明 |
|--------|------|------|
| Processor `onCompleted` | 删除输入/输出临时文件 | 正常流程清理 |
| Processor `onFailed` | 删除残留临时文件 | 异常流程兜底 |
| 定时任务（cron） | 扫描 `/tmp/video-trim/`，删除 > 1h 的文件 | 进程崩溃/断电等极端场景兜底 |

### 5.8 失败重试策略

| 错误类型 | 重试 | 理由 |
|----------|------|------|
| FFmpeg 执行超时（> 120s） | 自动重试 1 次 | 偶发性 IO 拥塞 |
| FFmpeg 进程异常退出 | 自动重试 1 次 | 偶发性系统错误 |
| 参数校验失败 | 不重试 | 重试不会改变结果 |
| 源文件不存在/损坏 | 不重试 | 需人工介入 |

### 5.9 后端模块（新增）

```
apps/api/src/modules/execution/
  ├── video-trim.controller.ts   # NEW — 裁剪接口
  ├── video-trim.service.ts      # NEW — 任务创建/状态查询/校验/幂等
  └── video-trim.processor.ts    # NEW — BullMQ worker + 清理钩子
```

### 5.10 任务状态同步（双轨制，保证可靠性）

| 通道 | 角色 | 机制 |
|------|------|------|
| Socket.io | 主通道 | 任务状态变更时实时推送 `video-trim:status` 事件 |
| 轮询 `GET /video-trim/:taskId` | 降级通道 | 每 3s 轮询任务状态 |

**切换逻辑**：
- Socket 连接正常 → 仅使用 Socket.io，关闭轮询
- Socket 断开 → 自动启动 3s 轮询
- Socket 恢复 → 关闭轮询，切回 Socket.io
- 任务到达终态（`done` / `error`）→ 停止所有同步

**前端 hook**：`useTrimTaskStatus(taskId)` 封装双轨逻辑，返回 `{ status, outputFileId, error }`。

## 六、边界情况

| 场景 | 处理 |
|------|------|
| 视频未加载元数据（duration 未知） | 禁用剪辑按钮，tooltip 提示"视频加载中" |
| 裁剪范围 < 0.5s | 确认按钮置灰，提示"最小裁剪时长 0.5 秒" |
| 视频加载失败 | 禁用剪辑按钮 |
| 后端任务失败 | 显示错误提示 + 重试按钮 |
| 用户取消裁剪 | 恢复原始 trimStart/trimEnd（回滚 nodeStore 中旧值） |
| 多次点击确认 | 按钮在 processing 期间 disabled，防止重复提交 |
| 无音频轨道的视频 | 后端自动检测并添加 `-an`，前端无需感知 |
| 越权访问 fileId | 后端 Service 层校验 fileId 归属，拒绝非本人文件 |

## 七、非功能需求

- 裁剪面板展开/收起动画 ≤ 200ms
- 视频预览循环播放时，seek 到入点延迟 ≤ 500ms
- 后端裁剪任务：SD 视频 ≤ 30s，HD 视频 ≤ 60s（预估）
- 不引入新的前端依赖

## 八、API 层收敛

裁剪相关接口统一收敛至 `apps/web/src/services/video-trim.api.ts`：

```typescript
// 不在组件内直接调用 fetch/axios
export const videoTrimApi = {
  submitTrim: (params: VideoTrimRequest) => Promise<{ taskId: string }>,
  getTaskStatus: (taskId: string) => Promise<TaskStatusResponse>,
};
```

保持与项目现有 API 层分层一致性。

## 九、核心测试用例（TDD 前置）

### 前端

| 测试用例 | 验证点 |
|----------|--------|
| 面板打开时快照初始 trim 值 | initialTrimState 正确记录打开前的值 |
| 取消时回滚到快照值 | nodeStore 恢复为 initialTrimState，非 0/duration |
| 裁剪范围 < 0.5s 时确认按钮 disabled | Slider range < 0.5s → 按钮置灰 + 提示文案 |
| useTrimTaskStatus 双轨切换 | Socket 断开 → 轮询启动；Socket 恢复 → 轮询停止 |
| 组件卸载清除副作用 | 面板关闭后无残留 timer/事件监听 |
| 视频元素复用 | 裁剪面板不创建新 `<video>`，与工具栏共用实例 |

### 后端

| 测试用例 | 验证点 |
|----------|--------|
| 缺少鉴权 token → 401 | Better Auth 中间件拦截 |
| 非本人 fileId → 403 | 归属校验拒绝 |
| startTime < 0 → 400 | 参数校验拒绝 |
| endTime > 真实 duration → 400 | ffprobe 二次校验拒绝 |
| 源视频 duration < 0.5s → 400 | 视频过短拒绝 |
| 同一 nodeId 重复提交 → 返回已有 taskId | 幂等控制 |
| FFmpeg 命令拼接正确性 | 验证生成的命令参数符合混合 seek 格式 |
| 无音频视频 → 命令包含 `-an` | 音频检测分支覆盖 |

## 十、不在一期范围

- Canvas 抽帧缩略图时间轴 → 后续增强
- Portal 方式渲染工具栏 → 独立优化任务
- 裁剪后自动连接下游节点 → 后续增强
- 移动端适配 → 后续
- 视频「裁剪」（crop/画面裁切）按钮 → 独立需求

## 十一、文件变更清单

| 文件 | 动作 | 说明 |
|------|------|------|
| **前端** | | |
| `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` | 修改 | 剪辑按钮添加 `onTrim` 回调 prop |
| `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.tsx` | **新建** | 裁剪面板组件（nodrag/nopan/nowheel 隔离 + Ant Design Slider range + 键盘快捷键） |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | 修改 | video 元素上提 + trimMode useState + initialTrimState useRef + TrimPanel 条件渲染 |
| `apps/web/src/stores/nodeStore.ts` | 修改 | VideoNodeData 扩展 trimStart/trimEnd/trimTaskStatus/trimmedFileId + actions |
| `apps/web/src/hooks/useTrimTaskStatus.ts` | **新建** | 双轨任务状态同步 hook（Socket.io + 3s 轮询降级 + 销毁清理） |
| `apps/web/src/services/video-trim.api.ts` | **新建** | 裁剪 API 收敛层（submitTrim / getTaskStatus） |
| **后端** | | |
| `apps/api/src/modules/execution/video-trim.controller.ts` | **新建** | 裁剪 API 端点（Better Auth 鉴权） |
| `apps/api/src/modules/execution/video-trim.service.ts` | **新建** | 业务逻辑（fileId 归属校验 + ffprobe 二次参数校验 + 幂等控制 + 音频检测） |
| `apps/api/src/modules/execution/video-trim.processor.ts` | **新建** | BullMQ worker（混合 seek FFmpeg + onCompleted/onFailed 临时文件清理 + 重试策略） |
| `apps/api/src/modules/execution/execution.module.ts` | 修改 | 注册新 controller/service/processor |
| `apps/api/.env` | 修改 | 新增 VIDEO_TRIM_ENCODER / PRESET / CRF 环境变量 |
| **数据库** | | |
| `prisma/schema.prisma` | 修改 | 新增 VideoTrimTask 模型 |
