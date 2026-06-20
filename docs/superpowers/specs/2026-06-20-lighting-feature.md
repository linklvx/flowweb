# Spec: 图片节点打光功能

## 概述

为 Canvas 图片节点悬浮工具栏的「打光」按钮实现完整 AI 打光能力：左侧 3D 空间拖拽光源实时预览 + 右侧参数面板调节 + 后端 AI 重光照生成高清图片，生成确认后替换原图节点。

## 现状

- `ImageNodeToolbar.tsx` Row 2 已有 `SunIcon` +「打光」按钮，**无 onClick 回调**
- 项目无 Three.js 或任何 3D 渲染代码，需新增 `three` + `@types/three` 依赖
- 后端 `ai-image-edit` 模块已支持 outpainting/erase/redraw，通过 `taskType` 区分任务类型
- BullMQ 单队列 `ai-image-edit`，Processor extends WorkerHost
- Socket.io `node:status` 事件，status 枚举：`'loading' | 'done' | 'error' | 'edit-result' | 'edit-failed'`
- 积分扣减已有 `CreditService`
- MinIO 已有 `media` 桶 + 预签名 URL
- AI 网关已有 DashScope / 通义万相调用（`ApiCallerService`）

## 核心设计决策

1. **3D 实时预览 + AI 后端生成 混合方案** — Three.js 纯前端做光影预览（无后端算力消耗），最终高清效果由 AI 生成
2. **独立 Prisma LightingTask 表** — 比纯 job 模式更规范，支持历史查询、任务追踪与对账
3. **共用 `ai-image-edit` 队列** — 新增 `taskType: 'lighting'`，不新建队列，复用现有基建
4. **沿用 `node:status` Socket.io 事件** — 新增 status 值 `'lighting-result'` / `'lighting-failed'`，携带 `taskId` 精准匹配
5. **API 路径 `/api/image-edit/lighting/...`** — 对齐现有 `/api/image-edit/*` 路径规范
6. **Store 放 `apps/web/src/stores/lightingStore.ts`** — 对齐现有 Zustand store 统一目录规范

---

## 功能需求

### 入口

- 位置：ImageNodeToolbar Row 2，「打光」按钮（DOM 已存在，需绑定点击回调）
- 显示条件：仅图片节点已加载图片（存在 `fileId` 或 `referenceImage`）时启用并展示
- 交互：点击打开全屏打光弹窗，焦点自动落入弹窗

### 全屏打光弹窗 (LightingModal)

#### 整体布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 顶栏：☀ 打光标题 | 使用手册 | Esc 关闭 | ✕ 关闭按钮  (shrink-0)         │
├───────────────────────────────────────┬─────────────────────────────────┤
│  右上角：正面缩略预览小窗              │  视图切换 (透视/正面)            │
│                                       ├─────────────────────────────────┤
│                                       │  光源预设按钮组 (六方向)         │
│  左侧 3D 预览区 (Three.js)             ├─────────────────────────────────┤
│  flex-1 min-w-0                       │  亮度滑块                        │
│                                       ├─────────────────────────────────┤
│                                       │  色温滑块                        │
│  左下角：主光源·拖拽移动光源 | 重置    ├─────────────────────────────────┤
│                                       │  轮廓光开关                      │
│                                       ├─────────────────────────────────┤
│                                       │  自定义提示词输入框 + 示例       │
│                                       ├─────────────────────────────────┤
│                                       │  [15 ⚡ 生成] 按钮 + 加载状态    │
└───────────────────────────────────────┴─────────────────────────────────┘
```

- 全屏遮罩：z-index 100000，对齐 `BaseFullscreenModal` 组件规范
- 左侧 3D 预览区：`flex-1 min-w-0`，深色背景 `#0a0e1a`
- 右侧参数面板：`w-[320px] shrink-0`，背景 `#141820`
- 关闭方式：Esc 键关闭、点击遮罩关闭、右上角关闭按钮；关闭后焦点归还触发按钮

### 左侧 3D 预览区

#### 场景基础

- 原图作为 PlaneGeometry 平面纹理，材质使用 `MeshStandardMaterial` 响应物理光照
- 图片平面固定于世界坐标 Z=0，按原图宽高比自动计算平面尺寸
- 背景深色 + 网格辅助线，匹配设计稿视觉风格

#### 双相机系统

- **透视相机（默认）**：支持 OrbitControls 旋转查看空间布局，用于感知光源方位
- **正交相机（正面视图）**：正对图片平面，禁用旋转，用于预览最终出图光影效果
- 切换视图时光源参数双向同步，无状态断层

#### 主光源与交互

