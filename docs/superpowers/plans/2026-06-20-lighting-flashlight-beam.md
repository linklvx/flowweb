<!-- doc-status: historical | verified_at: n/a -->
# Plan: 打光预览手电筒锥形光束

## Context

打光页面 3D 预览区当前仅有两个视觉辅助：黑色球体（光源位置）和白线（指向图片中心）。用户无法直观感知光源的照射方向和扩散范围。本计划基于已确认的 Spec (`2026-06-20-lighting-flashlight-beam.md`) 实现锥形光束可视化辅助体。

## 变更文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/pages/canvas/engine/LightingEngine.ts` | 修改：新增 1 个属性、2 个方法、5 处逻辑插入 |
| `apps/web/src/pages/canvas/engine/LightingEngine.test.ts` | 修改：新增 1 个 describe 块，约 14 个测试 |

---

## LightingEngine.ts 变更明细

### 1. 属性声明（第 27 行后新增）

```typescript
private lightCone!: THREE.Mesh;
```

### 2. initLight() 末尾（第 162 行后）新增调用

```typescript
this.initLightCone();
```

### 3. 新增 initLightCone() 方法

创建几何体（旋转 + 平移）、ShaderMaterial、Mesh，add 到 scene，首帧同步：

```typescript
private initLightCone() {
  // 几何体三步变换
  const geo = new THREE.ConeGeometry(Math.tan(Math.PI / 12), 1, 16, 1, true);
  geo.rotateX(-Math.PI / 2);
  geo.translateZ(0.5);

  // ShaderMaterial
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uMaxAlpha: { value: 0.35 },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uMaxAlpha;
      varying vec3 vLocalPos;
      void main() {
        float alpha = uMaxAlpha * (1.0 - vLocalPos.z);
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  this.lightCone = new THREE.Mesh(geo, mat);
  this.lightCone.renderOrder = 1;        // 光束在网格后、手柄前
  this.lightHandle.renderOrder = 2;      // 手柄在最上层，不被光束遮挡
  this.scene.add(this.lightCone);

  // 首帧同步
  this.updateConeTransform();
}
```

### 4. 新增 updateConeTransform() 方法

```typescript
private updateConeTransform() {
  if (!this.lightCone) return;
  const pos = this.light.position;
  this.lightCone.position.copy(pos);
  this.lightCone.lookAt(0, 0, 0);
  const d = pos.length();
  this.lightCone.scale.set(d, d, d);
}
```

### 5. setPosition() — 插入更新调用（第 416 行后）

在 `this.lightHandle.position.set(x, y, z);` 之后插入：

```typescript
this.updateConeTransform();
```

### 6. setBrightness() — 插入透明度联动（第 424 行后）

```typescript
if (this.lightCone) {
  (this.lightCone.material as THREE.ShaderMaterial).uniforms.uMaxAlpha.value =
    (this.brightness / 100) * 0.7;
}
```

### 7. setColorTemperature() — 插入颜色联动（第 431 行后）

```typescript
if (this.lightCone) {
  (this.lightCone.material as THREE.ShaderMaterial).uniforms.uColor.value.setRGB(r, g, b);
}
```

### 8. renderThumbnail() — 隐藏/恢复光束（第 356-362 行扩展）

在第 357 行后插入 `this.lightCone.visible = false;`，第 361 行后插入 `this.lightCone.visible = true;`

### 9. dispose() — 无需改动

`scene.traverse` 已通过 `instanceof THREE.Mesh` 覆盖 lightCone 的几何体和材质清理。

---

## LightingEngine.test.ts 变更明细

### Mock 策略

使用现有混合 mock 策略：核心 `three` 模块部分 mock（仅 `WebGLRenderer` 替换），`ShaderMaterial` 使用真实 Three.js 实例，通过 `(engine as any).lightCone` 访问私有属性。

### 新增 describe 块：

```typescript
describe('light cone beam', () => {
  // 1. 创建：引擎实例化后 lightCone 存在，是 Mesh
  // 2. 几何体变换：ConeGeometry 已正确旋转、平移
  // 3. 材质配置：ShaderMaterial, AdditiveBlending, DoubleSide, depthWrite=false
  // 4. renderOrder：光束=1，手柄=2
  // 5. 首帧位置：lightCone.position 对齐 light.position
  // 6. setPosition 联动：调用后 lightCone.position 更新
  // 7. 缩放联动：距离变化后 lightCone.scale 正确
  // 8. setBrightness 联动：uMaxAlpha 同步
  // 9. setColorTemperature 联动：uColor 同步
  // 10. reset 联动：通过 setPosition/setBrightness/setColorTemperature 自动覆盖
  // 11. 缩略图隐藏：renderThumbnail 期间 visible=false
  // 12. dispose 清理：geometry/material 已 dispose
  // 13. 渲染顺序：lightCone.renderOrder < lightHandle.renderOrder
  // 14. reset 链路：调用 reset 后光束颜色、透明度、位置恢复默认值
})
```

---

## 实施步骤

1. **Red** — 先写测试（预计 12 个用例），预期全部 FAIL
2. **Green** — 逐一实现 LightingEngine.ts 变更，跑测试通过
3. **Refactor** — 检查代码简洁性、对齐现有模式
4. **Verify** — 启动 dev server，浏览器打开打光页面验证视觉效果

## 验证

1. `pnpm --filter web test` — 确保所有测试通过
2. `preview_start` 启动 dev server，打开打光弹窗
3. 目视验证：锥形光束从黑球指向图片中心，渐变正确
4. 交互验证：拖拽手柄、切换预设、调节色温/亮度，光束实时跟随
5. 缩略图验证：右上角缩略图不含光束
