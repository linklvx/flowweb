// apps/web/src/test/fixtures/canvas.ts
// C0-2 单一夹具入口（Spec B）：测试的几何 setState 一律从这进——seedCanvas 在 'fixture'
// 写者上下文内落 store，不触发 geometryTrap。makeGroup/makeChild=纯构造零 store 写
// （无需写者上下文）。测试禁再手写几何 useCanvasStore.setState（静态棘轮守新文件，
// geometryTrap.test.ts 锚③报数单调下降）。
import type { Edge, Node } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { withGeometryWriter } from '@/stores/geometryTrap';

export interface MakeChildOverrides {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  parentId?: string;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
}

/** 纯构造子节点信封（零 store 写）。 */
export function makeChild(o: MakeChildOverrides): Node {
  return {
    id: o.id,
    type: o.type ?? 'imageGen',
    position: o.position ?? { x: 0, y: 0 },
    ...(o.parentId != null ? { parentId: o.parentId, extent: 'parent' as const } : {}),
    ...(o.width != null ? { width: o.width } : {}),
    ...(o.height != null ? { height: o.height } : {}),
    data: o.data ?? {},
  } as Node;
}

/** 纯构造组节点信封（零 store 写）。 */
export function makeGroup(o: MakeChildOverrides & { groupType?: string }): Node {
  return {
    id: o.id,
    type: 'group',
    position: o.position ?? { x: 0, y: 0 },
    ...(o.width != null ? { width: o.width } : {}),
    ...(o.height != null ? { height: o.height } : {}),
    data: { groupType: o.groupType ?? 'normal', ...(o.data ?? {}) },
  } as Node;
}

/** 整画布注入（'fixture' 写者上下文内 setState——陷阱放行面）。 */
export function seedCanvas(nodes: Node[], edges?: Edge[]): void {
  withGeometryWriter('fixture', () => {
    useCanvasStore.setState({ nodes, edges: edges ?? [], selectedId: null });
  });
}

/** rw 漏斗窗口（canEdit 真——hydration ready+非 readOnly+无 terminal）。O0b-2 新增测试基建单点：
 *  测试文件直接 useCanvasStore.setState 会撞文件级棘轮 allow-list（lint-gate/geometryTrap 锚③）——
 *  会话窗口开启从本入口进（本文件不在 test/spec 扫描面；hydration 经 setHydration action——
 *  hydration 单写者静态断言对生产源扫描含本文件）。 */
export function openRwWindow(): void {
  withGeometryWriter('fixture', () => {
    useCanvasStore.getState().setHydration('ready');
    useCanvasStore.setState({ collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
  });
}

/** 会话几何复位（测试 afterEach 单点——同上零直接 setState）。 */
export function resetCanvasStores(): void {
  withGeometryWriter('fixture', () => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
  });
  useNodeStore.setState({ nodes: {} as never });
}