- 光源类型：`PointLight` 点光源，模拟手电筒效果；配套黑色球体可视化手柄 + 白色连线指向图片中心
- 拖拽交互：鼠标拖拽光源手柄，在**平行于图片平面的虚拟平面（Z=4）**上移动，实时更新光影
- 拖拽边界：X∈[-8, 8]，Y∈[-6, 6]，Z∈[2, 10]（光源始终位于图片正前方）
- **拖拽过程中临时禁用 `OrbitControls`**，拖拽结束后恢复；命中光源手柄时不触发场景旋转，未命中时正常控制相机
- **不提供滚轮调节光源距离**，避免与透视视图相机缩放冲突；深度通过预设按钮或参数联动控制

#### 性能机制

- 预览阶段关闭阴影计算，保证 60fps 流畅度
- 脏标记渲染模式：仅参数变更、拖拽进行时触发重绘，空闲状态零 CPU 占用

#### 常驻 UI 元素

- **右上角**：悬浮正面视角缩略图，实时同步光影效果。实现方式：复用同一场景与光源数据，基于正交相机，通过离屏 `WebGLRenderTarget` 渲染，再将纹理绘制到小尺寸 Canvas 上；与主场景共享同一份渲染循环，不额外创建 WebGL 上下文
- **左下角**：「主光源・拖拽移动光源」提示文案 +「重置」按钮

### 右侧参数面板

| 控件 | 规格 |
|------|------|
| 视图切换 | 透视 / 正面 二选一，切换对应相机 |
| 光源预设按钮组 | 六方向（3×2 网格布局）：**左侧、顶部、右侧、前方、底部、后方**；点击一键跳转预设光源坐标 |
| 亮度滑块 | 取值 0-100，实时联动光源强度 |
| 色温滑块 | 取值 2000K-10000K，滑块带渐变色带，实时联动光源颜色 |
| 轮廓光开关 | 开启 / 关闭，基于 Three.js 后处理描边实现。视图切换时同步更新后处理通道的绑定相机，保证描边位置准确。**正面视图下的轮廓光效果为最终 AI 生成的参考基准** |
| 自定义提示词输入框 | 多行文本，含 2 个示例快捷填入按钮（光照效果、背景生成） |
| 生成按钮 | 按钮内显示本次消耗积分数值（如 `15 ⚡`）。积分消耗值由后端定价配置统一管理，打开弹窗时通过接口预获取预估消耗积分；提交任务时以服务端实际扣减为准，前端仅做展示。提交后按钮进入 loading 态，文案改为「生成中...」，禁用重复点击 |

### 提交与生成全流程

1. 点击「生成」→ 前端校验参数 → 调用 `POST /api/image-edit/lighting/tasks`
2. 后端执行：参数校验 → 积分预冻结 → 任务落库 → 推入 `ai-image-edit` 队列（`taskType: 'lighting'`）
3. 前端收到 `taskId` 后进入加载状态，通过 Socket.io 监听任务结果
4. 队列 Worker 按 `taskType` 分发到打光处理函数，调用 AI 网关生成图片，结果存入 MinIO
5. Socket.io 推送 `node:status` 事件：
   - 成功：`{ taskId, nodeId, status: 'lighting-result', resultUrl, fileId }`
   - 失败：`{ taskId, nodeId, status: 'lighting-failed', error }`
6. 前端按 `taskId` 匹配任务，弹窗展示效果图，提供「确认替换」「取消」两个操作
7. 用户确认 → 更新原图片节点 `fileId` / `referenceImage`，触发画布重绘，关闭弹窗
8. 用户取消 → 直接关闭弹窗，不修改原图节点

### 结果落地

- 生成确认后，调用画布现有节点更新方法，替换图片资源
- 操作完整接入画布撤销 / 重做体系，与裁剪、扩图等编辑操作体验一致

### 弹窗关闭资源清理（强制规范）

关闭弹窗时必须按顺序执行完整销毁流程，杜绝 WebGL 内存泄漏：

1. 取消动画帧循环（`cancelAnimationFrame`）
2. 遍历销毁场景内所有几何体、材质、纹理
3. 销毁轨道控制器、后处理实例、WebGL 渲染器
4. 移除所有鼠标事件监听、ResizeObserver 监听
5. 移除 Canvas DOM 节点
6. 清空引擎实例引用，重置 Store 状态

---

## 数据结构

### 共享类型（`packages/shared/src/types/lighting.types.ts`）

