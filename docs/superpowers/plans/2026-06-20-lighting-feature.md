<!-- doc-status: historical | verified_at: n/a -->
# 图片节点打光功能 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Canvas 图片节点实现完整 AI 打光能力：3D 拖拽光源实时预览 + 右侧参数面板 + 后端 AI 重光照生成 + 结果替换原图节点

**Architecture:** 前端三大层 — LightingEngine（纯 Three.js 类，无 React 依赖）→ useLightingEngine（React Hook，管理引擎生命周期）→ Lighting 组件树（弹窗 + 3D 预览 + 参数面板）。后端复用 ai-image-edit 模块，新增 taskType: 'lighting' 分发分支。遵循现有模式：Zustand flat store → TDD 红-绿-重构 → 每 task 独立 commit

**Tech Stack:** React 18 + TypeScript strict + @xyflow/react + Three.js + Zustand + Tailwind CSS + NestJS + Prisma + BullMQ + Socket.io + MinIO + Vitest + @testing-library/react

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/shared/src/types/lighting.types.ts` | 新建 | 前后端共享类型定义 |
| `packages/shared/src/index.ts` | 修改 | 导出新类型 |
| `apps/web/src/utils/kelvinToRgb.ts` | 新建 | 色温 → RGB 转换工具 |
| `apps/web/src/utils/kelvinToRgb.test.ts` | 新建 | 色温转换单元测试 |
| `apps/web/src/stores/lightingStore.ts` | 新建 | Zustand 打光域状态 |
| `apps/web/src/stores/lightingStore.test.ts` | 新建 | Store 单元测试 |
| `apps/web/src/pages/canvas/engine/LightingEngine.ts` | 新建 | Three.js 打光引擎核心类 |
| `apps/web/src/pages/canvas/hooks/useLightingEngine.ts` | 新建 | 引擎 React Hook 封装 |
| `apps/web/src/pages/canvas/components/Lighting/LightingModal.tsx` | 新建 | 弹窗主容器 |
| `apps/web/src/pages/canvas/components/Lighting/ThreePreview.tsx` | 新建 | 左侧 3D 预览区 |
| `apps/web/src/pages/canvas/components/Lighting/ControlPanel.tsx` | 新建 | 右侧参数面板 |
| `apps/web/src/pages/canvas/components/Lighting/ViewToggle.tsx` | 新建 | 透视/正面视图切换 |
| `apps/web/src/pages/canvas/components/Lighting/LightPresetButtons.tsx` | 新建 | 六方向光源预设按钮 |
| `apps/web/src/pages/canvas/components/Lighting/PromptInput.tsx` | 新建 | 提示词输入 + 示例 |
| `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` | 修改 | 打光按钮接线 |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 修改 | 打光回调 + LightingModal 渲染 |
| `apps/api/prisma/schema.prisma` | 修改 | 新增 LightingTask 模型 + 枚举 |
| `apps/api/src/modules/ai-image-edit/lighting/lighting.controller.ts` | 新建 | HTTP 接口 |
| `apps/api/src/modules/ai-image-edit/lighting/lighting.service.ts` | 新建 | 业务逻辑 |
| `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts` | 新建 | BullMQ 消费者 |
| `apps/api/src/modules/ai-image-edit/lighting/dto/create-lighting-task.dto.ts` | 新建 | 请求 DTO |
| `apps/api/src/modules/ai-image-edit/lighting/interfaces/lighting-task.interface.ts` | 新建 | 类型接口 |
| `apps/api/src/modules/ai-image-edit/ai-image-edit.module.ts` | 修改 | 注册打光子模块 |
| `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts` | 修改 | 新增 taskType: 'lighting' 分发 |
| `apps/api/src/modules/gateway/execution.gateway.ts` | 修改 | 扩展现有 emitNodeStatus（如需要） |

---

## Task 1: 安装前端依赖 + 创建共享类型

**Files:**
- Modify: `apps/web/package.json`
- New: `packages/shared/src/types/lighting.types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 安装 three + @types/three**

```bash
cd /d/flowweb && pnpm --filter @flowweb/web add three && pnpm --filter @flowweb/web add -D @types/three
```

- [ ] **Step 2: 创建共享类型文件**

`packages/shared/src/types/lighting.types.ts`：

