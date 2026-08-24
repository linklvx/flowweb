import { memo, useCallback, useMemo, useRef, useState, useEffect, type DragEvent } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, MiniMap,
  useReactFlow,
  type Connection,
  type NodeTypes, type OnNodesChange, type OnEdgesChange,
  type NodeChange, type NodeDimensionChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Modal } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useMenuStore } from '@/stores/menuStore';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';
import { debounce } from '@/utils/debounce';
import { useTrackCanvasPointerShift } from '@/hooks/useTrackCanvasPointerShift';
import { findDropGroup } from '@/utils/groupDrop';
import { executeGroupNodes } from '@/api/executionApi';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { TextInputNode } from './nodes/TextInputNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { ImageExtNode } from './nodes/ImageExtNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { AudioGenNode } from './nodes/AudioGenNode';
import { MultiImageNode } from './nodes/MultiImageNode';
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

const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  imageExtGen: ImageExtNode,
  videoGen: VideoGenNode,
  audioGen: AudioGenNode,
  multiImageGen: MultiImageNode,
  group: GroupNode,
} as any;

const edgeTypes: any = {
  default: ConnectionLine,
};

interface Props {
  projectId: string;
}

function CanvasViewComponent({ projectId: _projectId }: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [groupContextMenu, setGroupContextMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
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

  // Debounced dimension sync
  const syncNodeDimensions = useMemo(
    () => debounce(async (changes: NodeChange[]) => {
      const dimChanges = changes.filter(
        (c): c is NodeDimensionChange => c.type === 'dimensions',
      );
      if (dimChanges.length === 0) return;

      const data = dimChanges.map((c) => ({
        id: c.id,
        width: c.dimensions!.width,
        height: c.dimensions!.height,
      }));

      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(`/api/projects/${_projectId}/nodes/dimensions`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error('HTTP error');
          return;
        } catch (error) {
          if (i === 2) console.error('节点尺寸同步失败，将在项目保存时重试', error);
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, i)));
        }
      }
    }, 500),
    [_projectId],
  );

  useEffect(() => {
    return () => { syncNodeDimensions.cancel(); };
  }, [syncNodeDimensions]);

  const wrappedOnNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
    syncNodeDimensions(changes);
  }, [onNodesChange, syncNodeDimensions]);

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

  return (
    <div ref={reactFlowWrapper} className="w-full h-full overflow-hidden" onMouseMove={handleMouseMove}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={wrappedOnNodesChange as OnNodesChange}
        onEdgesChange={onEdgesChange as OnEdgesChange}
        onConnect={onConnect as any}
        isValidConnection={isValidConnection as any}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={viewport}
        onViewportChange={updateViewport}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDragStop={onNodeDragStopIntoGroup}
        deleteKeyCode={['Backspace', 'Delete']}
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
        className="bg-[#000000]"
      >
        <Background variant={BackgroundVariant.Dots} color="#555555" gap={16} size={1} />
        {minimapOpen && (
  <MiniMap
    style={{
      width: 160,
      height: 120,
      backgroundColor: 'rgb(50, 50, 50)',
      border: '0.5px solid rgb(70, 70, 70)',
      borderRadius: '8px',
    }}
    nodeColor={() => 'rgb(160, 160, 160)'}
    maskColor="rgba(0, 0, 0, 0.35)"
  />
)}
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
              color: enabled ? '#4ade80' : '#fff',
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
              onExecute={(groupId) => {
                const childIds = nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
                if (childIds.length > 0 && projectId) void executeGroupNodes(projectId, childIds);
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
