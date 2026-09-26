import { memo, useCallback, useMemo, useRef, useState, useEffect, type DragEvent } from 'react';
import { stopCapturing } from '@/stores/canvasUndo';
import {
  ReactFlow, Background, BackgroundVariant, MiniMap,
  useReactFlow,
  type Connection,
  type FinalConnectionState,
  type NodeTypes, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Modal } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { useTheme } from '@/stores/themeStore';
import { getAwareness } from '@/stores/canvasCollabRuntime';
import { RemoteCursors } from './RemoteCursors';
import { useAuth } from '@/components/AuthProvider';
import { useNodeStore } from '@/stores/nodeStore';
import { useMenuStore } from '@/stores/menuStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';
import { useTrackCanvasPointerShift } from '@/hooks/useTrackCanvasPointerShift';
import { findDropGroup } from '@/utils/groupDrop';
import { executeGroupNodes } from '@/api/executionApi';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { clientPoint, decideHandleMenu, absoluteRectsOf } from './handleMenu';
import { TextInputNode } from './nodes/TextInputNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { ImageExtNode } from './nodes/ImageExtNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { AudioGenNode } from './nodes/AudioGenNode';
import { MultiImageNode } from './nodes/MultiImageNode';
import { VideoEditNode } from './nodes/VideoEditNode';
import { GroupNode } from './groups/GroupNode';
import { ConnectionLine } from './edges/ConnectionLine';
import { CanvasToolbar } from './CanvasToolbar';
import { SelectionBoxOverlay } from './groups/SelectionBoxOverlay';
import { GroupToolbar } from './groups/GroupToolbar';
import { GroupContextMenu } from './groups/GroupContextMenu';
import { ConfirmModal } from './ConfirmModal';
import { AspectRatioDropdown } from './groups/AspectRatioDropdown';
import { GridSizeDropdown } from './groups/GridSizeDropdown';
import { StitchButton } from './groups/StitchButton';
import type { StoryboardConfig } from '@/types/group';

export const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  imageExtGen: ImageExtNode,
  videoGen: VideoGenNode,
  audioGen: AudioGenNode,
  multiImageGen: MultiImageNode,
  videoEdit: VideoEditNode,
  group: GroupNode,
} as any;

const edgeTypes: any = {
  default: ConnectionLine,
};

interface Props {
  projectId: string;
}

/** awareness 变化驱动的远端光标层（非响应式桥 → 计数器强制渲染） */
function RemoteCursorsLive() {
  const [, force] = useState(0);
  const bridge = getAwareness()!;
  useEffect(() => bridge.onStateChange(() => force((v) => v + 1)), [bridge]);
  return <RemoteCursors bridge={bridge} />;
}