```typescript
export interface LightingParams {
  position: { x: number; y: number; z: number };
  brightness: number;
  colorTemperature: number;
  rimLight: boolean;
  customPrompt?: string;
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

- [ ] **Step 3: 从 shared/index.ts 导出**

- [ ] **Step 4: 验证编译无错误**

```bash
cd /d/flowweb && pnpm --filter @flowweb/shared build
```

- [ ] **Step 5: Commit**

```
chore: add three.js dependency and shared lighting types
```

---

## Task 2: 前端工具函数 — kelvinToRgb（TDD）

**Files:**
- New: `apps/web/src/utils/kelvinToRgb.ts`
- New: `apps/web/src/utils/kelvinToRgb.test.ts`

- [ ] **Step 1: 写失败测试（RED）**

测试用例：
- 2000K → 橙红色（R 主导）
- 5600K → 日光白（RGB 接近平衡）
- 10000K → 蓝白色（B 主导）
- 边界外输入（<2000K、>10000K）→ clamp 到边界
- 输出格式兼容 Three.js Color

- [ ] **Step 2: 运行测试，确认因正确原因失败**

```bash
cd /d/flowweb && pnpm --filter @flowweb/web test -- --run kelvinToRgb.test.ts
```

- [ ] **Step 3: 实现 kelvinToRgb（GREEN）**

黑体辐射近似算法，覆盖 2000K-10000K 全区间。输入色温 K 值，输出 `{ r: number, g: number, b: number }`（0-1 归一化）。

- [ ] **Step 4: 运行测试，确认通过（REFACTOR）**

```bash
cd /d/flowweb && pnpm --filter @flowweb/web test -- --run kelvinToRgb.test.ts
```

- [ ] **Step 5: Commit**

```
feat(web): add kelvinToRgb color temperature conversion utility
```

---

## Task 3: Zustand lightingStore（TDD）

**Files:**
- New: `apps/web/src/stores/lightingStore.ts`
- New: `apps/web/src/stores/lightingStore.test.ts`

- [ ] **Step 1: 写失败测试（RED）**

测试用例：
- `openModal(nodeId, imageUrl)` → 状态设置正确，params 初始化为默认值
- `closeModal()` → 状态全部重置为初始值
- `updateParams(partial)` → 部分更新 params，未提供的字段保持不变
- `resetParams()` → params 恢复默认值，其他状态不变
- `setTaskInfo(partial)` → 更新 taskId、taskStatus、resultUrl
- 默认 params 值验证：position (0,0,6)、brightness 50、colorTemperature 5600、rimLight false
- 连续 open → close → open 无状态残留

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /d/flowweb && pnpm --filter @flowweb/web test -- --run lightingStore.test.ts
```

- [ ] **Step 3: 实现 lightingStore（GREEN）**

默认值：position { x:0, y:0, z:6 }、brightness 50、colorTemperature 5600、rimLight false

- [ ] **Step 4: 运行测试，确认全部通过**

- [ ] **Step 5: Commit**

```
feat(web): add lightingStore with Zustand state management for lighting feature
```

---

## Task 4: Three.js 打光引擎核心类 LightingEngine

**Files:**
- New: `apps/web/src/pages/canvas/engine/LightingEngine.ts`

纯 Three.js 类，无 React 依赖。关键能力：

- [ ] **Step 1: 实现构造函数 + 场景初始化**

- 接收 Canvas 容器 DOM、原图 URL
- 创建 WebGLRenderer（alpha: false, preserveDrawingBuffer: false）
- 创建 Scene + 深色背景
- 创建双相机（PerspectiveCamera + OrthographicCamera）
- 加载原图纹理 → PlaneGeometry → MeshStandardMaterial → 添加到场景
- 图片平面固定 Z=0，按宽高比计算尺寸
- 网格辅助线
- OrbitControls 绑定透视相机

- [ ] **Step 2: 实现主光源系统**

- PointLight + 黑色球体可视化手柄 + 白色连线指向图片中心
- 拖拽交互：mousedown/mousemove/mouseup → 射线检测命中手柄 → 在 Z=4 平面移动
- 拖拽边界：X∈[-8,8]、Y∈[-6,6]、Z∈[2,10]
- 拖拽时禁用 OrbitControls，拖拽结束恢复
- 脏标记渲染模式

- [ ] **Step 3: 实现双相机切换 + 缩略图**

- 透视 / 正交相机切换
- 右上角缩略图：WebGLRenderTarget 离屏渲染到小 Canvas

- [ ] **Step 4: 实现参数同步**

- `updateParams(params)` → 更新光源位置/亮度/色温/轮廓光
- 色温通过 kelvinToRgb 转换为光源颜色

