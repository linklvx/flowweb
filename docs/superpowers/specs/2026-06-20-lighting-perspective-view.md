# Spec: 打光透视视图功能

## 概述

为打光弹窗左侧 3D 预览区新增「透视」视图模式。正面正交视图（已验收）保持不动，透视视图呈现斜视角 3D 空间效果：地面网格近大远小、图片垂直立于地面、光源在空间中清晰可辨。

## 现状

- 双相机已创建（`initCameras`），`switchViewMode()` 已实现切换逻辑
- GridHelper 当前为一个 XY 平面网格（rotation.x=π/2, z=-0.5），正面视图下效果已验收
- OrbitControls 已绑定透视相机，`switchViewMode()` 中通过 `controls.enabled` 开关
- 光源拖拽与相机旋转互斥已在 `onPointerDown/onPointerUp` 中实现
- 后处理相机同步已在 `switchViewMode()` 中处理
- 默认视图为正面（`useState<ViewMode>('front')`）

## 核心设计决策

1. **正面视图参数冻结** — 正交相机 z=14、frustumSize=12、planeHeight=4 **全部不变**
2. **双网格显隐切换** — XY 网格（正面视图）和 XZ 地面网格（透视视图）各一个，切换视图时 `visible` 互斥
3. **透视相机新位置** — (-3, 2, 12)，左前上方斜视角，自然呈现三维空间关系
4. **OrbitControls 仅在透视视图生效** — 正面视图完全禁用旋转/缩放/平移
5. **光照参数天然共享** — 同一场景内的光源实例在两种视图间共享，切换相机仅改变观察视角，不修改任何光照状态，无需额外开发同步逻辑

---

## 功能需求

### 1. 透视相机参数调整

**当前状态**：透视相机位于 (0, 0, 14)，FOV=45，far=100

**改为**：

| 参数 | 修改前 | 修改后 | 说明 |
|------|--------|--------|------|
| position | (0, 0, 14) | (-3, 2, 12) | 左前上方斜视角 |
| target (controls.target) | 无显式设置 | (0, 0, 0) | 旋转中心为图片平面中心，与 lookAt 一致 |
| fov | 45 | 45 | 保持不变 |
| near | 0.1 | 0.1 | 保持不变 |
| far | 100 | 100 | 保持不变 |
| lookAt | (0, 0, 0) | (0, 0, 0) | 保持不变 |

相机初始化时同时创建，默认激活正交相机（对齐当前正面视图默认态）。

### 2. 双网格系统

**当前**：一个 GridHelper，XY 平面（rotation.x=π/2），z=-0.5

**改为**：

| 网格 | 平面 | 位置 | 正面视图 | 透视视图 |
|------|------|------|:--:|:--:|
| XY 网格（现有，**参数完全不动**） | XY（rotation.x=π/2） | z=-0.5 | visible | hidden |
| XZ 地面网格（新增） | XZ（无旋转） | y=-2 | hidden | visible |

XZ 地面网格参数：尺寸 20×20，细分 20，中心线 #334155，网格线 #1e293b（与 XY 网格相同的线色、细分、尺寸规格）。XY 网格保持现有所有参数完全不变，杜绝正面视图视觉回归。

`switchViewMode()` 中切换 `visible`：
- 正面：xyGrid.visible=true, xzGrid.visible=false
- 透视：xyGrid.visible=false, xzGrid.visible=true

### 3. OrbitControls 参数调整

**当前**：dampingFactor=0.08，无范围限制，未显式设置 target

**改为**：

| 参数 | 修改前 | 修改后 |
|------|--------|--------|
| target | 未显式设置 | (0, 0, 0)，与相机 lookAt 一致 |
| dampingFactor | 0.08 | 0.05 |
| minDistance | 无 | 8 |
| maxDistance | 无 | 20 |
| minPolarAngle | 无 | 10° (≈0.175 rad) |
| maxPolarAngle | 无 | 80° (≈1.396 rad) |
| enableRotate/Zoom/Pan（正面） | enabled=false | enabled=false，且三个子开关也 false |

正面视图下：
```
controls.enabled = false
controls.enableRotate = false
controls.enableZoom = false
controls.enablePan = false
```

透视视图下：
```
controls.enabled = true
controls.enableRotate = true
controls.enableZoom = true
controls.enablePan = true
```

### 4. 阻尼动画渲染触发

