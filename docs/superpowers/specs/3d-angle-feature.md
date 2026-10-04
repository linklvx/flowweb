<!-- doc-status: historical | verified_at: n/a -->
# Spec: 3D 角度功能 (3D Angle)

> 状态: 待确认  
> 日期: 2026-06-21

## 1. 功能概述

3D 角度功能让用户从一张图片出发，通过可视化的 3D 相机控制面板，调整相机位置和角度，AI 重新生成该角度下的画面。

## 2. 入口

Canvas 页面中，图片节点上方悬浮工具栏（ImageNodeToolbar）第二行的「3D 角度」按钮（已存在 Camera3DIcon，当前无 onClick）。

点击后打开全屏覆盖层（参考 LightingModal 的全屏 portal 模式）。

## 3. 页面布局

左右两栏布局（同 LightingModal）。

### 3.1 左侧：3D 预览区

**场景元素：**
- 图片平面：竖直放置于 X-Y 平面，中心在世界原点 (0,0,0)，正面朝向 +Z；高度固定 2 单位，宽度按原图宽高比自适应
- 图片材质：**MeshBasicMaterial**（不受光照影响，保证色彩与原图一致）；`transparent: true`（兼容 PNG 透明通道）；`depthWrite: true`（保证与地面网格的深度遮挡关系正确）
- 地面网格：X-Z 平面，Y = -1（与图片底部对齐）；10×10 尺寸，10 分段，主色 #333333、辅色 #555555（复用 LightingEngine 网格样式）；仅渲染正面（Y 轴正方向），仰拍视角下不显示背面避免穿帮
- 仅透视相机，无正交/正面模式

**不包含：** 光束锥、光源球、光源线、右上角缩略预览框

**交互：**
- 拖拽：旋转相机视角（OrbitControls），范围与右侧滑块严格对齐；拖拽过程中参数同步采用 16ms 节流（约 60fps），拖拽结束再做一次精确对齐
- 滚轮：缩放画面，范围绑定 zoom 0~10，超出范围时滚轮失效
- OrbitControls 约束：`enablePan = false`（禁用平移，避免相机偏离球坐标计算）；禁用右键平移与双击缩放；仅保留左键旋转 + 滚轮缩放

**加载状态：**
- 加载中：半透明灰色占位平面 + 加载图标
- 加载失败：灰色 fallback 平面 + 中央文字「图片加载失败」，右侧生成按钮置灰禁用

**大图预览：** 原图长边超过 2048px 时，预览纹理自动等比压缩至 2048px，提交生成时使用原图分辨率

**左下角：** 提示文字「拖拽旋转视角 · 滚轮缩放」+ 重置按钮（目标值：水平 0°、垂直 0°、缩放 5）

### 3.2 右侧：控制面板（320px 宽）

| 区域 | 内容 |
|------|------|
| 角度预设 | 标签「多角度」，5 个可点击预设 + 1 个「自定义」状态标签（不可点击，参数偏离所有预设时自动高亮） |
| 水平角度 | 滑块 -90 ~ 90，标签显示当前值 |
| 垂直角度 | 滑块 -60 ~ 60，标签显示当前值 |
| 缩放 | 滑块 0 ~ 10，标签显示当前值 |
| 提示词 | 自定义提示词输入框（复用 PromptInput 组件） |
| 生成按钮 | 显示后端返回的预估积分 + 「生成」按钮 |

**不包含：** 视图模式切换、轮廓光（含问号按钮和开关）

**双向同步强制规则：**
- 拖拽相机 → 右侧滑块实时更新数值（16ms 节流，拖拽结束精确对齐）
- 拖动滑块 → 3D 场景相机视角实时更新
- 点击预设 → 相机与滑块同时同步更新（含缓动动画过渡）
- 以 store 中参数为唯一数据源，引擎与滑块均从 store 取值

### 3.3 预设按钮及参数

5 个可点击预设：鱼眼视角、倾斜视角、正面俯拍、正面仰拍、全景俯拍。

| 预设 | 水平角度 | 垂直角度 | 缩放 |
|------|---------|---------|------|
| 鱼眼视角 | 0 | 30 | 10 |
| 倾斜视角 | 45 | -30 | 5 |
| 正面俯拍 | 0 | 60 | 5 |
| 正面仰拍 | 0 | -30 | 5 |
| 全景俯拍 | 45 | 30 | 0 |

