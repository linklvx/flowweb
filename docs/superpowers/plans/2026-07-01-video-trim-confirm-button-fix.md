# 视频剪辑确认按钮无效 — 实施 Plan

## 总体策略

按 TDD 红-绿-重构循环，先写测试 → 确认失败 → 写实现 → 测试通过。按依赖关系分 5 个任务依次执行。

---

## Task 1：canvasStore 新增 projectId + 前端 Socket 房间修复 + 重连/离开房间

**目标**：修复 Socket.io 房间名不匹配问题（根因 #1），补充重连重入、组件卸载离房

### 关键约束

- **房间名前缀严格对齐**：前端 join 使用 `project:${projectId}` 格式，与后端 `emitTrimStatus` / `handleJoin` 的 `project:${workflowId}` 完全对齐
- **空值兜底**：projectId 为空时不 join 任何房间，强制走轮询

### 测试用例

| # | 测试 | 验证点 |
|---|------|--------|
| 1.1 | `canvasStore` setProjectId / getProjectId | 存储/读取 projectId |
| 1.2 | VideoGenNode socket join 使用 `project:${projectId}` | `socket.emit('join', 'project:actualId')` 精确匹配 |
| 1.3 | VideoGenNode 无 projectId 时不 join | `socket.emit('join', ...)` 不被调用 |
| 1.4 | ImageGenNode socket join 使用 `project:${projectId}` | 同上修复 |
| 1.5 | AudioGenNode socket join 使用 `project:${projectId}` | 同上修复 |
| 1.6 | Socket 重连后自动重新加入房间 | `reconnect` 事件触发 `socket.emit('join', ...)` |
| 1.7 | 组件卸载时离开房间 | cleanup 中 `socket.emit('leave', 'project:${projectId}')` 被调用 |

### 实现步骤

1. **`canvasStore.ts`**：新增 `projectId: string | null` + `setProjectId(projectId: string)` action
2. **`page.tsx`**：`CanvasPageInner` 挂载时调用 `canvasStore.getState().setProjectId(projectId)`；若 projectId 会动态变化，补充监听切换逻辑（离开旧房间 → 加入新房间）
3. **`VideoGenNode.tsx`**：
   - 从 `useCanvasStore` 读取 `projectId`
   - `socket.on('connect', ...)` 中：若 `projectId` 存在 → `socket.emit('join', 'project:${projectId}')`；否则不 join
   - 新增 `socket.on('reconnect', ...)` → 重新 join 房间
   - cleanup 中：`socket.emit('leave', 'project:${projectId}')`
4. **`ImageGenNode.tsx`**：同上全部逻辑
5. **`AudioGenNode.tsx`**：同上全部逻辑

### 验证命令

```bash
pnpm test -- --reporter=verbose \
  canvasStore.test.ts \
  VideoGenNode.test.tsx \
  ImageGenNode.test.tsx \
  AudioGenNode.test.tsx
```

---

## Task 2：useTrimTaskStatus 双频轮询策略

**目标**：Socket 连接时低频兜底轮询，Socket 断开时高频轮询，收到终态停止；状态更新后重置轮询计时

### 关键约束

- **轮询间隔统一**：低频 = 10000ms，高频 = 3000ms
- **状态更新重置计时**：Socket 事件触发状态更新后，重置轮询定时器，避免刚收到推送就发起重复请求

### 测试用例

| # | 测试 | 验证点 |
|---|------|--------|
| 2.1 | socket 连接时启动低频轮询（10s） | `setInterval` 参数为 10000 |
| 2.2 | socket 断开时切换为高频轮询（3s） | socket disconnect 后轮询间隔为 3000 |
| 2.3 | socket 重连时切回低频轮询 | socket reconnect 后间隔恢复 10000 |
| 2.4 | Socket 事件更新后重置轮询计时 | 收到事件后定时器被 clear 并重新 set |
| 2.5 | 收到 `done` 状态后停止所有轮询 | `clearInterval` 被调用 |
| 2.6 | 收到 `error` 状态后停止所有轮询 | `clearInterval` 被调用 |
| 2.7 | taskId 变为 null 时清除轮询 | 清理副作用 |

### 实现步骤

1. **`useTrimTaskStatus.ts`**：
   - 常量：`POLL_LOW = 10000`，`POLL_HIGH = 3000`
   - 监听 socket `connect` / `disconnect` / `reconnect` 事件切换间隔
   - Socket 事件触发后 `stopPolling()` → 立即 `startPolling(currentInterval)`
   - 终态时 `stopPolling()`

### 验证命令

```bash
pnpm test -- --reporter=verbose useTrimTaskStatus.test.ts
```

---

## Task 3：错误状态收敛 — 以 useTrimTaskStatus 为唯一数据源

**目标**：API 提交失败时错误写入 hook 内部状态；终态（done/error）由 hook 内部自动同步到 nodeStore；调用方无需关心数据层写入

### 关键约束

- **职责边界**：`useTrimTaskStatus` 内部收到 `done`/`error` 终态时，自动调用 nodeStore 对应 action 持久化；调用方（VideoGenNode）无需重复写入
- **提交阶段临时错误不写入 nodeStore**：仅在终态时同步

### 测试用例

