// apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx
// Y4a T7（plan 2026-11-20-y4a-timeline-domain Task 7——spec §0 条 7）：Shell 改订阅既有
// timelines.<nodeId> Map——upsert/getProjectByNode REST 链+autosave 挂点+关闭排空三选 modal 整删
// （关闭=直接关；写穿=editorStore commit→timeline-user 事务；撤销=时间轴栈）。键不在（节点
// 无工程）停 loading 不创建（编辑器只读已存在 Map）。
import { useEffect, useRef, useState } from 'react';
import { ConfigProvider, App as AntdApp } from 'antd';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useEditorStore } from '../store/editorStore';
import { EditorTopBar } from './EditorTopBar';
import { PreviewPlayer } from './PreviewPlayer';
import { PropertiesPanel } from './PropertiesPanel';
import { TimelinePanel } from './timeline/TimelinePanel';
import { AssetPanel } from './AssetPanel';
import { releaseEditorRuntime } from '../hooks/playback';

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
  // 焦点移入壳内：编辑器打开后 Delete/Backspace 的事件目标落在 nokey 壳内，
  // xyflow isInputDOMNode（target.closest('.nokey')）命中 → 不再删除画布选中节点
  // ⚠ useRef 类型显式含 null：useRef<HTMLDivElement>(null) 推出 RefObject（current 只读），回调 ref 内赋值 TS 报错
  const focusRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null); // 弹层容器 ref（ConfigProvider getPopupContainer）

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

  // 入口时序（Y4a T7）：open → reset + loading → loadProject(nodeId)=doc 水合（timelines.<nodeId>
  // 只读已存在 Map——键不在停 loading 不创建）。关闭（open=false）→ cleanup reset（监听/栈卸下）。
  useEffect(() => {
    if (!open || !sourceNodeId) return;
    useEditorStore.getState().reset();
    useEditorStore.setState({ status: 'loading' });
    useEditorStore.getState().loadProject(sourceNodeId);
    return () => { useEditorStore.getState().reset(); };
  }, [open, sourceNodeId]);

  // 关闭 = 释放运行时后直接关（REST 排空三选链退场——数据在 doc 无未落库可言）
  const handleClose = () => {
    releaseEditorRuntime(); // 收起释放运行时（spec 边界护栏）——close() 之前
    close();
  };

  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      {/* ⚠ 一个元素只能有一个 ref 属性——回调 ref 合并两个目标（漏挂 shellRef 则 getPopupContainer
          永远回退 body，弹层作用域修复静默失效） */}
      <div data-testid="video-editor-shell" tabIndex={-1}
        ref={(el) => { focusRef.current = el; shellRef.current = el; }}
        // C8 D3-ve 岛拆除（Task 21）：壳跟随域——删 dark 类/[color-scheme:dark]，--fw-* 经 html 类继承翻转，
        // 壳底 var(--fw-bg) 两档各自取值（深 #141414/浅 #f7f8fa）；媒体区预览垫底 --ve-preview-base 恒深为
        // <canvas> 自绘（无 <video controls> 原生控件，color-scheme 局部钉扎无对象——adjudications 在册）
        className="fixed inset-0 bg-[var(--fw-bg)] flex flex-col nokey">
        {/* 批 1：弹层作用域——antd 弹层挂进壳内而非 body 直挂（z-index 低于壳被盖）。
            ref 未挂载首帧兜底 body（getPopupContainer 不得返回 null）。
            C8 D3-ve：algorithm 通道删除——随根 AntdApp 继承（html 类驱动 default/dark 切换），
            仅保留 getPopupContainer。
            <AntdApp> 必须 component={false}：默认渲染 div.ant-app（block、高度 auto）打断壳 flex flex-col 布局 */}
        <ConfigProvider
          getPopupContainer={() => shellRef.current ?? document.body}
        >
          <AntdApp component={false}>
            <EditorTopBar onClose={handleClose} />
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
          </AntdApp>
        </ConfigProvider>
      </div>
    </BaseFullscreenModal>
  );
}
