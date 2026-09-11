import { useEditorStore } from '../../store/editorStore';
import { timeToPx } from '../../timeline/view-scale';

/** 贯穿播放头竖线（自订阅——30fps 播放头更新不重渲轨道行，决策 14/M4；R4 无 props 化：删除未被使用的滚动内容宽计算） */
export function PlayheadLine() {
  const playhead = useEditorStore(s => s.playhead);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  return (
    <div data-testid="playhead-line" className="absolute top-0 bottom-0 w-0.5 bg-[#6C5CE7] pointer-events-none z-10"
      style={{ left: 140 + timeToPx(playhead, pxPerSec) }} />
  );
}