function CanvasViewComponent(_props: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [groupContextMenu, setGroupContextMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  // 编辑器打开期间禁用 xyflow 的 Delete/Backspace 删节点（与 Shell nokey 双保险，spec 验收 27）
  const editorOpen = useVideoEditorStore((s) => s.open);
  const authUser = (useAuth() as { user?: { id: string; name: string } } | null)?.user;

  // presence：本地用户 + 光标 50ms 节流上报（流坐标）
  useEffect(() => {
    const bridge = getAwareness();
    if (!bridge || !authUser) return;
    bridge.setLocalUser({ id: authUser.id, name: authUser.name });
  }, [authUser]);

  const lastCursorReport = useRef(0);
  const handlePresencePointerMove = useCallback((e: React.MouseEvent) => {
    const bridge = getAwareness();
    if (!bridge) return;
    const now = performance.now();
    if (now - lastCursorReport.current < 50) return;
    lastCursorReport.current = now;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const flow = screenToFlowPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    bridge.setCursor({ x: flow.x, y: flow.y });
  }, [screenToFlowPosition]);
  const projectId = useCanvasStore((s) => s.projectId);
  const activeEditNodeId = useNodeStore((s) => s.activeEditNodeId);
  const isLocked = activeEditNodeId !== null;
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const updateViewport = useCanvasStore((s) => s.updateViewport);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);
  useTrackCanvasPointerShift(reactFlowWrapper);
  const toggleCollapse = useCanvasStore((s) => s.toggleCollapse);
  const ungroup = useCanvasStore((s) => s.ungroup);
  const convertGroup = useCanvasStore((s) => s.convertGroup);
  const addImageToStoryboardCell = useCanvasStore((s) => s.addImageToStoryboardCell);

  // 素材库「应用到画布」：监听 pendingMediaFile 创建节点或填充分镜格
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prevState) => {
      const file = state.pendingMediaFile;
      const prevFile = prevState.pendingMediaFile;
      const fillCell = state.pendingFillCell;
      if (!file || file === prevFile || !reactFlowWrapper.current) return;

      try {
        // 如果有 pending fill cell，填充分镜格
        if (fillCell) {
          addImageToStoryboardCell(fillCell.groupId, fillCell.cellIndex, file.id, file.url);
          useCanvasStore.setState({ pendingFillCell: null });
          return;
        }

        // 否则创建新节点
        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const centerClientX = bounds.left + bounds.width / 2;
        const centerClientY = bounds.top + bounds.height / 2;

        let position = screenToFlowPosition({
          x: centerClientX,
          y: centerClientY,
        });

        const NODE_DEFAULT_WIDTH = 320;
        const NODE_DEFAULT_HEIGHT = 240;
        position = {
          x: position.x - NODE_DEFAULT_WIDTH / 2,
          y: position.y - NODE_DEFAULT_HEIGHT / 2,
        };

        const isVideo = file.mimeType?.startsWith('video/');
        const nodeType = isVideo ? 'video' : 'image';
        const nodeData = {
          fileId: file.id,
          status: 'done',
          mediaName: file.originalName,
          mediaUrl: file.url,
          thumbnailUrl: file.thumbnailUrl,
        };

        addNode(nodeType, position, nodeData);
      } catch (err) {
        console.error('[CanvasView] addMediaNode failed:', err);
      } finally {
        useCanvasStore.setState({ pendingMediaFile: null });
      }
    });

    return () => {
      unsub();
      useCanvasStore.setState({ pendingMediaFile: null, pendingFillCell: null });
    };
  }, [screenToFlowPosition, addNode, addImageToStoryboardCell]);

  // 监听 fill-cell 事件，打开素材库
  useEffect(() => {
    const handleFillCell = (e: Event) => {
      const ce = e as CustomEvent<{ groupId: string; index: number }>;
      const { groupId, index } = ce.detail;
      useCanvasStore.getState().requestFillStoryboardCell(groupId, index);
      useMaterialLibraryStore.getState().open();
    };
    window.addEventListener('storyboard:fill-cell', handleFillCell);
    // 素材库关闭且未消费选图（选图路径先设 pendingMediaFile 再 close）→ 清残留的填充意图
    const unsubLib = useMaterialLibraryStore.subscribe((state, prevState) => {
      if (prevState.isOpen && !state.isOpen) {
        const cs = useCanvasStore.getState();
        if (cs.pendingFillCell && !cs.pendingMediaFile) {
          useCanvasStore.setState({ pendingFillCell: null });
        }
      }
    });
    return () => {
      window.removeEventListener('storyboard:fill-cell', handleFillCell);
      unsubLib();
    };
  }, []);

  const onNodeClick = useCallback((_event: any, node: any) => {
    const ns = useNodeStore.getState();
    if (ns.activeEditNodeId && ns.activeEditNodeId !== node.id) {
      ns.triggerCancelEdit();
    } else if (ns.activeTransformNodeId && ns.activeTransformNodeId !== node.id) {
      ns.triggerCancelTransform();
    } else if (!ns.activeEditNodeId && !ns.activeTransformNodeId) {
      selectNode(node.id);
    }
  }, [selectNode]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: any) => {
    if (node.type === 'group') {
      event.preventDefault();
      setGroupContextMenu({ groupId: node.id, x: event.clientX, y: event.clientY });
    }
  }, []);

  const closeGroupContextMenu = useCallback(() => {
    setGroupContextMenu(null);
  }, []);

  const onPaneClick = useCallback(() => {
    closeGroupContextMenu();
    const ns = useNodeStore.getState();
    if (ns.activeEditNodeId) {
      if (!ns.getEditOverlayDragging()) {
        ns.triggerCancelEdit();
      }
    } else if (ns.activeTransformNodeId) {
      ns.triggerCancelTransform();
    } else {
      selectNode(null);
    }
  }, [selectNode, closeGroupContextMenu]);

  // ── handle 拖拽弹菜单（spec 2026-09-26-image-node-panel-redesign §3.3）──
  // 起点经 ref 写入：onConnectEnd 同 tick 读取，避免闭包旧值
  const handleDragStartRef = useRef<{ x: number; y: number; nodeId: string; handleType: string } | null>(null);
  const reconnectingRef = useRef(false);

  const onConnectStart = useCallback((event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
    const p = clientPoint(event);
    handleDragStartRef.current = {
      x: p.x,
      y: p.y,
      nodeId: params.nodeId ?? '',
      handleType: params.handleType ?? '',
    };
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    // 重连标志必须在 onConnectEnd 开头复位（spec §3.3 守卫 0：事件序 onReconnectStart→onConnectStart→…→此处）
    const wasReconnecting = reconnectingRef.current;
    reconnectingRef.current = false;
    const dragStart = handleDragStartRef.current;
    handleDragStartRef.current = null;
    if (wasReconnecting || !dragStart) return;

    const p = clientPoint(event);
    const flowPoint = screenToFlowPosition(p);
    const nodes = useCanvasStore.getState().nodes;
    const node = nodes.find((n) => n.id === dragStart.nodeId);
    // isLocked 来源=useNodeStore.activeEditNodeId（CanvasView L102-103 既有订阅同一 store，实证勿改读 canvasStore）
    const isLockedNow = useNodeStore.getState().activeEditNodeId !== null;

    const decision = decideHandleMenu({
      reconnecting: wasReconnecting,
      isValid: state?.isValid ?? null,
      toHandle: state?.toHandle ?? null,
      toNode: state?.toNode ?? null,
      nodeType: node?.type,
      isLocked: isLockedNow,
      dragDistancePx: Math.hypot(p.x - dragStart.x, p.y - dragStart.y),
      flowPoint,
      rects: absoluteRectsOf(nodes),
      nodeId: dragStart.nodeId,
      side: dragStart.handleType === 'target' ? 'target' : 'source',
      clientX: p.x,
      clientY: p.y,
    });
    if (decision.kind === 'open') {
      useMenuStore.getState().openHandleMenu(decision.payload);
    }
  }, [screenToFlowPosition]);

  const onReconnectStart = useCallback(() => { reconnectingRef.current = true; }, []);
  // 双保险复位：Esc 取消重连走 cancelConnection、不触发 onConnectEnd（spec §3.3）；正常结束时紧随其后的重复复位无副作用
  const onReconnectEnd = useCallback(() => { reconnectingRef.current = false; }, []);

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      useMenuStore.getState().open({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  const isValidConnection = useCallback((connection: Connection) => {
    // No self-connections
    if (connection.source === connection.target) return false;
    return true;
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !reactFlowWrapper.current) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      addNode(type, { x: position.x - 125, y: position.y - 30 });
    },
    [addNode, screenToFlowPosition]
  );

  // Ctrl/Cmd + wheel → canvas zoom; block browser Ctrl+scroll zoom
  // 使用 document 级别捕获阶段，确保拦截所有 Ctrl+滚轮事件，
  // 防止浏览器原生的页面缩放快捷键与画布缩放冲突
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (isLocked) return;
        if (e.deltaY < 0) zoomIn({ duration: 100 });
        else zoomOut({ duration: 100 });
      }
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, [zoomIn, zoomOut, isLocked]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    useMenuStore.getState().updateMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const onNodeDragStopIntoGroup = useCallback(
    (_e: any, draggedNode: any) => {
      const s = useCanvasStore.getState();
      const groups = s.nodes.filter((n) => n.type === 'group' && n.id !== draggedNode.id);
      const target = findDropGroup(draggedNode, groups);
      if (target) {
        if ((target.data as any).groupType === 'storyboard') {
          s.dropImageIntoStoryboard(target.id, draggedNode.id); // Task 12 正式实现（当前 no-op）
        } else {
          s.dropIntoGroup(draggedNode.id, target.id);
        }
      }
    },
    [],
  );

  const handleNodeDragStop = useCallback((e: any, node: any) => {
    stopCapturing();                    // 分隔拖动手势：手势内连续变更合并为一个 undo 项
    onNodeDragStopIntoGroup(e, node);   // 既有拖入组逻辑保持
  }, [onNodeDragStopIntoGroup]);

  // 选中组节点时显示 GroupToolbar；多选（≥2）或 Shift 多选意图时不显示，仅普通单独选中时显示
  const selectedGroup = useMemo(() => {
    let count = 0;
    for (const n of nodes) {
      if (!n.selected) continue;
      count++;
      if (count > 1) return undefined;
    }
    return count === 1 && !lastPointerShiftKey
      ? nodes.find((n) => n.type === 'group' && n.selected)
      : undefined;
  }, [nodes, lastPointerShiftKey]);

  // 计算组是否可转为分镜组：仅当普通组且子节点全部是完成图片节点时
  const isConvertible = useMemo(() => {
    if (!selectedGroup) return true;
    const gd = selectedGroup.data as any;
    if (gd.groupType === 'storyboard') return true;
    const children = nodes.filter((n) => n.parentId === selectedGroup.id);
    // 默认 convertible=true（T7 测试不传 prop）；仅当明确不满足时置 false
    return children.length === 0 || children.every(isImageCompletedNode);
  }, [selectedGroup, nodes]);

  // 计算组内是否有节点正在执行（响应式订阅）
  const groupExecuting = useCanvasStore((s) =>
    selectedGroup ? s.nodes.filter((n) => n.parentId === selectedGroup.id).some((n) => n.id in s.nodeProcessMap) : false
  );

  // C8 D2：colorMode 跟随全局主题翻转（CanvasView 是 colorMode 源头、唯一 useTheme 例外——节点/面板组件禁 useTheme，spec §11.1）
  const { mode } = useTheme();

  return (
    <div ref={reactFlowWrapper} className="w-full h-full overflow-hidden" onMouseMove={handleMouseMove}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange as OnNodesChange}
        onEdgesChange={onEdgesChange as OnEdgesChange}
        onConnect={onConnect as any}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        isValidConnection={isValidConnection as any}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={viewport}
        onViewportChange={updateViewport}
        onMouseMove={handlePresencePointerMove}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDragStop={handleNodeDragStop}
        deleteKeyCode={editorOpen ? [] : ['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        minZoom={0.2}
        maxZoom={3}
        fitView={false}
        zoomOnScroll={false}
        panOnScroll={!isLocked}
        panOnDrag={!isLocked}
        zoomOnDoubleClick={!isLocked}
        nodesDraggable={!isLocked}
        nodesFocusable={!isLocked}
        elementsSelectable={!isLocked}
        snapToGrid={snapEnabled}
        snapGrid={[20, 20]}
        noWheelClassName="nowheel"
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--canvas-board-bg)]"
        // C8 D2：colorMode 跟随主题翻转（深浅档各挂 .dark/.light 运行时类驱动 xyflow 皮肤变量；与 .light 令牌岛撞名风险由镜像断言守卫——wrapper 主题类恰一个且等于 html 类）；对齐 ProcessSnapshot
        colorMode={mode}
      >
        {/* bgColor="transparent"：钉死 .react-flow__background 底色（dark 皮肤默认会给 #141414 染灰整块板面，与修复前 transparent 不一致） */}
        <Background variant={BackgroundVariant.Dots} color="var(--canvas-board-dot)" gap={16} size={1} bgColor="transparent" />
        {minimapOpen && (
  <MiniMap
    style={{
      width: 160,
      height: 120,
      // C8 D3-board：底/边双值化（深档 50→38/70→51 可见变暗——minimapOpen 默认 false 采集态不渲染，adjudications 登记）
      backgroundColor: 'var(--canvas-controls-bg)',
      border: '0.5px solid var(--canvas-controls-border)',
      borderRadius: '8px',
    }}
    // nodeColor 落 SVG 属性禁 var()——JS 分支取色（深 160 字面不变零 diff；浅 #6b7280 与 controls-icon 浅值同源）
    nodeColor={() => (mode === 'dark' ? 'rgb(160, 160, 160)' : 'rgb(107, 114, 128)')}
    maskColor="rgba(0, 0, 0, 0.35)"
  />
)}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {getAwareness() && <RemoteCursorsLive />}
        </div>
        <CanvasToolbar
          zoom={viewport.zoom}
          onFitView={handleFitView}
          onZoomIn={() => zoomIn({ duration: 100 })}
          onZoomOut={() => zoomOut({ duration: 100 })}
          minimapOpen={minimapOpen}
          onToggleMinimap={() => setMinimapOpen((v) => !v)}
          snapEnabled={snapEnabled}
          onToggleSnap={() => setSnapEnabled((v) => !v)}
        />
        <SelectionBoxOverlay />
        {selectedGroup && (() => {
          const gd = selectedGroup.data as any;
          const groupType = gd.groupType ?? 'normal';
          const cfg = gd.storyboard;

          const noOp = () => {};

          const handleUngroup = () => {
            ungroup(selectedGroup.id);
          };

          const handleConvert = (target: 'normal' | 'storyboard') => {
            convertGroup(selectedGroup.id, target);
          };

          if (groupType === 'storyboard') {
            const confirmClear = () => {
              Modal.confirm({
                title: '清空分镜组',
                content: '将删除组内全部图片节点，此操作不可恢复',
                okButtonProps: { danger: true },
                onOk: () => {
                  useCanvasStore.getState().clearStoryboard(selectedGroup.id);
                },
              });
            };

            const updateStoryboardConfig = (patch: Partial<StoryboardConfig>) => {
              useCanvasStore.getState().updateStoryboardConfig(selectedGroup.id, patch);
            };

            const resizeStoryboardGrid = (rows: number, cols: number) => {
              useCanvasStore.getState().resizeStoryboardGrid(selectedGroup.id, rows, cols);
            };

            const indexBtn = (enabled: boolean): React.CSSProperties => ({
              background: enabled ? 'rgba(74,222,128,0.15)' : 'none',
              border: 'none',
              color: enabled ? 'var(--fw-accent-text)' : 'var(--fw-text-dim-3)', // C8 D3-board：两分支主题化（浅档白字白底不可见；accent 深值字节等值）
              fontWeight: enabled ? 600 : 'normal',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            });

            const btn = (disabled?: boolean): React.CSSProperties => ({
              background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
              padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
            });

            return (
              <GroupToolbar
                groupId={selectedGroup.id}
                groupType="storyboard"
                collapsed={false}
                executing={groupExecuting}
                onCollapse={noOp}
                onExecute={noOp}
                onUngroup={handleUngroup}
                onConvert={(id, target) => convertGroup(id, target)}
              >
                <AspectRatioDropdown
                  value={cfg.aspectRatio}
                  onChange={(v) => updateStoryboardConfig({ aspectRatio: v })}
                  executing={groupExecuting}
                />
                <GridSizeDropdown
                  rows={cfg.gridRows}
                  cols={cfg.gridCols}
                  onChange={(r, c) => resizeStoryboardGrid(r, c)}
                  executing={groupExecuting}
                />
                <StitchButton
                  groupId={selectedGroup.id}
                  resolution={cfg.stitchResolution}
                  onResolutionChange={(v) => updateStoryboardConfig({ stitchResolution: v })}
                  running={false}
                />
                <button
                  style={indexBtn(cfg.showIndex)}
                  onClick={() => updateStoryboardConfig({ showIndex: !cfg.showIndex })}
                >
                  № 序号
                </button>
                <button style={btn(false)} onClick={confirmClear}>
                  🗑 清空
                </button>
              </GroupToolbar>
            );
          }

          // normal group
          return (
            <GroupToolbar
              groupId={selectedGroup.id}
              groupType="normal"
              collapsed={!!gd.collapsed}
              executing={groupExecuting}
              onCollapse={toggleCollapse}
              onExecute={async (groupId) => {
                const childIds = nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
                if (childIds.length > 0 && projectId) {
                  void executeGroupNodes(projectId, childIds);
                }
              }}
              onUngroup={handleUngroup}
              onConvert={(id, target) => convertGroup(id, target)}
              convertible={isConvertible}
            />
          );
        })()}
      </ReactFlow>
      {/* 工具条 Portal 挂载点：最高层级，不拦截鼠标事件 */}
      <div
        id="node-toolbar-portal"
        className="absolute inset-0 pointer-events-none z-50"
      />
      <ConfirmModal />
      {groupContextMenu && (
        <GroupContextMenu
          groupId={groupContextMenu.groupId}
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          onClose={closeGroupContextMenu}
        />
      )}
    </div>
  );
}

export const CanvasView = memo(CanvasViewComponent);
