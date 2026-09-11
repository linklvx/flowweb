import { useEditorStore } from '../store/editorStore';

const SAVE_DOT: Record<string, { color: string; title: string }> = {
  saved: { color: '#00B42A', title: '已保存' },
  saving: { color: 'var(--ve-text-dim)', title: '保存中…' },
  error: { color: '#F53F3F', title: '保存失败，点击重试' },
};

/** onClose 由 Shell 传入（handleClose——flush 排空后关闭，M1 检查点：收起不可绕过 flush）；onManualRetry 接 autosave flush；onExport 开导出弹层 */
export function EditorTopBar({ onClose, onManualRetry, onExport }: { onClose: () => void; onManualRetry?: () => void; onExport?: () => void }) {
  const saveState = useEditorStore((s) => s.saveState);
  const dot = SAVE_DOT[saveState];
  return (
    <div data-testid="editor-top-bar"
      className="h-12 flex items-center gap-4 px-4 bg-[var(--ve-panel)] border-b border-[var(--ve-border)] [border-bottom-style:solid] box-border">
      <span className="text-[15px] font-medium text-[var(--ve-text)]">多轨剪辑</span>
      <button type="button" title={dot.title} onClick={onManualRetry}
        className="w-2.5 h-2.5 rounded-full border-0 cursor-pointer"
        style={{ background: dot.color }} data-testid="save-state-dot" />
      <span className="text-[12px] text-[var(--ve-text-dim)]">16:9</span>
      <div className="ml-auto flex items-center gap-3">
        <button type="button" onClick={onExport}
          className="text-[14px] text-white bg-[var(--ve-accent)] rounded-full px-4 py-1.5 border-0">
          导出
        </button>
        <button type="button" onClick={onClose}
          className="text-[14px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-2 py-1">
          收起
        </button>
      </div>
    </div>
  );
}
