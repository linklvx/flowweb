import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '../store/editorStore';
import { createAutosaveController, type AutosaveController } from '../persist/autosave';
import { upsertProject, patchProject } from '@/api/videoProjectApi';
import { createDefaultProjectData } from '../types';
import { EditorTopBar } from './EditorTopBar';
import { PreviewPlayer } from './PreviewPlayer';
import { PropertiesPanel } from './PropertiesPanel';
import { TimelinePanel } from './timeline/TimelinePanel';
import { AssetPanel } from './AssetPanel';
import { ExportModal } from './ExportModal';
import { releaseEditorRuntime } from '../hooks/playback';

// bridge：挂在内层 <AntdApp> 之下才能取到壳作用域 message 实例（返回 null 零 DOM）——Shell 函数体顶层
// 不能 useApp()（React context 按组件树祖先解析，读到的是根 App 的 AntdApp：holder 挂 body、仍被壳盖）
function ShellToastBridge({ apiRef }: { apiRef: MutableRefObject<{ warning: (m: string) => void } | null> }) {
  apiRef.current = AntdApp.useApp().message;
  return null;
}

// 持久化契约（对齐 opencut panel-store 模式：自管 {version, panels}，不用库内建 autoSaveId——
// 其键名/序列化由库控制无版本语义）
const PANEL_STORAGE_KEY = 've-panel-sizes';
function loadPanelSizes(): { version: 1; panels: Record<string, number[]> } | null {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as { version: number } : null;
    return parsed?.version === 1 ? parsed as { version: 1; panels: Record<string, number[]> } : null; // 版本不符走默认（migrate 挂点）
  } catch { return null; }
}