透视视图下 OrbitControls 开启阻尼（enableDamping=true），用户松手后存在惯性运动。当前脏标记渲染仅在参数变更、光源拖拽时触发，阻尼惯性运动期间不会持续渲染，导致动画卡顿掉帧。

**修正**：渲染循环中增加判断——当 `controls.enabled === true` 时，始终触发渲染（controls 内部自动检测阻尼是否停止）；运动完全结束后恢复脏标记模式。

实现方式：在 `startLoop()` 的 animate 回调中，将 `if (this.dirty)` 条件改为 `if (this.dirty || this.orbitControls.enabled)`。

### 5. 视图切换保留用户视角

切换视图不重置 OrbitControls 的旋转角度与缩放距离，保留用户在透视视图中的操作状态。仅点击左下角「重置」按钮时，恢复到默认透视视角：相机位置重置为 (-3, 2, 12)，target 重置为 (0, 0, 0)。

### 6. 光源拖拽平面兼容性

透视视图下光源拖拽平面与正面视图**完全一致**：平行于图片平面的虚拟平面（Z=4），X∈[-8, 8]，Y∈[-6, 6]，Z∈[2, 10]。射线检测自动适配当前激活相机的投影矩阵，保证两种视图下拖拽手感统一。

### 7. 视觉增强元素（可选，本次不做）

以下元素在 spec 中记录但推迟到后续迭代：

- **5 条发散光束线**：从光源球体指向图片中心+四角，模拟手电筒照射范围
- **2 圈半透明弧形轨道环**：半径 10/14 单位，增强空间纵深感

### 8. 容器 Resize 适配

`fitRenderer()` 中双相机参数同步更新（当前已实现，无需修改）：
- 透视相机：更新 aspect → updateProjectionMatrix()
- 正交相机：按新宽高比重算 left/right → updateProjectionMatrix()

### 9. 后处理同步

`switchViewMode()` 中同步 OutlinePass 相机（当前已实现，无需修改）：
```typescript
if (this.outlinePass) {
  this.outlinePass.renderCamera = this.activeCamera;
}
```

---

## 改动范围

### 修改文件

| 文件 | 改动 |
|------|------|
| `apps/web/src/pages/canvas/engine/LightingEngine.ts` | 透视相机位置、新增 XZ 地面网格、双网格显隐切换、OrbitControls 参数 |

### 不修改文件

- `LightingModal.tsx` — viewMode 状态管理已完成
- `ControlPanel.tsx` — ViewToggle 已正确绑定
- `ThreePreview.tsx` — 无需变更
- `useLightingEngine.ts` — 无需变更
- 所有后端文件

---

## 验收标准

### 功能测试

- [ ] 点击「透视」按钮，画面切换为斜透视效果，XZ 地面网格呈现近大远小
- [ ] 点击「正面」按钮，画面恢复正交正面视图，XY 网格恢复显示
- [ ] 切换视图后用户视角保留（旋转角度、缩放距离不变），仅「重置」按钮恢复默认视角
- [ ] 透视视图下松手后阻尼惯性动画流畅，无卡顿掉帧
- [ ] 连续切换视图 20 次，无闪烁、无 WebGL 报错、无内存泄漏
- [ ] 切换视图后光源位置、亮度、色温、轮廓光状态完全一致（天然共享光源实例）
- [ ] 透视视图下拖拽光源手柄，拖拽平面为 Z=4，边界约束与正面视图一致
- [ ] 拖拽光源时 OrbitControls 自动禁用，松手后恢复
- [ ] 透视视图下鼠标滚轮缩放范围在 8-20 单位内
- [ ] 透视视图下垂直旋转角度被限制在 10°~80°，图片始终可见
- [ ] 正面视图下鼠标操作不触发任何相机旋转/缩放/平移
- [ ] 容器 resize 后两种视图均正确适配

### 回归测试

- [ ] 正面视图所有已有功能正常（滑块、预设按钮、轮廓光、缩略图）
- [ ] 现有 30 个测试全部通过

### 性能测试

- [ ] 空闲状态 CPU 占用 ≈ 0
- [ ] 视图切换延迟 < 16ms（1 帧内完成）

---

## 不做（Out of scope）

- 不做 5 条发散光束线（推迟到后续迭代）
- 不做弧形轨道辅助环（推迟到后续迭代）
- 不修改正面视图任何参数
- 不修改右侧控制面板
- 不修改弹窗框架
- 不添加视图切换过渡动画（直接切换，一帧内完成）