```typescript
export interface LightingParams {
  position: { x: number; y: number; z: number };
  brightness: number;       // 0-100
  colorTemperature: number; // 2000-10000 K
  rimLight: boolean;
  customPrompt?: string;    // 统一收纳在参数内
}

export enum LightingTaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface LightingTaskBase {
  id: string;
  nodeId: string;
  projectId?: string;
  originalImageUrl: string;
  params: LightingParams;
  status: LightingTaskStatus;
  costCredits: number;
  resultImageUrl?: string;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}
```

### Zustand Store（`apps/web/src/stores/lightingStore.ts`）

```typescript
interface LightingState {
  visible: boolean;
  nodeId: string | null;
  imageUrl: string | null;
  params: LightingParams;
  taskId: string | null;
  taskStatus: LightingTaskStatus;
  resultUrl: string | null;
}

interface LightingActions {
  openModal: (nodeId: string, imageUrl: string) => void;
  closeModal: () => void;
  updateParams: (params: Partial<LightingParams>) => void;
  resetParams: () => void;
  setTaskInfo: (info: Partial<{
    taskId: string;
    taskStatus: LightingTaskStatus;
    resultUrl: string;
    errorMessage: string;
  }>) => void;
}
```

- 弹窗关闭时自动重置所有状态为初始值
- 统一以 `taskStatus` 为唯一状态源，不额外维护 `generating` 布尔值

### Prisma Model（`apps/api/prisma/schema.prisma`）

```prisma
model LightingTask {
  id               String              @id @default(uuid())
  userId           String
  nodeId           String
  projectId        String?
  originalImageUrl String              @db.VarChar(512)
  resultImageUrl   String?             @db.VarChar(512)
  params           Json                // 完整 LightingParams 对象
  status           LightingTaskStatus  @default(pending)
  costCredits      Int                 @default(0)
  errorMessage     String?             @db.Text
  createdAt        DateTime            @default(now())
  completedAt      DateTime?

  @@index([userId])
  @@index([status])
}

enum LightingTaskStatus {
  pending
  processing
  success
  failed
}
```

枚举值统一为小写，与前端枚举字符串值完全对齐。

---

## API 接口

### 提交打光任务

```
POST /api/image-edit/lighting/tasks
Authorization: Bearer {token}
Content-Type: application/json

{
  "nodeId": "node_abc123",
  "projectId": "proj_xyz",
  "originalImageUrl": "https://minio.xxx.com/media/.../original.jpg",
  "params": {
    "position": { "x": 0, "y": 0, "z": 6 },
    "brightness": 50,
    "colorTemperature": 5600,
    "rimLight": false,
    "customPrompt": "柔和的金色阳光透过窗户洒入"
  }
}
```

成功响应：

```json
{
  "code": 0,
  "data": {
    "taskId": "uuid-xxx",
    "status": "pending"
  }
}
```

### 查询任务详情

```
GET /api/image-edit/lighting/tasks/{taskId}
Authorization: Bearer {token}
```

用于 Socket 断线重连时补拉任务状态。

---

## Socket.io 事件

沿用现有 `node:status` 事件通道，新增 2 种 status，**强制携带 `taskId`** 做唯一匹配。推送范围对齐现有图片编辑事件的推送规则：推送至对应**项目房间**；前端接收后按 `nodeId + taskId` 双重校验匹配，避免跨项目串扰。

| 事件 | payload | 说明 |
|------|---------|------|
| `node:status` | `{ taskId, nodeId, status: 'lighting-result', resultUrl, fileId }` | 生成成功 |
| `node:status` | `{ taskId, nodeId, status: 'lighting-failed', error }` | 生成失败 |

前端收到事件后，通过 `taskId` 与当前任务匹配，匹配成功才更新状态。同一节点多次提交任务时不会出现状态串扰。

---

## 文件结构

```
apps/web/src/
├── pages/canvas/
│   ├── components/
│   │   └── Lighting/
│   │       ├── LightingModal.tsx        # 弹窗主容器 + 顶栏 + 布局
│   │       ├── ThreePreview.tsx         # 左侧 3D 预览区 + 缩略图
│   │       ├── ControlPanel.tsx         # 右侧参数面板聚合
│   │       ├── ViewToggle.tsx           # 透视/正面视图切换
│   │       ├── LightPresetButtons.tsx   # 六方向预设按钮组
│   │       └── PromptInput.tsx          # 提示词输入 + 示例
│   ├── hooks/
│   │   └── useLightingEngine.ts         # Three.js 引擎生命周期 Hook
│   └── engine/
│       └── LightingEngine.ts            # 打光引擎核心类（纯 Three 实现）
├── stores/
│   └── lightingStore.ts                # Zustand 全局状态
└── utils/
    └── kelvinToRgb.ts                  # 色温转 RGB 工具函数

apps/api/src/modules/ai-image-edit/
├── ai-image-edit.module.ts             # 现有模块，导入打光子模块
└── lighting/
    ├── lighting.controller.ts          # HTTP 接口
    ├── lighting.service.ts             # 业务逻辑 + 积分 + 落库
    ├── lighting.consumer.ts            # BullMQ 消费者，taskType='lighting'
    ├── dto/
    │   ├── create-lighting-task.dto.ts
    │   └── lighting-params.dto.ts
    └── interfaces/
        └── lighting-task.interface.ts

packages/shared/src/types/
└── lighting.types.ts                   # 前后端共享类型
```

