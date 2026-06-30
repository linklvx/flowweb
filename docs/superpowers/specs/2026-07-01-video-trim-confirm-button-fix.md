# 视频剪辑确认按钮无效 Bug Fix Spec

## 问题现象

Canvas 画布中，点击视频节点悬浮工具条的「剪辑」按钮弹出剪辑面板，调整 Slider 后点击「确认裁剪」按钮无效——无错误提示，无状态变化，剪辑操作不执行。

## 根因分析

### 根因 #1：Socket.io 房间名不匹配 → 状态更新无法到达前端

**前端** `VideoGenNode.tsx` socket connect：
```typescript
socket.emit('join', 'default'); // 硬编码加入 project:default
```

**后端** `ExecutionGateway.emitTrimStatus()`：
```typescript
this.server.to(`project:${workflowId}`).emit('video-trim:status', data);
// workflowId 来自 media.projectId，与前端传入的 'default' 不匹配
```

**`useTrimTaskStatus.ts` 逻辑**：
```typescript
const shouldPoll = !socket || !socket.connected;
// socket 已连接 → shouldPoll = false → 不启动轮询
```

**故障链**：
1. Socket 通过 polling 传输连接成功 → `socket.connected === true`
2. 前端加入房间 `project:default`
3. 后端 emit 到房间 `project:${actualWorkflowId}`
4. 房间不匹配 → 前端永远收不到 `video-trim:status` 事件
5. `socket.connected === true` → 轮询降级不启动
6. 任务状态永久停留在 `idle`，`useEffect` 中 `trimStatus.status === 'done'` 永不触发
7. 面板不关闭，用户看不到任何效果

### 根因 #2：API 调用失败时错误未显示在面板

`VideoGenNode.tsx` `handleConfirmTrim` catch 块：
```typescript
catch (err) {
  useNodeStore.getState().setTrimTaskStatus(id, 'error'); // 写入 nodeStore
}
```

但 `VideoTrimPanel` 使用 `taskStatus={trimStatus.status}`（来自 `useTrimTaskStatus(trimTaskId)`），而非 `nodeStore.trimTaskStatus`。两者是独立状态，API 失败时面板不显示错误提示。

### 根因 #3：面板外层 wrapper 缺少 React Flow 事件隔离

`VideoGenNode.tsx` 中 `VideoTrimPanel` 的外层 wrapper div 未添加 `nodrag nopan` 类名，极端情况下画布可能拦截点击事件。

## 修复方案

### 修复 1：Socket 房间修复 — 正确加入 + 空值兜底 + 全局排查

**1a. 命名对齐**：确认 `frontend projectId` 与 `backend workflowId` 为同一实体，前端 join 房间时使用真实 projectId（从 `useCanvasStore` 或 URL 参数获取），不再硬编码 `'default'`。

**1b. 空值兜底**：若获取不到真实 projectId，不执行 `socket.emit('join', ...)`，强制走轮询模式，避免「假连接、真收不到消息」的假活状态。

**1c. 全局排查**：排查画布内所有 `socket.emit('join', 'default')` 硬编码，统一修复。

### 修复 2：双频轮询策略 — 主辅并行

原 spec §5.10 设计的「Socket 连接时关闭轮询」在房间异常场景下有盲区。改为双频并行：

| 场景 | 轮询频率 | 说明 |
|------|---------|------|
| Socket 连接正常 | 5~10s 低频轮询 | 最终一致性兜底 |
| Socket 断开 | 3s 高频轮询 | 快速感知状态变化 |
| 收到终态（done/error） | 立即停止所有轮询 | 减少无效请求 |

收益：解决房间异常时的可用性问题，避免全量高频轮询的服务器压力，保留 Socket 低延迟优势。

### 修复 3：状态源收敛 — 以 useTrimTaskStatus 为唯一数据源

`useTrimTaskStatus` 作为 `VideoTrimPanel` 唯一状态源，API 提交失败时直接将错误写入 hook 内部状态。仅任务终态（success/error）同步回 nodeStore 做持久化，提交阶段的临时错误不污染数据层。

具体做法：
- `handleConfirmTrim` catch 中不再写 nodeStore，改为返回 reject / 抛出
- `handleConfirm` 中 catch 后调用 `useTrimTaskStatus` 的状态写入（通过 callback 或 hook 提供 `setState`）
- 仅终态同步 nodeStore（在 `useEffect` 中写 `setTrimmedResult` / `setTrimTaskStatus`）
- 删除 `handleConfirmTrim` 中的 `useNodeStore.getState().setTrimTaskStatus(id, 'error')`

### 修复 4：事件隔离 — 双重兜底

- `VideoTrimPanel` 外层 wrapper div 添加 `nodrag nopan` 类名
- 确认按钮点击回调中补充 `e.stopPropagation()`（在 `handleConfirm` 的参数中传递 event）

## 优化项（低成本高收益）

| 优化项 | 说明 |
|--------|------|
| **按钮加载态** | 提交过程中按钮强制 `disabled` + 加载文案，防止重复点击，消除「无效」体感 |
| **请求超时** | API 请求增加 10s 超时（AbortController），超时按失败处理并显示提示，避免网络挂起时永久无反馈 |
| **日志埋点** | Socket 接收事件、轮询返回结果、API 调用失败三个节点增加前端日志 |

## 影响范围

| 文件 | 改动 |
|------|------|
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | socket join 用真实 projectId + 空值兜底 + wrapper nodrag nopan + 错误处理重构 + stopPropagation |
| `apps/web/src/hooks/useTrimTaskStatus.ts` | 双频轮询策略 + 提供 setError 接口 |
| `apps/web/src/pages/canvas/components/nodes/VideoTrimPanel.tsx` | API 超时 + 确认按钮 stopPropagation + 加载态文案 |
| `apps/web/src/services/video-trim.api.ts` | AbortController 超时（可选） |
| 全局排查 | 扫描所有 `socket.emit('join', 'default')` 硬编码 |

## 验收标准

| 序号 | 验收场景 | 预期结果 |
|------|---------|---------|
| 1 | 点击「确认裁剪」 | 按钮变为「提交中...」→ API 成功后显示「裁剪中...」→ 后端完成后面板关闭、子节点出现 |
| 2 | API 调用失败（参数错误/网络异常） | 面板内显示明确错误文案，而非静默无反应 |
| 3 | 点击面板边缘、滑块、按钮任意区域 | 不触发画布拖拽、平移、缩放 |
| 4 | 刷新页面后重新打开节点 | 已完成的裁剪任务状态、结果文件正确保留 |
| 5 | 手动断开 Socket 连接后提交裁剪 | 轮询正常工作，任务完成后面板自动关闭 |
| 6 | 获取不到 projectId 时提交裁剪 | 强制走轮询模式，任务正常完成 |
| 7 | 快速连续点击确认按钮 | 仅提交一次（提交中 disabled），不会重复创建任务 |
| 8 | 全局无其他 `'default'` 硬编码 | `grep` 扫描结果为零 |
