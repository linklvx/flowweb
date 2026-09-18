import { useCanvasStore } from '@/stores/canvasStore';

/** Task15：连接状态指示器——已连接/连接中/离线重试（autosave 退役，实时即持久） */
export function SaveStatusIndicator() {
  const status = useCanvasStore((s) => s.connStatus);
  if (status === 'connected') {
    return <span className="text-xs text-accent-text px-1">已连接</span>;
  }
  if (status === 'connecting') {
    return <span className="text-xs text-[#888] px-1">连接中…</span>;
  }
  return (
    <button
      onClick={() => location.reload()}
      className="text-xs text-accent-danger hover:text-[#ff6b6b] transition-colors px-0 py-0"
    >
      连接断开，点击重试
    </button>
  );
}
