import { useStore } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 响应式单选判定。命令式 getNodes() 计数在"先选 A 再加选 B"时，
 * A 的 selected prop true→true 不触发重渲染，工具条残留（Bug A 残留根源）。
 * selector 返回 number，天然相等比较；for 循环避免拖拽每帧的中间数组分配。
 *
 * lastPointerShiftKey（最近一次画布内主键 pointerdown 的 shiftKey）抑制
 * Shift 多选操作中的 count===1 中间态工具条误弹；必须是订阅读取——
 * 「Shift+点节点 → 普通再点同节点」时 React Flow 选中态可能不变，
 * 恢复弹出仅由 flag 变化触发。
 */
export function useIsSingleSelected(selected: boolean | undefined): boolean {
  const selectedCount = useStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].selected) count++;
    return count;
  });
  const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);
  return !!selected && selectedCount === 1 && !lastPointerShiftKey;
}
