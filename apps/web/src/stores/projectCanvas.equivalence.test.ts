// apps/web/src/stores/projectCanvas.equivalence.test.ts
// Y2 第①步（A1 骨架）：projectCanvas 等价域对拍+墓碑用例——唯一宿主（projectCanvas 在 apps/web，
// packages/shared 无法反向 import；A2a 实现后红测条目落位转绿）。
// 等价域定义（spec D1）：gesture/runtime/mediaFacts/localPreview 皆空 + liveFrame 不传时，
// projectCanvas 的节点几何/parent/hidden 剔除/边集与 deriveRenderCanvas 逐位相等——
// 禁手写第二套帧算法（反目标 2）。
// 墓碑（spec D1 装配序步 1）：活动墓碑节点在进内核之前剔除——死节点不进 auto 组帧（组 origin
// 不受死节点影响）、不进 cellNodes；谓词=现有 isActiveTombstone（不重写）。
// 分镜子被 hidden 剔除时 cellNodes 仍有内容——格子覆盖按格子 id 回到剔除前作者记录取值
// （A2a Step 2 实现当步真红）。
import { describe, it } from 'vitest';

describe('Y2 等价域：projectCanvas ≡ deriveRenderCanvas（空覆盖逐位对拍）', () => {
  it.skip('空覆盖下节点几何/parent/hidden 剔除/边集逐位相等（A2a 落位）', () => {});
  it.skip('liveFrame 不传形态：公开页同参直调 deriveRenderCanvas 与 projectCanvas 空覆盖输出一致（A2a 落位）', () => {});
});

describe('Y2 墓碑：前置剔除（进内核之前）', () => {
  it.skip('活动墓碑节点不进 auto 组帧——组 origin 不受死节点影响（A2a 落位）', () => {});
  it.skip('活动墓碑节点不进 cellNodes（A2a 落位）', () => {});
  it.skip('分镜子被 hidden 剔除时 cellNodes 仍有内容——格子覆盖回剔除前作者记录（A2a 落位）', () => {});
});
