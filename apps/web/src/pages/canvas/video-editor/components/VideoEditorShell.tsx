import { useRef } from 'react';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { EditorTopBar } from './EditorTopBar';
import { PreviewPlaceholder } from './PreviewPlaceholder';
import { TimelinePanel } from './timeline/TimelinePanel';

export function VideoEditorShell() {
  const open = useVideoEditorStore((s) => s.open);
  const close = useVideoEditorStore((s) => s.close);
  // 焦点移入壳内：编辑器打开后 Delete/Backspace 的事件目标落在 nokey 壳内，
  // xyflow isInputDOMNode（target.closest('.nokey')）命中 → 不再删除画布选中节点
  const focusRef = useRef<HTMLDivElement>(null);
  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={close} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      <div data-testid="video-editor-shell" ref={focusRef} tabIndex={-1}
        className="fixed inset-0 bg-[#F7F8FA] flex flex-col box-border nokey">
        <EditorTopBar />
        <div className="flex flex-1 min-h-0">
          {/* 左面板（Task 16 实化） */}
          <div className="w-[260px] border-r border-[#E5E7EB] [border-right-style:solid] bg-white"
            data-testid="asset-panel-placeholder">
            <span className="text-[12px] text-[#86909C] p-3 inline-block">资产库（Task 16）</span>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <PreviewPlaceholder />
            <TimelinePanel />
          </div>
          {/* 右面板（Plan 3 四态） */}
          <div className="w-[280px] border-l border-[#E5E7EB] [border-left-style:solid] bg-white">
            <span className="text-[12px] text-[#86909C] p-3 inline-block">属性面板（Plan 3）</span>
          </div>
        </div>
      </div>
    </BaseFullscreenModal>
  );
}
