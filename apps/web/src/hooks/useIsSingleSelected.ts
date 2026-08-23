import { useStore } from '@xyflow/react';

/**
 * 响应式单选判定。命令式 getNodes() 计数在"先选 A 再加选 B"时，
 * A 的 selected prop true→true 不触发重渲染，工具条残留（Bug A 残留根源）。
 * selector 返回 number，天然相等比较；for 循环避免拖拽每帧的中间数组分配。
 */
export function useIsSingleSelected(selected: boolean | undefined): boolean {
  const selectedCount = useStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].selected) count++;
    return count;
  });
  return !!selected && selectedCount === 1;
}