**预设匹配逻辑（阈值匹配）：**

用户拖拽/滑块调整产生的是连续浮点值，不可能与预设整数参数完全相等。采用误差阈值判定：

| 参数 | 匹配阈值 |
|------|---------|
| 水平角度 | ±0.5° |
| 垂直角度 | ±0.5° |
| 缩放 | ±0.1 |

当三个参数与某预设的偏差均在阈值内时，对应预设按钮高亮；超出所有预设阈值时「自定义」标签高亮。自定义标签不可点击，仅作状态指示。

### 3.4 缩放映射规则

zoom 越大相机越近；zoom = 0 最远，zoom = 10 最近。

```
cameraDistance = baseDistance * (1 - zoom / 20)
baseDistance = 5
```

## 4. 数据结构

```typescript
// packages/shared/src/types/angle3d.types.ts

type Angle3DTaskStatus = 'idle' | 'pending' | 'processing' | 'success' | 'failed';

interface Angle3DParams {
  horizontalAngle: number;  // -90 ~ 90
  verticalAngle: number;    // -60 ~ 60
  zoom: number;             // 0 ~ 10
  customPrompt?: string;
}

type Angle3DPresetKey = 'fisheye' | 'tilted' | 'topDown' | 'bottomUp' | 'panoramicTopDown';

interface Angle3DPreset {
  key: Angle3DPresetKey;
  label: string;
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
}
```

## 5. 状态管理

新建 `angle3DStore`（Zustand），不开启 persist（与 lightingStore 一致）。

### Actions

| Action | 说明 |
|--------|------|
| `openModal(nodeId, imageUrl)` | 打开模态并初始化参数（见下方恢复规则） |
| `closeModal()` | 关闭模态，保留当前任务状态不清理（用于恢复） |
| `updateParams(partial)` | 更新部分参数，触发防抖积分重估 |
| `applyPreset(key)` | 应用预设参数 |
| `resetParams()` | 重置为默认值 (0, 0, 5) |
| `setTaskState(payload)` | 更新 taskId / taskStatus / resultUrl / errorMessage |

### 参数恢复规则

| 场景 | 行为 |
|------|------|
| 首次打开某节点 | 初始化为默认参数 (0, 0, 5) |
| 该节点存在进行中/已完成任务 | 打开时同步恢复任务提交时的参数与任务状态 |
| 切换到不同节点 | 各节点参数与任务状态互相独立，互不共用 |

### 默认参数

```typescript
const defaults: Angle3DParams = {
  horizontalAngle: 0,
  verticalAngle: 0,
  zoom: 5,
};
```

## 6. 3D 引擎

新建 `Angle3DEngine`，参考但不复用 LightingEngine。

### 6.1 球坐标相机计算

```
α = horizontalAngle（弧度，绕 Y 轴）
β = verticalAngle（弧度，俯仰角，向上为正）
r = 5 * (1 - zoom / 20)

camera.x = r * sin(α) * cos(β)
camera.y = r * sin(β)
camera.z = r * cos(α) * cos(β)
camera.lookAt(0, 0, 0)
```

### 6.2 OrbitControls 约束

```
水平旋转（azimuth）：对应 horizontalAngle，范围 [-π/2, π/2]
俯仰角（polar）：对应 verticalAngle，约束 [π/6, 5π/6]
距离（distance）：由 zoom 推导，minDistance / maxDistance 由 zoom 0~10 反算
```

### 6.3 渲染模式

脏标记渲染：仅当参数变化或交互触发时渲染，不开启常驻 rAF 循环（与 LightingEngine 的 dirty flag 模式一致）。

### 6.4 生命周期

必须实现：`init()`、`render()`、`resize()`、`dispose()`

dispose 完整释放：纹理、几何体、材质、OrbitControls、渲染器、事件监听。模态关闭时自动调用。

### 6.5 异常处理

- `webglcontextlost` 事件：console.error 输出，场景降级
- 纹理加载失败：显示灰色 fallback 平面

## 7. 后端 API

### 端点

- `POST /api/image-edit/angle3d/tasks` — 创建任务
- `GET /api/image-edit/angle3d/tasks/:taskId` — 查询任务状态

### 请求体

