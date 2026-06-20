# 打光透视视图功能 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为打光弹窗左侧 3D 预览区新增「透视」视图模式，斜视角呈现完整三维空间关系，与正面视图双向切换。

**Architecture:** 仅修改 `LightingEngine.ts` 单文件。双相机已创建、切换逻辑骨架已存在——本次在现有骨架上补充：透视相机新位置、XZ 地面网格、OrbitControls 约束参数、相机运动检测渲染触发、双网格显隐切换、reset 逻辑增强。

**Default alignment:** 引擎内部默认 viewMode 与 lightingStore 初始值、LightingModal 默认值三者均为 `'front'`，初始化时直接激活正交相机，不执行冗余切换。

**Tech Stack:** Three.js + TypeScript strict + Vitest

---

## 改动文件

| 文件 | 操作 | 职责 |
|------|------|------|
| `apps/web/src/pages/canvas/engine/LightingEngine.ts` | 修改 | 核心改动文件 |
| `apps/web/src/pages/canvas/engine/LightingEngine.test.ts` | 修改 | 新增测试覆盖 |

---

## Task 1: 新增 XZ 地面网格 → verify: 测试通过

**What:**
- 新增 `xzGridHelper: THREE.GridHelper` 字段
- `initGrid()` 中原 `gridHelper` 重命名为 `xyGridHelper`，参数完全不动；同时创建 `xzGridHelper`（XZ 平面，无旋转，y=-2，visible=false）并通过 `this.scene.add(this.xzGridHelper)` 挂载。xzGrid 参数：尺寸 20×20，细分 20，中心线 0x334155，网格线 0x1e293b
- **全量替换**：所有原 `this.gridHelper` 引用（`initGrid` 内的 add、`switchViewMode` 中的显隐切换、字段声明等）全部同步替换为 `this.xyGridHelper`
- **销毁**：XZ 网格与现有 XY 网格统一走 `dispose()` 中的 `scene.traverse` 遍历销毁，无需单独处理（GridHelper 的 Line 对象需在 dispose 中覆盖；若当前遍历仅覆盖 Mesh，需扩展覆盖 Line）

**Test:**
- 验证引擎创建后包含 xyGrid 和 xzGrid 两个 GridHelper 实例
- 验证 xzGrid 初始 visible=false，xyGrid 初始 visible=true
- 验证现有 xyGrid 参数（rotation.x=π/2, z=-0.5）未被修改

---

## Task 2: 更新透视相机位置 + 引擎默认对齐 → verify: 测试通过

**What:**
- `initCameras()` 中透视相机 position 从 `(0, 0, 14)` 改为 `(-3, 2, 12)`
- 引擎默认 `viewMode` 从 `'perspective'` 改为 `'front'`
- 默认 `activeCamera` 从 `this.perspectiveCamera` 改为 `this.orthographicCamera`
- 与 `lightingStore` 初始值、`LightingModal` 默认值三者一致，初始化时直接激活正交相机，无中间态切换

**Test:**
- 验证透视相机初始位置为 (-3, 2, 12)
- 验证默认 activeCamera 为正交相机
- 验证初始化后 viewMode 为 'front'

---

## Task 3: 更新 OrbitControls 参数与约束 → verify: 测试通过

**What:**
- `dampingFactor`: 0.08 → 0.05
- 新增 `minDistance = 8`、`maxDistance = 20`
- 新增极角限制（精确弧度）：
  ```typescript
  controls.minPolarAngle = 10 * Math.PI / 180;   // 10°
  controls.maxPolarAngle = 80 * Math.PI / 180;   // 80°
  ```
- `target` 已有 `(0, 0, 0)` 设置，保持不变

**Test:**
- 验证 dampingFactor、minDistance、maxDistance、minPolarAngle、maxPolarAngle 均已正确设置

---

## Task 4: 更新 switchViewMode() 逻辑 → verify: 测试通过

**What:**
- 切换 `xyGridHelper.visible` / `xzGridHelper.visible`：
  - 正面：xyGrid=true, xzGrid=false
  - 透视：xyGrid=false, xzGrid=true
- 透视视图：`controls.enableRotate/enableZoom/enablePan = true`
- 正面视图：`controls.enableRotate/enableZoom/enablePan = false`（配合已有的 `controls.enabled = false`，正面视图下完全锁定）
- 视图切换**不重置**相机位置/旋转/缩放（保留用户操作状态）
- 后处理 OutlinePass 相机同步（已有逻辑，保持不变）
- 方法末尾执行 `this.dirty = true`（已有，无需改动），强制切换后立即重绘一帧，避免旧画面残留

