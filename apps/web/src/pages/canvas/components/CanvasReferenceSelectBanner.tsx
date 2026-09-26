import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

/** 画布参考选择模式横幅（spec §3.2）——挂 ReactFlow 子级（absolute 顶部居中，不随 viewport 变换）。 */
export function CanvasReferenceSelectBanner() {
  const referenceSelect = useNodeStore((s) => s.referenceSelect);
  const { setCenter, getNode, getViewport } = useReactFlow();

  // mount 时注册一次（handler 经 getState 检查激活态）——依赖 [referenceSelect] 会在测试同步时序下
  // 因 passive effect 未重跑而丢失监听器；语义等价：未激活时 Esc 无操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useNodeStore.getState().referenceSelect) {
        useNodeStore.getState().exitReferenceSelect();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!referenceSelect) return null;

  const handleReturn = () => {
    const { sourceNodeId } = referenceSelect;
    useNodeStore.getState().exitReferenceSelect();
    // P11：几何取 RF 内部节点（nodeStore 节点无 measured/internals）
    const node = getNode(sourceNodeId) as any;
    if (node) {
      const abs = node.internals?.positionAbsolute ?? node.position ?? { x: 0, y: 0 };
      const w = node.measured?.width ?? node.width ?? 0;
      const h = node.measured?.height ?? node.height ?? 0;
      setCenter(abs.x + w / 2, abs.y + h / 2, { zoom: getViewport().zoom, duration: 300 });
      // 注：selectNode 只写 canvasStore.selectedId（P12）——面板可见由 elementsSelectable=false（D25）保证，
      // 此调用仅服务 selectedId 的其他消费方（如批量工具条），非面板保活手段
      useCanvasStore.getState().selectNode?.(sourceNodeId);
    }
  };

  return (
    <div
      data-testid="canvas-reference-banner"
      className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2"
      style={{
        backgroundColor: 'var(--canvas-controls-bg)',
        border: '1px solid var(--canvas-controls-border)',
        boxShadow: 'var(--canvas-shadow-dropdown)',
      }}
    >
      <span aria-hidden="true" className="flex size-6 items-center justify-center text-text-dim-2">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <path d="M6.5 17.5H14A3.5 3.5 0 0 0 17.5 14V6.5" />
          <path d="M6.5 6.5h3v3h-3z" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span role="status" className="whitespace-nowrap text-[13px] text-text">
        {referenceSelect.notice ?? '从画布选择参考'}
      </span>
      <button
        type="button"
        onClick={handleReturn}
        className="rounded-lg px-2.5 py-1 text-[13px] text-text transition-colors hover:bg-overlay-2"
      >
        返回节点
      </button>
      <button
        type="button"
        onClick={() => useNodeStore.getState().exitReferenceSelect()}
        className="rounded-lg px-2.5 py-1 text-[13px] text-text-dim-2 transition-colors hover:bg-overlay-2 hover:text-text"
      >
        退出
      </button>
    </div>
  );
}