| # | 测试 | 验证点 |
|---|------|--------|
| 3.1 | API 提交失败后 hook 内 `error` 非空 | `useTrimTaskStatus` 返回 error 有值 |
| 3.2 | API 提交失败后 VideoTrimPanel 显示错误文案 | 面板渲染错误提示 |
| 3.3 | 终态 `done` 时 hook 自动调用 `nodeStore.setTrimmedResult` | `setTrimmedResult` 被调用 |
| 3.4 | 终态 `error` 时 hook 自动调用 `nodeStore.setTrimTaskStatus` | `setTrimTaskStatus` 被调用 |
| 3.5 | 提交阶段临时错误不写入 nodeStore | `setTrimTaskStatus` 仅在终态时被调用 |
| 3.6 | VideoTrimPanel 不新增本地 error state | 单一数据源 |

### 实现步骤

1. **`useTrimTaskStatus.ts`**：
   - 新增 `setError(error: string)` 方法暴露给调用方（API 提交失败时使用）
   - 内部 `useEffect` 监听终态变化，自动调用 nodeStore action 持久化
2. **`VideoGenNode.tsx`**：
   - `handleConfirmTrim` catch 中调用 hook 暴露的 `setError`，不再写 `nodeStore.setTrimTaskStatus`
   - 删除 `useEffect` 中对终态的手动 nodeStore 同步（改为 hook 内部处理）

### 验证命令

```bash
pnpm test -- --reporter=verbose VideoTrimPanel.test.tsx useTrimTaskStatus.test.ts VideoGenNode.test.tsx
```

---

## Task 4：事件隔离 + 超时 + 日志埋点

**目标**：双重事件隔离 + API 10s 超时 + 统一日志埋点

### 关键约束

- **日志使用项目统一工具**：优先使用项目内置 logger 实例，而非原生 `console.log`
- **超时与网络错误文案区分**：10s 超时提示「请求超时，请重试」，普通网络错误提示「网络异常，请检查连接」

### 测试用例

| # | 测试 | 验证点 |
|---|------|--------|
| 4.1 | 确认按钮 onClick 调用 `e.stopPropagation` | 事件传播被阻止 |
| 4.2 | wrapper div 包含 `nodrag nopan` 类名 | classList 验证 |
| 4.3 | API 请求超过 10s 被 AbortController 中止 | `AbortError` 被捕获，显示超时文案 |
| 4.4 | 普通网络错误显示不同文案 | 错误文案 ≠ 超时文案 |
| 4.5 | 提交中按钮 disabled | `disabled` 属性为 true |
| 4.6 | `video-trim:status` 事件接收有日志 | 日志含 taskId |
| 4.7 | 轮询返回结果有日志 | 日志含 status |
| 4.8 | API 调用失败有日志 | 日志含错误信息 |

### 实现步骤

1. **`VideoGenNode.tsx`**：wrapper div 添加 `className="nodrag nopan"`
2. **`VideoTrimPanel.tsx`**：`handleConfirm` 签名改为接收 `React.MouseEvent`，调用 `e.stopPropagation()`
3. **`video-trim.api.ts`**：`submitTrim` 增加 `AbortController` 10s 超时；区分超时/网络错误文案
4. **日志埋点**：Socket 事件、轮询返回、API 失败三处加日志

### 验证命令

```bash
pnpm test -- --reporter=verbose VideoTrimPanel.test.tsx video-trim.api.test.ts
```

---

## Task 5：集成验证 + 全局扫查确认

**目标**：端到端验证 + 确认全局无硬编码残留

### 手动验证

| # | 场景 | 预期 |
|---|------|------|
| 5.1 | 正常裁剪流程 | 确认 → 提交中 → 裁剪中 → 面板关闭 → 子节点出现 |
| 5.2 | Socket 断开时裁剪 | 轮询正常工作，面板最终关闭 |
| 5.3 | API 参数错误 | 面板显示错误文案 |
| 5.4 | 网络超时（>10s） | 面板显示「请求超时，请重试」 |
| 5.5 | 普通网络错误 | 面板显示「网络异常，请检查连接」 |
| 5.6 | 点击面板任意区域（边缘、滑块、按钮） | 不触发画布拖拽/平移/缩放 |
| 5.7 | 快速双击确认 | 仅提交一次（disabled 拦截） |
| 5.8 | 提交任务后关闭面板，重新打开节点 | 正确显示当前任务状态，不重复提交 |
| 5.9 | 裁剪过程中断网重连 | Socket 重连后自动恢复状态推送，面板正常关闭 |
| 5.10 | 切换不同项目的视频节点 | 各自加入对应项目房间，消息互不串扰 |

### 全局扫查

```bash
# 确认无 'default' 残留
grep -rn "join.*'default'" apps/web/src/ --include="*.tsx" --include="*.ts"

# 确认所有 join 使用 project: 前缀
grep -rn "emit('join'" apps/web/src/ --include="*.tsx" --include="*.ts"
```

---

## 文件变更汇总

| 文件 | Task | 动作 |
|------|------|------|
| `apps/web/src/stores/canvasStore.ts` | 1 | 新增 `projectId` + `setProjectId` |
| `apps/web/src/pages/canvas/page.tsx` | 1 | 调用 `setProjectId` + projectId 变更监听 |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | 1,3,4 | socket join/reconnect/leave + 错误处理 + nodrag nopan + 日志 |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 1 | socket join/reconnect/leave 修复 |
| `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx` | 1 | socket join/reconnect/leave 修复 |
| `apps/web/src/hooks/useTrimTaskStatus.ts` | 2,3 | 双频轮询 + setError + 终态自动同步 nodeStore + 日志 + 状态更新重置计时 |
| `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.tsx` | 4 | stopPropagation |
| `apps/web/src/services/video-trim.api.ts` | 4 | AbortController 10s 超时 + 区分错误文案 |
| 测试文件（各 Task 验证命令所列） | 1-4 | 新增/修改测试 |

## 执行顺序

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```