```json
{
  "sourceNodeId": "string",
  "canvasId": "string",
  "params": {
    "horizontalAngle": 0,
    "verticalAngle": 0,
    "zoom": 5,
    "customPrompt": "string (optional)"
  }
}
```

### 响应体

```json
{
  "taskId": "string",
  "estimatedCredits": 15,
  "status": "pending"
}
```

### 安全与计费

- **鉴权**：接入 Better Auth，校验用户对画布的编辑权限
- **队列**：复用现有 `ai-image-edit` BullMQ 队列，按任务类型 `angle3d` 分发
- **资损防控**：提交时预冻结积分，失败/超时自动解冻
- **通知**：Socket.io 实时推送 + HTTP 轮询双通路
- **存储**：结果图片存入 MinIO，返回永久 URL
- **积分预估**：模态打开时请求初始预估积分；参数变更后防抖 300ms 重新请求；仅展示后端返回值，前端不做扣费计算

## 8. 共享类型

在 `packages/shared/src/types/` 新增 `angle3d.types.ts`，并在 `packages/shared/src/index.ts` 中导出。

## 9. 边界情况

| 场景 | 处理 |
|------|------|
| 图片加载中 | 半透明占位平面 + 加载图标 |
| 图片加载失败 | 灰色 fallback + 文字提示，生成按钮禁用 |
| 生成中 | 生成按钮显示「生成中...」并禁用 |
| 生成失败 | 错误遮罩 + 错误信息 + 重试按钮 |
| 生成成功 | 结果遮罩 + 两个选项：「替换当前节点」「新建图片节点」 |
| Esc 键 | 关闭模态 |
| 点击遮罩背景 | 关闭模态 |
| 事件穿透 | 双重保障：① 模态根元素捕获 wheel/mousedown/touchstart 并 stopPropagation；② 模态打开时 `useReactFlow().setInteractive(false)`，关闭时恢复 |
| 生成中关闭模态 | 不终止后台任务；closeModal 保留任务状态；下次打开同节点时自动恢复参数与任务状态 |
| 图片跨域 | 纹理加载走 MinIO CORS 配置，避免跨域失败 |
| 拖拽超出滑块范围 | OrbitControls 受范围约束，与滑块严格对齐 |
| 透明 PNG | MeshBasicMaterial + transparent: true 保证透明通道正确渲染 |
| 空提示词 | 允许提交，后端使用默认 prompt |

## 10. 风险与规避

| 风险 | 规避方案 |
|------|---------|
| 相机拖拽与滑块参数不同步 | 以 store 中参数为唯一数据源，引擎与滑块均从 store 取值 |
| 模态多次开关导致内存泄漏 | 强制 dispose 全资源清理 |
| 前端预估积分与后端扣费不一致 | 前端仅展示后端返回值，扣费逻辑完全收敛在后端 |
| 大图纹理加载阻塞 | 异步加载 + 超过 2K 分辨率自动压缩预览 |

## 11. 可选优化（非 MVP）

- 预设悬停预览：鼠标悬停时临时切换视角，移开恢复
- 生成结果对比：左右拖拽对比原图与结果
- 自动高亮最近预设：手动调参时自动匹配
- 地面网格单面渲染：仰拍视角下不显示背面避免穿帮
- 大图预览压缩：原图长边 > 2048px 时自动等比压缩，提交时用原图

## 12. 核心测试用例

| 测试场景 | 验证点 |
|---------|--------|
| 边界角度测试 | 拖拽到 ±90° 水平角、±60° 垂直角，验证滑块同步与范围限制生效 |
| 模态反复开关 | 验证 dispose 完整性，无内存泄漏、无重复初始化报错 |
| 生成中关闭再打开 | 同节点恢复任务状态与参数；不同节点参数隔离 |
| 透明 PNG 测试 | 透明通道渲染正常（MeshBasicMaterial + transparent） |
| 预设阈值匹配 | 拖拽参数接近预设时正确高亮预设按钮，偏离时高亮「自定义」 |
| 事件穿透 | 模态打开时背景画布不响应滚轮/拖拽；关闭后恢复正常 |
| 缩放边界 | 滚轮缩放到 0/10 边界时失效，不越界 |

## 13. 不做什么

- 不做正面视图模式
- 不做光源拖拽
- 不做轮廓光
- 不做缩略图预览
- 不修改 LightingEngine 现有代码
