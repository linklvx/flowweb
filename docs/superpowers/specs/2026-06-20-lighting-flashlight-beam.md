<!-- doc-status: historical | verified_at: n/a -->
# Spec: 打光预览手电筒锥形光束

## 概述

为打光页面 3D 预览区的光源手柄（黑球）添加锥形光束可视化辅助体，让用户直观感知光源的照射方向和扩散范围。

## 现状

- `LightingEngine.ts` 已有两个视觉辅助：`lightHandle`（黑球，光源位置）+ `lightLine`（白线，光源→图片中心连线）
- 光源类型为 `THREE.PointLight`，无方向性，无照射范围可视化
- 已有 spec（`2026-06-20-lighting-perspective-view.md`）将"5 条发散光束线"标记为推迟项，本 spec 用锥形光束替代该方案
- 现有脏标记渲染模式、thumbnail 隐藏逻辑、dispose 清理流程需要同步扩展

## 核心设计决策

1. **圆锥几何体 + 渐变透明 + 加法混合** — 标准 Three.js 聚光灯可视化方案，单 Mesh，零额外贴图
2. **单位高度锥体 + uniform 缩放** — 创建 height=1 的基准锥体，距离变化时 uniform scale（scale.set(d, d, d)），无销毁重建开销
3. **作为 LightingEngine 内部辅助对象** — 不独立成类，直接扩展 `LightingEngine.ts`，与 `lightHandle`/`lightLine` 同级管理
4. **纯视觉标识，不参与光照计算** — 光束只辅助判断方向/范围，真实打光仍由 `PointLight` 控制
5. **光束颜色/透明度与打光参数联动** — 色温变化时同步光束颜色，亮度变化时同步光束最大透明度

---

## 功能需求

### 光束形态

- 光束呈锥形：顶点位于光源黑球位置，底面覆盖图片平面光照区域
- **扩散角：全角 30°**，半角 = 15° = `Math.PI / 12`，底面半径计算公式：
  ```
  radius = distance * Math.tan(Math.PI / 12)  // 半角计算
  ```
- 使用 `THREE.ConeGeometry`，`openEnded: true`（无底面），分段数 16
- 锥体方向始终指向图片中心（世界坐标原点 `(0, 0, 0)`）
- **采用单位高度锥体方案**：初始创建 height=1、radius=tan(PI/12) 的锥体，距离变化时执行 `lightCone.scale.set(d, d, d)` 统一缩放，无需销毁重建

### 几何体变换（关键：尖端对齐光源、底面朝向图片）

ConeGeometry 默认尖端在 +Y、底面在 -Y，几何中心在高度中点。需三步变换：

```typescript
// 1. 创建单位高度锥体
const geo = new THREE.ConeGeometry(Math.tan(Math.PI / 12), 1, 16, 1, true);
// 2. 绕X轴旋转-90°：尖端从+Y 转向 -Z，底面从-Y 转向 +Z
geo.rotateX(-Math.PI / 2);
// 3. 沿Z轴平移0.5：尖端从局部Z=-0.5 移到 Z=0，底面从Z=+0.5 移到 Z=+1
geo.translateZ(0.5);
```

变换后局部坐标系：

| 位置 | 变换后局部坐标 |
|------|---------------|
| 尖端（光源端） | (0, 0, 0) — 对齐 mesh.position |
| 底面（图片端） | (0, 0, +1) — 向 +Z 延伸 1 单位 |

`lightCone.lookAt(0, 0, 0)` 后：mesh 的 +Z 轴指向图片中心，底面朝向图片、尖端留在光源位置，光束从光源向图片扩散。

### 光束材质

- `ShaderMaterial`，光束颜色由 uniform `uColor` 控制
- 透明度沿锥体纵向渐变（局部坐标 position.z 范围 [0, 1]）：
  - 尖端 z=0 → alpha = uMaxAlpha（近亮）
  - 底面 z=1 → alpha = 0（远淡）
- 片元着色器：`alpha = uMaxAlpha * (1.0 - position.z)`
- `side: THREE.DoubleSide`，双面渲染，避免相机进入锥体内部时因背面剔除导致光束消失
- `blending: THREE.AdditiveBlending`，加法混合呈现发光感
- `depthWrite: false`，不遮挡场景其他物体
- `transparent: true`

### Shader 代码

