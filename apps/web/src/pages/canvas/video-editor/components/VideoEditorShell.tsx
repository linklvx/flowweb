import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '../store/editorStore';
import { createAutosaveController, type AutosaveController } from '../persist/autosave';
import { upsertProject, patchProject } from '@/api/videoProjectApi';
import { createDefaultProjectData } from '../types';
import { EditorTopBar } from './EditorTopBar';
import { PreviewPlaceholder } from './PreviewPlaceholder';
import { TimelinePanel } from './timeline/TimelinePanel';
import { AssetPanel } from './AssetPanel';

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
    upsertProject({ workflowId: useCanvasStore.getState().projectId!, sourceNodeId, title: '多轨剪辑', data: createDefaultProjectData() }) // 首建默认 4 轨工程（执行期修正——update 分支忽略 data 幂等安全）
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
    // prev.status==='ready'：loadProject 是唯一进入 ready 的写入点——过滤加载迁移的幻影 PATCH（I2）
    const unsubData = useEditorStore.subscribe((s, prev) => {
      if (s.data !== prev.data && s.status === 'ready' && prev.status === 'ready') ctrl.notifyChange();
    });
    let wasConnected = useCanvasStore.getState().connStatus === 'connected';
    const unsubConn = useCanvasStore.subscribe((s, prev) => {
      const nowConn = s.connStatus === 'connected';
      if (nowConn && !wasConnected) ctrl.notifyConnected();
      wasConnected = nowConn;
    });
    return () => { unsubData(); unsubConn(); ctrl.dispose(); autosaveRef.current = null; };
  }, [open, sourceNodeId]);

  // 关闭 = flush 排空后 close；排空失败（离线/最终保存失败）警告并阻止关闭——数据仍留在 editorStore
  // 不变式：所有关闭路径必须经此函数（flush 排空先于 dispose，dispose 不取消在途 PATCH——review M2）
  const handleClose = () => {
    const ctrl = autosaveRef.current;
    if (ctrl) {
      void ctrl.flush().then((drained) => {
        if (!drained) { message.warning('当前离线或保存失败，存在未保存的修改——连接恢复后重试或手动重试后再收起'); return; }
        close();
      }).catch(() => close());
    } else close();
  };

  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      <div data-testid="video-editor-shell" ref={focusRef} tabIndex={-1}
        className="fixed inset-0 bg-[#F7F8FA] flex flex-col box-border nokey">
        <EditorTopBar onClose={handleClose} onManualRetry={() => { void autosaveRef.current?.retry(); }} />
        <div className="flex flex-1 min-h-0">
          {/* 左面板（Task 16 实化：画布产物资产库 + 拖入时间轴） */}
          <AssetPanel />
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
