import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '../store/editorStore';
import { createAutosaveController, type AutosaveController } from '../persist/autosave';
import { upsertProject, patchProject } from '@/api/videoProjectApi';
import { EditorTopBar } from './EditorTopBar';
import { PreviewPlaceholder } from './PreviewPlaceholder';
import { TimelinePanel } from './timeline/TimelinePanel';

export function VideoEditorShell() {
  const open = useVideoEditorStore((s) => s.open);
  const sourceNodeId = useVideoEditorStore((s) => s.sourceNodeId);
  const close = useVideoEditorStore((s) => s.close);
  // 焦点移入壳内：编辑器打开后 Delete/Backspace 的事件目标落在 nokey 壳内，
  // xyflow isInputDOMNode（target.closest('.nokey')）命中 → 不再删除画布选中节点
  const focusRef = useRef<HTMLDivElement>(null);
  const autosaveRef = useRef<AutosaveController | null>(null);

  // 入口时序：open → reset + loading → POST upsert → loadProject
  useEffect(() => {
    if (!open || !sourceNodeId) return;
    let cancelled = false;
    const es = useEditorStore.getState();
    es.reset();
    useEditorStore.setState({ status: 'loading' });
    upsertProject({ workflowId: useCanvasStore.getState().projectId!, sourceNodeId, title: '多轨剪辑' })
      .then((p) => { if (!cancelled) useEditorStore.getState().loadProject(p); })
      .catch((e: Error) => { if (!cancelled) useEditorStore.getState().setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [open, sourceNodeId]);

  // autosave 生命周期：open 时创建 + data 订阅 + connStatus 恢复补发；关闭时 dispose（flush 在 handleClose）
  useEffect(() => {
    if (!open || !sourceNodeId) return;
    const ctrl = createAutosaveController({
      getProjectId: () => useEditorStore.getState().projectId!,
      patch: (id, body) => patchProject(id, body),
      getData: () => {
        const s = useEditorStore.getState();
        return { data: s.data, baseUpdatedAt: s.baseUpdatedAt! };
      },
      onSaved: (t) => useEditorStore.getState().setBaseUpdatedAt(t),
      onStateChange: (s) => useEditorStore.getState().setSaveState(s),
      onConflict: () => message.warning('工程已在其他窗口修改，自动保存已暂停'),
      isConnected: () => useCanvasStore.getState().connStatus === 'connected',
    });
    autosaveRef.current = ctrl;
    const unsubData = useEditorStore.subscribe((s, prev) => {
      if (s.data !== prev.data && s.status === 'ready') ctrl.notifyChange();
    });
    let wasConnected = useCanvasStore.getState().connStatus === 'connected';
    const unsubConn = useCanvasStore.subscribe((s, prev) => {
      const nowConn = s.connStatus === 'connected';
      if (nowConn && !wasConnected) ctrl.notifyConnected();
      wasConnected = nowConn;
    });
    return () => { unsubData(); unsubConn(); ctrl.dispose(); autosaveRef.current = null; };
  }, [open, sourceNodeId]);

  // 关闭 = flush 排空后 close（spec：收起 flush 走同一队列并 await 排空再关；ESC 经 BaseFullscreenModal onClose 同路径）
  const handleClose = () => {
    const ctrl = autosaveRef.current;
    if (ctrl) { void ctrl.flush().catch(() => {}).finally(() => close()); }
    else close();
  };

  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      <div data-testid="video-editor-shell" ref={focusRef} tabIndex={-1}
        className="fixed inset-0 bg-[#F7F8FA] flex flex-col box-border nokey">
        <EditorTopBar onClose={handleClose} onManualRetry={() => { void autosaveRef.current?.flush(); }} />
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