- [ ] **Step 5: 实现轮廓光后处理**

- 视图切换时同步更新后处理通道的绑定相机

- [ ] **Step 6: 实现销毁方法**

- cancelAnimationFrame → 遍历销毁几何体/材质/纹理 → 销毁控制器/后处理/渲染器 → 移除事件/ResizeObserver → 移除 Canvas DOM

- [ ] **Step 7: 写引擎单元测试（可选，主要靠浏览器验证）**

引擎类是纯 Three.js，不适合 vitest 测试（无 DOM/WebGL）。可选写 smoke test 验证构造函数不抛异常。

- [ ] **Step 8: Commit**

```
feat(web): add LightingEngine core class for Three.js lighting preview
```

---

## Task 5: useLightingEngine Hook

**Files:**
- New: `apps/web/src/pages/canvas/hooks/useLightingEngine.ts`

- [ ] **Step 1: 实现 Hook**

```typescript
function useLightingEngine(
  containerRef: RefObject<HTMLDivElement>,
  imageUrl: string | null,
  params: LightingParams,
  viewMode: 'perspective' | 'orthographic',
  onParamsChange: (params: Partial<LightingParams>) => void,
)
```

- `useEffect` 挂载：创建 LightingEngine 实例，开始渲染循环
- `useEffect` 卸载：调用引擎 destroy()
- 参数变化时调用 engine.updateParams()
- 视图切换时调用 engine.switchCamera()
- 光源拖拽回调 → onParamsChange 更新 store

- [ ] **Step 2: Commit**

```
feat(web): add useLightingEngine hook for Three.js engine lifecycle
```

---

## Task 6: Lighting UI 组件（TDD）

**Files:**
- New: `apps/web/src/pages/canvas/components/Lighting/LightingModal.tsx`
- New: `apps/web/src/pages/canvas/components/Lighting/ThreePreview.tsx`
- New: `apps/web/src/pages/canvas/components/Lighting/ControlPanel.tsx`
- New: `apps/web/src/pages/canvas/components/Lighting/ViewToggle.tsx`
- New: `apps/web/src/pages/canvas/components/Lighting/LightPresetButtons.tsx`
- New: `apps/web/src/pages/canvas/components/Lighting/PromptInput.tsx`

- [ ] **Step 1: LightingModal**

全屏弹窗容器。使用 `BaseFullscreenModal` 或独立实现（`createPortal → document.body`，z-index 100000）：
- 顶栏：标题 + 使用手册链接 + Esc 关闭提示 + ✕ 按钮
- 左右分栏布局：左侧 3D 预览（flex-1）+ 右侧参数面板（w-[320px]）
- Esc 关闭、点击遮罩关闭（焦点归还触发按钮）
- 关闭时调用 `lightingStore.closeModal()`
- React Error Boundary 包裹左侧 3D 区

- [ ] **Step 2: ThreePreview**

- 挂载 Canvas DOM 节点
- 调用 `useLightingEngine` hook
- 右上角缩略图（WebGLRenderTarget 渲染到小 Canvas）
- 左下角提示文案「主光源·拖拽移动光源」+ 重置按钮

- [ ] **Step 3: ControlPanel**

参数面板聚合组件，包含：
- ViewToggle
- LightPresetButtons
- 亮度滑块（0-100）
- 色温滑块（2000K-10000K，带渐变色带）
- 轮廓光开关
- PromptInput
- 生成按钮（显示积分如 `15 ⚡`）

- [ ] **Step 4: ViewToggle**

两个按钮：透视 / 正面，当前选中高亮，切换时更新 store

- [ ] **Step 5: LightPresetButtons**

六方向按钮（3×2 网格布局）：左侧、顶部、右侧、前方、底部、后方
- 点击设置对应预设光源坐标
- 当前匹配时高亮
- 预设坐标映射：
  - 左侧: (-6, 0, 4)
  - 顶部: (0, 6, 4)
  - 右侧: (6, 0, 4)
  - 前方: (0, 0, 8)
  - 底部: (0, -6, 4)
  - 后方: (0, 0, 2)

- [ ] **Step 6: PromptInput**

多行文本输入框 + 2 个示例快捷填入按钮（光照效果、背景生成）

- [ ] **Step 7: 写组件单元测试**

LightingModal、ControlPanel、ViewToggle、LightPresetButtons、PromptInput 的渲染和交互测试

- [ ] **Step 8: Commit**

```
feat(web): add Lighting modal UI components with 3D preview and control panel
```

---

