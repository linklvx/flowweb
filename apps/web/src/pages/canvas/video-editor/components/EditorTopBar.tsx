// apps/web/src/pages/canvas/video-editor/components/EditorTopBar.tsx
// Y4a T7：REST autosave 退场——SAVE_DOT 状态点（saveState 消费面）+ onManualRetry 重试入口随链删除；
// 顶栏保留标题常量/比例切换（EditorTopBar 常量「多轨剪辑」=ExportModal 导出文件名同源口径）。
import { Dropdown } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { CANVAS_PRESETS, canvasSizeOf, LAST_ASPECT_KEY } from '../timeline/canvas-size';
import { ExportPopover } from './ExportModal'; // Task 19：导出按钮整体搬入 Popover 组件内部（open 由 Popover 自管，Shell 不再接 onExport）

/** onClose 由 Shell 传入（Y4a T7：关闭=直接关——REST 排空链退场） */
export function EditorTopBar({ onClose }: { onClose: () => void }) {
  const data = useEditorStore((s) => s.data);
  const current = canvasSizeOf(data);
  const label = CANVAS_PRESETS.find((p) => p.size.width === current.width && p.size.height === current.height)?.label ?? '自定义';
  return (
    <div data-testid="editor-top-bar"
      className="h-12 flex items-center gap-4 px-4 bg-[var(--fw-surface-dim)] border-b border-[var(--ve-border)]">
      <span className="text-[15px] font-medium text-text">多轨剪辑</span>
      <Dropdown
        trigger={['click']} // 按钮语义配 click（hover 划过顶栏即弹易误触）
        menu={{ items: [
          ...CANVAS_PRESETS.map((p) => ({ key: p.label, label: `${p.label}（${p.size.width}×${p.size.height}）` })),
          // 新建默认显式标注（spec 5.1 D6「显式标注不静默」）：渲染期直读 localStorage（非受控提示行，disabled 不可点击天然安全）
          { key: 'last-hint', disabled: true, label: `上次使用：${localStorage.getItem(LAST_ASPECT_KEY) ?? '16:9'}（新工程默认）` },
        ],
          selectedKeys: [label],
          onClick: ({ key }) => {
            const preset = CANVAS_PRESETS.find((p) => p.label === key);
            if (!preset) return;
            useEditorStore.getState().setCanvasSize(preset.size); // setCanvasSize 内部已走 commit() 完整入栈——外层再包 transient 会双入栈
            localStorage.setItem(LAST_ASPECT_KEY, key);
          } }}
      >
        <button type="button" data-testid="aspect-ratio-button"
          className="text-[12px] text-[var(--fw-text)] border border-[var(--ve-border)] rounded px-2 py-0.5">{label} ▾</button>
      </Dropdown>
      <div className="ml-auto flex items-center gap-3">
        <ExportPopover />
        <button type="button" onClick={onClose}
          className="text-[14px] text-[var(--fw-text)] border-0 px-2 py-1">
          收起
        </button>
      </div>
    </div>
  );
}
