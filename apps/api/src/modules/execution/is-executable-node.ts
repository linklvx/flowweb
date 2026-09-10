const EXECUTABLE_TYPES = new Set(['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen']);

/** 白名单真正生效场景：全部执行 / nodeIds 批量执行（单节点 getScope 只收上游，产物边方向 剪辑→产物） */
export function isExecutableNode(node: { id?: string; type: string; data?: Record<string, unknown> | null }): boolean {
  if (!EXECUTABLE_TYPES.has(node.type)) return false;
  if ((node.data as any)?.origin === 'video-edit') return false; // 导出产物节点：无 model，跳过防误重跑扣费
  if ((node.data as any)?.__ephemeral === true) return false; // A1 影子残留兜底：影子是临时克隆（regenerate 专用、由前端 done 回流后删除），任何执行路径都不该扫到——防客户端崩溃残留后的幽灵执行扣费（regenerate 直调路径在 execution.service 的白名单行单独放行）
  return true;
}