### 队列分发说明

复用现有 `ai-image-edit` 队列与 WorkerHost。Processor 内通过 `job.data.taskType` 做分发：lighting 任务进入独立 `handleLightingJob` 处理函数，与现有 outpainting/erase/redraw 逻辑完全解耦，互不影响。

---

## 新增依赖

### 前端

- `three` — 3D 场景渲染（生产依赖）
- `@types/three` — TypeScript 类型（开发依赖）

### 后端

无新增依赖，100% 复用现有模块（Prisma、BullMQ、MinIO、Socket.io、AI 网关、积分服务）。

---

## 生产级强制规范

### 幂等性控制

幂等键 = `userId + nodeId + hash(params)`，有效期 60s。命中幂等直接返回已有 taskId，不重复创建任务、不重复扣费、不重复入队。

### 积分流转机制

- 提交任务：调用 `CreditService` 预冻结对应积分
- 生成成功：正式扣减冻结积分
- 生成失败：自动解冻积分
- 所有状态变更与积分操作在同一数据库事务内执行，保证数据一致性

### 权限与安全

- 所有接口强制鉴权，校验项目归属，防止越权操作
- 图片 URL 做 SSRF 防护校验，禁止访问内网地址
- APISIX 层配置单用户限流，防止恶意刷接口

### WebGL 降级与错误边界

- 浏览器不支持 WebGL 时，自动隐藏 3D 预览区，保留参数面板，用户可直接提交 AI 生成
- 使用 React Error Boundary 包裹 3D 预览组件；渲染崩溃时自动降级为占位提示，保留参数面板与提交能力，不影响主画布页面正常使用

### 存储规范

- 结果图存入现有 `media` 桶，复用 `MinioService.buildKey('generated', userId, { projectId, nodeId, ext: 'jpg' })`，路径格式 `results/{userId}/{projectId}/{nodeId}/{date}/{uuid}.jpg`，与现有 AI 生成结果路径规则完全一致
- 统一通过预签名 URL 访问，有效期 2 小时
- 复用桶生命周期策略，30 天自动清理历史文件

---

## 验收标准

### 交互测试

- 拖拽光源流畅无卡顿，帧率 ≥ 50fps
- 所有参数调节实时同步到 3D 视图，无延迟
- 透视 / 正面视图切换正常，状态无断层
- 六方向预设定位准确，与说明一致
- 右上角缩略图与主场景光影同步

### 流程测试

- 打开弹窗 → 调参 → 提交 → 生成成功 → 节点更新 全链路打通
- 生成失败有明确错误提示，支持重试
- 确认替换后节点图片正确更新，支持撤销 / 重做

### 性能测试

- 弹窗首屏打开耗时 < 300ms
- 连续开关弹窗 20 次无内存泄漏（WebGL 上下文泄漏量 = 0）
- 空闲状态 3D 区域 CPU 占用 ≈ 0

### 异常测试

- 图片加载失败有兜底提示，禁止提交
- AI 接口报错自动重试 3 次（指数退避），失败后解冻积分
- 积分不足时提交拦截，明确提示并引导充值
- Socket 断线重连后可正确拉取任务状态

---

## 可选体验优化（非强制）

1. **预设按钮选中态**：当光源位置匹配某一方向预设时，对应按钮高亮显示，增强操作反馈
2. **参数防抖**：亮度、色温滑块拖动过程中做 16ms 防抖，减少渲染次数，低端设备更流畅
3. **快捷键支持**：除 Esc 关闭外，支持 `R` 键快速重置参数，提升专业用户效率

---

## 不做（Out of scope）

- 不做全局光照 / 光线追踪烘焙 — 仅单一点光源模拟手电筒效果
- 不引入 React Three Fiber — 原生 Three.js 实现，包体更小、可控性更高
- 不新建独立 BullMQ 队列 — 共用 `ai-image-edit` 队列，通过 `taskType` 分发
- 不支持多光源同时调节 — 单一主光源，满足主流打光需求
- 不新增后端第三方依赖 — 全部复用现有基建
- 不做光源距离滚轮调节 — 避免与相机缩放冲突，保证交互无歧义
