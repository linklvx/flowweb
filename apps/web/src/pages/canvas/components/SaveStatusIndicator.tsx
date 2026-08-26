import { useCanvasStore } from '@/stores/canvasStore';
import { flushCanvasSync } from '@/stores/canvasSyncRuntime';

/** 自动保存三态指示器（spec D4）：dirty/saving→保存中、saved→已保存、error→点击重试 */
export function SaveStatusIndicator() {
  const status = useCanvasStore((s) => s.saveStatus);
  if (status === 'error') {
    return (
      <button
        onClick={() => void flushCanvasSync('retry')}
        className="text-xs bg-transparent border-none cursor-pointer text-[#ef4444] hover:text-[#ff6b6b] transition-colors px-0 py-0"
      >
        保存失败，点击重试
      </button>
    );
  }
  if (status === 'saved') {
    return <span className="text-xs text-[#4ade80] px-1">已保存</span>;
  }
  return <span className="text-xs text-[#888] px-1">保存中…</span>;
}
