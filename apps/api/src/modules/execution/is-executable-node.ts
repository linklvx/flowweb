// Y0b-1：export——pricing-input.util 的 NODE_TYPE_KEY_MAP 命名空间映射断言（白名单 ⊆ dom(map)）消费同一集合
export const EXECUTABLE_TYPES = new Set(['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen']);

/** 白名单真正生效场景：全部执行 / nodeIds 批量执行（单节点 getScope 只收上游，产物边方向 剪辑→产物） */
export function isExecutableNode(node: { id?: string; type: string; data?: Record<string, unknown> | null }): boolean {
  if (!EXECUTABLE_TYPES.has(node.type)) return false;
  if ((node.data as any)?.origin === 'video-edit') return false; // 导出产物节点：无 model，跳过防误重跑扣费
  return true;
}