```glsl
// 顶点着色器
varying vec3 vLocalPos;
void main() {
  vLocalPos = position;  // 几何体局部坐标，z∈[0,1]
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// 片元着色器
uniform vec3 uColor;
uniform float uMaxAlpha;
varying vec3 vLocalPos;
void main() {
  float alpha = uMaxAlpha * (1.0 - vLocalPos.z);  // 尖端(z=0)亮 → 底面(z=1)暗
  gl_FragColor = vec4(uColor, alpha);
}
```

无需 uHeight/uHalfHeight uniform — 单位高度锥体中 z 坐标天然在 [0, 1] 范围内。

### ShaderMaterial uniforms 结构

```typescript
uniforms: {
  uColor: { value: new THREE.Color(1, 1, 1) },   // 初始白色，色温变化时更新
  uMaxAlpha: { value: 0.35 },                      // 初始对应 brightness=50
}
```

### 参数联动

- **色温联动**：`setColorTemperature()` 调用时，同步更新 `uColor` uniform 为 kelvinToRgb 结果
- **亮度联动**：`setBrightness()` 调用时，同步更新 `uMaxAlpha` uniform：brightness 0 → 0，brightness 100 → 0.7
- 联动无需额外 dirty 标记（setColorTemperature / setBrightness 已设置 `this.dirty = true`）

### 光束同步

- `setPosition()` 调用时同步更新：锥体 position、lookAt 目标、uniform scale
- `updateConeTransform(lightPos)` 封装方法：
  1. `this.lightCone.position.copy(lightPos)`
  2. `this.lightCone.lookAt(0, 0, 0)`
  3. `this.lightCone.scale.set(d, d, d)`（其中 `d = lightPos.distanceTo(origin)`）
- 光源预设按钮点击时同步更新
- `reset()` 时同步更新 — 无需单独编写光束重置逻辑，reset() 内部调用 setPosition/setBrightness/setColorTemperature 即可自动联动更新光束
- Z 轴距离 < 2 时不做额外裁剪，光束按实际距离缩放，允许底面超出图片范围

### 渲染层级

- **renderOrder 从小到大**：网格 → 图片平面 → **光束** → 光源手柄
  - Three.js 中 renderOrder 数值越大越晚渲染，越在上面
  - 光束 renderOrder < lightHandle.renderOrder，保证黑色手柄始终显示在光束前方
  - 默认 renderOrder 为 0，网格和图片平面保持默认
  - 光束 renderOrder = 1，手柄 renderOrder = 2

### 缩略图隐藏

与现有 `lightHandle`/`lightLine` 方式一致：缩略图渲染前临时设置 `this.lightCone.visible = false`，渲染完成后恢复 `true`。

### 生命周期

- `LightingEngine` 构造函数中调用 `this.initLightCone()` 创建光束 Mesh
- `initLightCone()` 内部创建几何体/材质/Mesh 后，立即调用 `updateConeTransform(lightPos)` 同步初始光源位置，保证首帧光束朝向、缩放正确
- `dispose()` 中场景遍历已覆盖 Mesh 的几何体/材质清理，ShaderMaterial 的 GPU 资源由 Three.js 自动回收

---

## 变更范围

| 文件 | 变更类型 |
|------|----------|
| `apps/web/src/pages/canvas/engine/LightingEngine.ts` | 修改：新增光束属性、创建方法、更新方法、联动逻辑 |
| `apps/web/src/pages/canvas/engine/LightingEngine.test.ts` | 修改：新增光束相关测试 |

---

## 验收标准

- [ ] 打开打光弹窗时，光源手柄前方显示锥形光束，尖端对齐黑球、底面指向图片中心
- [ ] 光束呈现尖端亮→底面淡的渐变效果，不遮挡图片内容
- [ ] 拖拽光源手柄（XY 平面）时，光束实时跟随
- [ ] 调节色温滑块时，光束颜色同步变化
- [ ] 调节亮度滑块时，光束最大透明度同步变化
- [ ] 点击光源预设按钮时，光束正确更新
- [ ] 点击重置按钮时，光束恢复默认状态
- [ ] 切换正视图/透视图时，光束正常显示
- [ ] 缩略图预览中不包含光束（visible=false）
- [ ] 关闭打光弹窗后无内存泄漏
- [ ] 渐变方向正确：尖端（光源端）亮，底面（图片端）暗，不可反向
- [ ] Z 轴距离变化时，光束 uniform scale 正确更新，扩散角保持不变
- [ ] Z 轴距离 < 2 时，光束不做裁剪，按实际距离正常显示