## Task 7: 画布节点联动 — ImageNodeToolbar 打光按钮接线

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] **Step 1: ImageNodeToolbar — 添加 onLighting prop + 绑定按钮**

- `ImageNodeToolbarProps` 新增 `onLighting?: () => void`
- 「打光」按钮绑定 `onClick={onLighting}`

- [ ] **Step 2: ImageGenNode — 实现打光回调 + 渲染 LightingModal**

- 定义 `handleLighting` 回调：从节点数据读取 imageUrl、nodeId，调用 `lightingStore.openModal()`
- 在 `ImageGenNode` 渲染中，条件渲染 `<LightingModal />`（弹窗由 store 的 visible 控制）

- [ ] **Step 3: 生成结果回调**

- Socket.io 监听 `node:status` 事件，按 `taskId` 匹配
- `lighting-result`：弹窗展示效果图 + 确认/取消操作
- 确认 → 更新节点 `fileId`/`referenceImage`
- `lighting-failed`：弹窗展示错误提示

- [ ] **Step 4: Commit**

```
feat(web): wire lighting button in ImageNodeToolbar to LightingModal
```

---

## Task 8: 后端 — Prisma Schema 新增 LightingTask

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: 新增 LightingTask 模型 + LightingTaskStatus 枚举**

```prisma
model LightingTask {
  id               String              @id @default(uuid())
  userId           String
  nodeId           String
  projectId        String?
  originalImageUrl String              @db.VarChar(512)
  resultImageUrl   String?             @db.VarChar(512)
  params           Json
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

- [ ] **Step 2: 生成 Prisma migration**

```bash
cd /d/flowweb && pnpm --filter @flowweb/api exec prisma migrate dev --name add_lighting_task
```

- [ ] **Step 3: 验证 migration 成功**

- [ ] **Step 4: Commit**

```
feat(api): add LightingTask model and LightingTaskStatus enum to Prisma schema
```

---

## Task 9: 后端 — DTO + Service + Controller（TDD）

**Files:**
- New: `apps/api/src/modules/ai-image-edit/lighting/dto/create-lighting-task.dto.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/interfaces/lighting-task.interface.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/lighting.service.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/lighting.controller.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/lighting.service.spec.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/lighting.controller.spec.ts`

- [ ] **Step 1: CreateLightingTaskDto**

```typescript
class CreateLightingTaskDto {
  nodeId: string;
  projectId?: string;
  originalImageUrl: string;
  params: LightingParams;  // 内含 customPrompt
}
```

- [ ] **Step 2: 写 Service 测试（RED）**

测试用例：
- `createTask(dto, userId)` → 参数校验通过 → 创建任务记录 → 返回 taskId
- 参数校验失败（position 越界、brightness 不在 0-100、colorTemperature 不在 2000-10000）→ 抛出 BadRequestException
- 积分不足 → 抛出 ForbiddenException
- 幂等提交（同一 userId+nodeId+params 60s 内）→ 返回已有 taskId
- 图片 URL SSRF 校验（内网地址）→ 抛出 BadRequestException

- [ ] **Step 3: 实现 Service（GREEN）**

核心逻辑：
- 参数校验（Zod schema）
- URL SSRF 校验
- 积分预获取（调用 CreditService 获取预估消耗）
- 数据库事务：创建 LightingTask（status: pending）+ 预冻结积分
- 幂等键计算：`hash(userId + nodeId + JSON.stringify(params))`
- 推入 BullMQ 队列（`taskType: 'lighting'`）

- [ ] **Step 4: 写 Controller 测试 → 实现 Controller**

- `POST /api/image-edit/lighting/tasks` — 提交打光任务
- `GET /api/image-edit/lighting/tasks/:taskId` — 查询任务详情

- [ ] **Step 5: 运行测试，确认全绿**

```bash
cd /d/flowweb && pnpm --filter @flowweb/api test -- --run lighting
```

- [ ] **Step 6: Commit**

```
feat(api): add lighting task creation endpoint with params validation and credit check
```

---

## Task 10: 后端 — BullMQ Consumer + AI 网关对接

**Files:**
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts`
- New: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.spec.ts`

- [ ] **Step 1: 扩展 Processor 分发逻辑**

在现有 `AiImageEditProcessor.process()` 方法中新增分发：

```typescript
switch (job.data.taskType) {
  case 'lighting':
    return this.handleLightingJob(job);
  // ... 现有 case
}
```

- [ ] **Step 2: 写 Consumer 测试（RED）**

测试用例：
- `handleLightingJob` → 调用 AI 网关 → 上传结果到 MinIO → 更新任务状态 → 推送 Socket 事件
- AI 接口失败 → 重试 3 次（指数退避）→ 标记 failed → 解冻积分 → 推送失败事件
- 任务超时（45s）→ 标记 failed → 解冻积分

- [ ] **Step 3: 实现 handleLightingJob（GREEN）**

核心流程：
1. 获取原图预签名 URL
2. 构造 AI 请求：将光源参数转化为自然语言提示词前缀，拼接用户自定义提示词
3. 调用 AI 网关（DashScope 通义万相重光照 API）
4. 下载结果图
5. 通过 `MinioService.buildKey('generated', userId, { projectId, nodeId, ext: 'jpg' })` 存储
6. 创建 Media 记录
7. 更新 LightingTask（status: success, resultImageUrl, completedAt）
8. 正式扣减积分（CreditService）
9. 推送 `node:status` 事件 → `{ taskId, nodeId, status: 'lighting-result', resultUrl, fileId }`

失败处理：
- 更新 LightingTask（status: failed, errorMessage）
- 解冻积分
- 推送 `node:status` 事件 → `{ taskId, nodeId, status: 'lighting-failed', error }`

- [ ] **Step 4: 运行测试，确认全绿**

- [ ] **Step 5: Commit**

```
feat(api): add lighting task consumer with AI gateway integration and credit management
```

---

## Task 11: 后端 — 模块注册

**Files:**
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.module.ts`