**Test:**
- 切换到透视视图：xzGrid.visible=true, xyGrid.visible=false, controls 三个子开关全为 true
- 切换到正面视图：xzGrid.visible=false, xyGrid.visible=true, controls 三个子开关全为 false
- 视角保留：修改透视相机位置 → `switchViewMode('front')` → `switchViewMode('perspective')` → 验证相机位置与修改后一致，未被重置

---

## Task 5: 实现相机运动检测渲染触发 → verify: 测试通过

**What:**

> **禁止**使用 `if (this.dirty || this.orbitControls.enabled)` —— 透视视图下 `controls.enabled` 始终为 true，会导致脏标记机制完全失效，空闲状态满帧渲染。

**正确方案 —— 相机运动差值检测：**

- 新增两个 `Vector3` 字段：`lastCamPos = new THREE.Vector3()`、`lastCamTarget = new THREE.Vector3()`
- **初始化时机**：引擎初始化后、`switchViewMode()` 切换相机后、`reset()` 重置后，主动将当前 `activeCamera.position` 和 `controls.target` 写入缓存字段，保证首帧检测基准正确
- `startLoop()` 渲染循环中：
  1. 若 `controls.enabled` 为 true，在 `controls.update()` 之前记录当前相机位置和目标
  2. 执行 `controls.update()`
  3. 比较 update 前后的相机位置/目标差值（`distanceToSquared > 1e-6`），若有变化则置 `dirty = true`
  4. `dirty` 为 true 时执行渲染并清除标记

- 效果：
  - 用户拖拽旋转/缩放：`controls.update()` 产生位移 → dirty=true → 渲染
  - 阻尼惯性运动：每帧相机位置仍在变化 → 持续渲染，动画流畅
  - 阻尼完全停止：相机位置不再变化 → dirty 保持 false → 停止渲染，CPU 归零
  - 参数变更（滑块等）：直接置 dirty=true → 渲染一帧
  - 正面视图（controls.enabled=false）：跳过运动检测，纯靠 dirty 标记驱动

**Test:**
- 验证运动检测字段初始存在
- 验证 controls 运动后 dirty 被置为 true（模拟 camera 位移）

---

## Task 6: 增强 reset() 方法 → verify: 测试通过

**What:**

reset() 仅重置当前视图下的相机与光照参数，**不改变 viewMode 与 activeCamera**。视图切换由顶部「透视/正面」按钮独立控制，重置按钮不涉及模式变更。

若当前为透视视图：重置透视相机 → (-3, 2, 12)，controls.target → (0,0,0)
若当前为正面视图：重置正交相机 → (0, 0, 14)
光照参数全量重置（与视图无关）：position → (0,0,6)、brightness → 50、kelvin → 5600、rimLight → false
`controls.update()` 立即生效

**Test:**
- 透视视图下修改相机位置和 target 后调用 reset()，验证透视相机回到 (-3,2,12)，target 回到 (0,0,0)，viewMode 仍为 'perspective'
- 正面视图下调用 reset()，验证正交相机回到 (0,0,14)，viewMode 仍为 'front'

---

## Task 7: 浏览器集成验证 → verify: 视觉确认

### 透视视图功能

1. 打开 Canvas → 图片节点 → 点击「打光」→ 弹窗默认**正面视图**
2. 点击「透视」→ 斜透视效果，XZ 地面网格近大远小，图片垂直立于地面
3. 鼠标旋转/缩放 → OrbitControls 流畅响应
4. 拖拽光源手柄 → 场景不旋转，光源移动准确，边界约束生效
5. 松手后 → OrbitControls 恢复，阻尼惯性动画流畅，停止后 CPU 归零
6. 滚轮缩放 → 范围 8-20 单位
7. 旋转视角后 → 切正面再切回透视 → 视角保留
8. 透视视图下，旋转视角后点击「重置」→ 视角恢复默认 (-3,2,12)，target=(0,0,0)，**仍保持透视视图不跳回正面**
9. 连续切换 20 次 → 无闪烁、无 WebGL 报错

### 正面视图回归

10. 切换回正面视图 → XY 网格恢复显示
11. 光源拖拽、亮度/色温滑块、轮廓光开关、缩略图 → 所有功能与验收前完全一致
12. 正面视图下鼠标操作不触发任何相机旋转/缩放/平移

### 参数一致性

13. 两种视图间光源位置、亮度、色温、轮廓光状态完全一致（共享同一光源实例）

---

## 不做

- 不创建 5 条发散光束线（推迟后续迭代）
- 不创建弧形轨道辅助环（推迟后续迭代）
- 不修改 LightingModal、ControlPanel、ThreePreview、useLightingEngine
- 不修改后端任何代码
