// apps/web/src/stores/geometryTrap.ts
// C0-2 dev-only cs 几何写陷阱骨架（Spec B）：基于 useCanvasStore.subscribe 的节点几何 diff
// （position/width/height 三键），非允许写者变更即违例。
//
// 三模式表（头部收拢写实）：
//   - DEV（import.meta.env.DEV，非 vitest）：enableGeometryTrap() 后=抛"首个越权写者"。
//     未 enable=不装订阅（O0b-8 接线点=应用 bootstrap 显式 enable 进 DEV 抛模式——接线前
//     保持未装，防写者上下文缺位窗口期全画布误抛）。
//   - vitest（import.meta.env.MODE==='test'）：默认禁用；enableGeometryTrap() 显式开启造案
//     （行为同 DEV 抛——守卫测试经此固化路径）。
//   - prod（import.meta.env.PROD）：模块导入即装+计数，降级为计数+采样日志、永不 throw
//     （按字面 throw 会白屏——禁止）。采样口径：前 3 条全记、其后每 100 条记 1 条。
//
// 性能契约：按节点对象身份 diff（ref 不等才比三键；数组同引用早退）——禁每次全表深比。
// 辖域：只对 position/width/height 抛；selected/dragging/dimensions 标记变更放行；
// dimensions（RF setAttributes=true 写 node.width/height）按写者上下文放行非按字段放行——
// 合法写者类别 'dimensions-attribute'（O0b-6 在 reconcile 内按变更类型细分挂点）。
// 作用域：生产源码（apps/web/src，*.test.*/*.spec.* 与 test/ 目录天然不经生产链路）。
// 本片不接线生产链路（挂点=geometryTrap.test.ts 的 it.todo；唯一接线=守卫测试内造案）。
import type { Node } from '@xyflow/react';
import { GEOMETRY_WRITER_CATEGORIES, type GeometryWriterCategory } from '@flowweb/shared';
import { useCanvasStore } from './canvasStore';

type TrapMode = 'dev' | 'vitest' | 'prod';

function resolveMode(): TrapMode {
  if (import.meta.env?.MODE === 'test') return 'vitest';
  return import.meta.env?.PROD ? 'prod' : 'dev';
}

/** 节点几何快照：三键值 + 对象引用（身份 diff 基座）。 */
interface NodeGeomSnapshot {
  x: number | undefined;
  y: number | undefined;
  width: number | undefined;
  height: number | undefined;
  ref: Node;
}

let installed = false;
let unsubscribe: (() => void) | null = null;
let snapshot = new Map<string, NodeGeomSnapshot>();
let lastNodesRef: readonly Node[] | null = null;
/** 模块级写者上下文（reconcile/手势内核/投影结构默认/配置型命令体前写/夹具入口各自 set）。 */
let currentGeometryWriter: GeometryWriterCategory | null = null;
let violationCount = 0;
let sampledLogs = 0;

const snapOf = (n: Node): NodeGeomSnapshot => ({
  x: n.position?.x,
  y: n.position?.y,
  width: n.width,
  height: n.height,
  ref: n,
});

function handleViolation(nodeId: string, field: string): void {
  if (currentGeometryWriter != null) return; // 合法写者上下文——放行（registry 类别已过 setGeometryWriter 校验）
  violationCount += 1;
  const detail =
    `[geometryTrap] 首个越权写者：节点 ${nodeId} 的 ${field} 变更（无写者上下文）` +
    `——几何三键（position/width/height）变更须在写者上下文内（setGeometryWriter/withGeometryWriter/夹具入口 test/fixtures/canvas）`;
  if (resolveMode() === 'prod') {
    // prod 降级：计数+采样日志，永不 throw（字面实现会白屏——禁止）
    if (sampledLogs < 3 || violationCount % 100 === 0) {
      sampledLogs += 1;
      console.error(detail);
    }
    return;
  }
  throw new Error(detail);
}

function diffNodes(nodes: readonly Node[]): void {
  if (nodes === lastNodesRef) return; // 数组同引用早退
  lastNodesRef = nodes;
  for (const node of nodes) {
    const prev = snapshot.get(node.id);
    if (prev && prev.ref === node) continue; // 身份 diff——零深比
    if (!prev) {
      // 新节点：append 即几何写（信封携 position）
      snapshot.set(node.id, snapOf(node));
      handleViolation(node.id, 'position(新增节点)');
      continue;
    }
    const posChanged = prev.x !== node.position?.x || prev.y !== node.position?.y;
    const whChanged = prev.width !== node.width || prev.height !== node.height;
    if (posChanged) handleViolation(node.id, 'position');
    if (whChanged) handleViolation(node.id, 'width/height');
    snapshot.set(node.id, snapOf(node));
  }
  // 删除：快照收缩（删除非字段写——不违例）。filter 重建而非"遍历 keys+同基座 delete"——
  // 后者形状被静态断言 D 拦截（零删除扫描；此处语义=本地快照收缩，形状仍避开）
  if (snapshot.size > nodes.length) {
    const keep = new Set(nodes.map((n) => n.id));
    snapshot = new Map([...snapshot].filter(([id]) => keep.has(id)));
  }
}

/** 显式开启陷阱（订阅装一次，重复调用幂等）。vitest 造案/DEV 抛模式进入点（O0b-8 bootstrap 接线）。 */
export function enableGeometryTrap(): void {
  if (installed) return; // 订阅不可重复装
  installed = true;
  const nodes = useCanvasStore.getState().nodes;
  snapshot = new Map(nodes.map((n) => [n.id, snapOf(n)]));
  lastNodesRef = nodes;
  unsubscribe = useCanvasStore.subscribe((state) => {
    diffNodes(state.nodes);
  });
}

/** 拆除陷阱（订阅移除+快照/上下文清空；计数保留累积）。 */
export function disableGeometryTrap(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
  snapshot = new Map();
  lastNodesRef = null;
  currentGeometryWriter = null;
}

/** 标写者上下文（null=清空）。非 registry 类别名当场拒（枚举封闭）。 */
export function setGeometryWriter(name: GeometryWriterCategory | null): void {
  if (name != null && !GEOMETRY_WRITER_CATEGORIES.includes(name)) {
    throw new Error(`[geometryTrap] 未登记写者类别：${name}（合法值=geometryWriterRegistry GEOMETRY_WRITER_CATEGORIES）`);
  }
  currentGeometryWriter = name;
}

/** 作用域式写者上下文：fn 内几何写归 name 名下，退出（含异常）恢复进入前值。 */
export function withGeometryWriter<T>(name: GeometryWriterCategory, fn: () => T): T {
  const prev = currentGeometryWriter;
  setGeometryWriter(name);
  try {
    return fn();
  } finally {
    currentGeometryWriter = prev;
  }
}

/** prod 计数载体（违例累计数——计数载体后续分片接 log 面）。 */
export function getGeometryViolationCount(): number {
  return violationCount;
}

export function isGeometryTrapEnabled(): boolean {
  return installed;
}

// 生产构建默认启用（计数+采样日志模式）；vitest/DEV 不自装（见头注三模式表）。
if (resolveMode() === 'prod') enableGeometryTrap();