- [ ] **Step 1: 在 AiImageEditModule 中导入 Lighting 子模块**

- 注册 LightingController、LightingService、LightingConsumer
- 确保依赖注入正确（MinioService、CreditService、PrismaService 等）

- [ ] **Step 2: 验证 NestJS 启动无错误**

```bash
cd /d/flowweb && pnpm --filter @flowweb/api run start:dev  # 检查控制台无模块错误
```

- [ ] **Step 3: Commit**

```
feat(api): register lighting submodule in AiImageEditModule
```

---

## Task 12: 全链路集成验证

- [ ] **Step 1: 启动完整服务栈**

```bash
# 终端 1: API
cd /d/flowweb && pnpm --filter @flowweb/api run start:dev

# 终端 2: Web
cd /d/flowweb && pnpm --filter @flowweb/web run dev
```

- [ ] **Step 2: 端到端手动验证**

验证路径：
1. 画布选中图片节点 → 工具栏「打光」按钮可见
2. 点击打开全屏弹窗 → 3D 预览正常渲染
3. 拖拽光源手柄 → 光影实时更新、无卡顿
4. 切换六方向预设 → 光源位置正确跳转
5. 调节亮度/色温/轮廓光 → 实时同步
6. 点击生成 → 提交任务 → 后端接收 → AI 生成 → Socket 推送结果
7. 确认替换 → 节点图片更新

- [ ] **Step 3: 异常场景验证**

- 图片加载失败 → 弹窗有兜底提示
- 积分不足 → 提交拦截
- AI 接口超时 → 重试后失败提示
- 连续开关弹窗 20 次 → 无内存泄漏

- [ ] **Step 4: Commit（如有 fixup）**

---

## 验证命令速查

| 阶段 | 命令 |
|------|------|
| 前端单元测试 | `pnpm --filter @flowweb/web test -- --run <test-file>` |
| 后端单元测试 | `pnpm --filter @flowweb/api test -- --run lighting` |
| 类型检查 | `pnpm --filter @flowweb/web exec tsc --noEmit` |
| shared 构建 | `pnpm --filter @flowweb/shared build` |
| Prisma migrate | `pnpm --filter @flowweb/api exec prisma migrate dev` |
| API 启动 | `pnpm --filter @flowweb/api run start:dev` |
| Web 启动 | `pnpm --filter @flowweb/web run dev` |

---

## 执行顺序依赖

```
Task 1 (依赖+类型) ──┬── Task 2 (工具函数)
                     │
                     ├── Task 3 (Store)
                     │      │
                     ├── Task 4 (Engine) ── Task 5 (Hook) ── Task 6 (UI组件) ── Task 7 (接线)
                     │
                     └── Task 8 (Prisma) ── Task 9 (DTO+Controller+Service) ── Task 10 (Consumer) ── Task 11 (Module)

                                                                                         Task 12 (集成验证)
```

Task 1-7（前端）与 Task 8-11（后端）可并行开发。
