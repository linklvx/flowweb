import { useEffect, type RefObject } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 采样「最近一次画布内主键 pointerdown 的 shiftKey」到 canvasStore.lastPointerShiftKey，
 * 供 useIsSingleSelected / selectedGroup 抑制 Shift 多选操作中的工具条误弹。
 *
 * - capture 阶段绑 wrapper（组件自身根 div，ref 必然存在），先于 React Flow d3-drag 写入；
 * - 运行时以 closest('.react-flow') 判定归属：node-toolbar-portal 挂在 .react-flow 外、
 *   wrapper 内（CanvasView.tsx:510-514），工具条按钮点击不更新 flag；
 * - 排除不改选中的画布控件（MiniMap / CanvasToolbar）；
 * - 仅主键（button 0）：右键/中键不改选中。
 */
export function useTrackCanvasPointerShift(wrapperRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      // Element（含 SVGElement）：节点标题图标/波形等 SVG 目标也需采样；
      // 仅排除文本节点等非 Element 目标
      if (!(target instanceof Element)) return;
      if (!target.closest('.react-flow')) return;
      if (target.closest('.react-flow__minimap, #canvas-toolbar')) return;
      useCanvasStore.setState({ lastPointerShiftKey: e.shiftKey });
    };
    wrapper.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => wrapper.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [wrapperRef]);
}
