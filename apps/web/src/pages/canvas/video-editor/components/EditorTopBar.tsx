// 占位版含收起按钮——Task 12 完整化（标题/保存态/更多操作）
import { useVideoEditorStore } from '@/stores/videoEditorStore';

export function EditorTopBar() {
  const close = useVideoEditorStore((s) => s.close);
  return (
    <div data-testid="editor-top-bar" className="h-12 flex items-center px-4 bg-white border-b border-[#E5E7EB] [border-bottom-style:solid]">
      <span className="text-[15px] font-medium text-[#1F2329]">多轨剪辑</span>
      <button type="button" onClick={close}
        className="ml-auto text-[14px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-2 py-1">收起</button>
    </div>
  );
}
