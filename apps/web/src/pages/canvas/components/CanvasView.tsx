import { memo, useCallback, useMemo, useRef, useState, useEffect, type DragEvent } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, MiniMap,
  useReactFlow,
  type Connection,
  type NodeTypes, type OnNodesChange, type OnEdgesChange,
  type NodeChange, type NodeDimensionChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { debounce } from '@/utils/debounce';
import { TextInputNode } from './nodes/TextInputNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { AudioGenNode } from './nodes/AudioGenNode';
import { MultiImageNode } from './nodes/MultiImageNode';
import { ConnectionLine } from './edges/ConnectionLine';
import { CanvasToolbar } from './CanvasToolbar';

const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  audioGen: AudioGenNode,
  multiImageGen: MultiImageNode,
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
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const updateViewport = useCanvasStore((s) => s.updateViewport);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);

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
    selectNode(node.id);
  }, [selectNode]);

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

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
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn({ duration: 100 });
        else zoomOut({ duration: 100 });
      }
    };
    // non-capture: fires after React Flow's internal handlers, avoids interference
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomIn, zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  return (
    <div ref={reactFlowWrapper} className="w-full h-full">
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
        onPaneClick={onPaneClick}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        minZoom={0.2}
        maxZoom={3}
        fitView={false}
        zoomOnScroll={false}
        panOnScroll={true}
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
      </ReactFlow>
      {/* 工具条 Portal 挂载点：最高层级，不拦截鼠标事件 */}
      <div
        id="node-toolbar-portal"
        className="absolute inset-0 pointer-events-none z-[99999]"
      />
    </div>
  );
}

export const CanvasView = memo(CanvasViewComponent);
