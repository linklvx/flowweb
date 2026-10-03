// apps/web/src/utils/groupDerive.ts
import { groupHidesChildren } from '@flowweb/shared';

/** hidden 推导规则单一来源（spec 3.3）：不持久化，每次全量推导；hidden 判定同引 shared
 *  groupHidesChildren（19(i) 防漂移）。O0b-4 并入 reconcile 单内核（终裁 54④）——本模块只
 *  提供"node id → hidden"推导图+边判定（数据域纯函数），cs 写者唯一=reconcileGroupGeometry
 *  （同值保引用/undefined≡false 免写在写侧，不在这层做对象拷贝）。 */
export function deriveHiddenMap(
  nodes: ReadonlyArray<{ id: string; parentId?: string | null; type?: string; data?: unknown }>,
): Map<string, boolean> {
  const groupHidden = new Map<string, boolean>();
  for (const n of nodes) {
    if (n.type === 'group') {
      groupHidden.set(n.id, groupHidesChildren((n.data ?? {}) as Record<string, unknown>));
    }
  }
  const out = new Map<string, boolean>();
  for (const n of nodes) {
    out.set(n.id, n.parentId ? (groupHidden.get(n.parentId) ?? false) : false);
  }
  return out;
}

/** 边 hidden：任一端节点 hidden ⇒ 边 hidden（推导图消费面）。 */
export function edgeHidden(
  e: { source: string; target: string },
  nodeHidden: ReadonlyMap<string, boolean>,
): boolean {
  return (nodeHidden.get(e.source) ?? false) || (nodeHidden.get(e.target) ?? false);
}