export function VideoEditorShell() {
  const open = useVideoEditorStore((s) => s.open);
  const sourceNodeId = useVideoEditorStore((s) => s.sourceNodeId);
  const close = useVideoEditorStore((s) => s.close);
  const [exportOpen, setExportOpen] = useState(false);
  // 焦点移入壳内：编辑器打开后 Delete/Backspace 的事件目标落在 nokey 壳内，
  // xyflow isInputDOMNode（target.closest('.nokey')）命中 → 不再删除画布选中节点
  // ⚠ useRef 类型显式含 null：useRef<HTMLDivElement>(null) 推出 RefObject（current 只读），回调 ref 内赋值 TS 报错
  const focusRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null); // 弹层容器 ref（ConfigProvider getPopupContainer）
  const autosaveRef = useRef<AutosaveController | null>(null);
  // Shell 内 2 处静态 message.warning 改经壳内上下文实例（bridge 存 ref）——静态 message 只读自身
  // getContainer 不继承调用方容器，会挂到 body 被壳盖。onConflict/handleClose 只在 open=true 可达，
  // 此时 bridge 必挂载，无 null 窗口
  const toastApiRef = useRef<{ warning: (m: string) => void } | null>(null);

  // saved 惰性初始化一次——裸调 loadPanelSizes() 每次重渲重读 localStorage，若库在 prop 变化时
  // 重应用 defaultSize 会导致拖动回弹
  const [saved] = useState(() => loadPanelSizes());
  // onLayout 拖拽期间逐帧触发，localStorage.setItem 同步写逐帧落盘有卡顿风险——
  // onLayout 只缓存进 ref，PanelResizeHandle 的 onDragging(isDragging=false) 拖拽结束时一次落盘
  const pendingSizesRef = useRef<Record<string, number[]>>({});
  const saveLayout = (groupId: string) => (sizes: number[]) => { pendingSizesRef.current[groupId] = sizes; };
  const flushLayout = () => {
    if (Object.keys(pendingSizesRef.current).length === 0) return;
    const cur = loadPanelSizes();
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ version: 1, panels: { ...cur?.panels, ...pendingSizesRef.current } }));
    pendingSizesRef.current = {};
  };

  // 入口时序：open → reset + loading → POST upsert → loadProject
  useEffect(() => {
    if (!open || !sourceNodeId) return;
    let cancelled = false;
    const es = useEditorStore.getState();
    es.reset();
    useEditorStore.setState({ status: 'loading' });
    upsertProject({ workflowId: useCanvasStore.getState().projectId!, sourceNodeId, title: '多轨剪辑', data: createDefaultProjectData() }) // 首建默认单空视频轨工程（勘误③：其余轨道随素材动态创建——update 分支忽略 data 幂等安全）
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
      onConflict: () => toastApiRef.current?.warning('工程已在其他窗口修改，自动保存已暂停'),
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
        if (!drained) { toastApiRef.current?.warning('当前离线或保存失败，存在未保存的修改——连接恢复后重试或手动重试后再收起'); return; }
        releaseEditorRuntime(); // 收起释放运行时（spec 边界护栏）——flush 成功、close() 之前
        close();
      }).catch(() => { releaseEditorRuntime(); close(); }); // flush reject（异常路径）同样释放——各释放操作幂等
    } else close();
  };

  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      {/* ⚠ 一个元素只能有一个 ref 属性——回调 ref 合并两个目标（漏挂 shellRef 则 getPopupContainer
          永远回退 body，弹层作用域修复静默失效） */}
      <div data-testid="video-editor-shell" tabIndex={-1}
        ref={(el) => { focusRef.current = el; shellRef.current = el; }}
        className="fixed inset-0 bg-[var(--ve-bg)] [color-scheme:dark] flex flex-col box-border nokey">
        {/* 批 1：弹层作用域——antd 弹层挂进壳内而非 body 直挂（z-index 低于壳被盖）。
            ref 未挂载首帧兜底 body（getPopupContainer 不得返回 null）。
            <AntdApp> 必须 component={false}：默认渲染 div.ant-app（block、高度 auto）打断壳 flex flex-col 布局 */}
        <ConfigProvider
          getPopupContainer={() => shellRef.current ?? document.body}
          theme={{ algorithm: antdTheme.darkAlgorithm }}
        >
          <AntdApp component={false}>
            <ShellToastBridge apiRef={toastApiRef} />
            <EditorTopBar onClose={handleClose} onManualRetry={() => { void autosaveRef.current?.retry(); }} onExport={() => setExportOpen(true)} />
            <div className="flex flex-1 min-h-0">
              {/* v2 的尺寸 prop 属于 Panel，PanelGroup 无 defaultSize——恢复布局 = 保存的尺寸数组按序映射回各 Panel 的 defaultSize。
                  横向三档默认和必须 =100（22/56/22） */}
              <PanelGroup direction="vertical" id="ve-vertical" onLayout={saveLayout('ve-vertical')}>
                <Panel defaultSize={saved?.panels['ve-vertical']?.[0] ?? 70} minSize={30}>
                  <PanelGroup direction="horizontal" id="ve-horizontal" onLayout={saveLayout('ve-horizontal')}>
                    {/* 左面板（Task 16 实化：画布产物资产库 + 拖入时间轴） */}
                    <Panel defaultSize={saved?.panels['ve-horizontal']?.[0] ?? 22} minSize={15} maxSize={40}><AssetPanel /></Panel>
                    <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" onDragging={(isDragging) => { if (!isDragging) flushLayout(); }} />
                    <Panel defaultSize={saved?.panels['ve-horizontal']?.[1] ?? 56} minSize={30}><PreviewPlayer /></Panel>
                    <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" onDragging={(isDragging) => { if (!isDragging) flushLayout(); }} />
                    {/* 右面板（Plan 3 四态；Task 8 最小占位，Task 10 完整化） */}
                    <Panel defaultSize={saved?.panels['ve-horizontal']?.[2] ?? 22} minSize={15} maxSize={40}><PropertiesPanel /></Panel>
                  </PanelGroup>
                </Panel>
                <PanelResizeHandle className="h-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-row-resize" onDragging={(isDragging) => { if (!isDragging) flushLayout(); }} />
                <Panel defaultSize={saved?.panels['ve-vertical']?.[1] ?? 30} minSize={15} maxSize={70}><TimelinePanel /></Panel>
              </PanelGroup>
            </div>
            <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
          </AntdApp>
        </ConfigProvider>
      </div>
    </BaseFullscreenModal>
  );
}
