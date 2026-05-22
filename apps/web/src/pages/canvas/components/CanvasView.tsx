import { memo, useCallback, useRef, useEffect, type DragEvent } from 'react';
import {
  ReactFlow, Background, BackgroundVariant,
  useReactFlow,
  type Connection,
  type NodeTypes, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { TextInputNode } from './nodes/TextInputNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { ConnectionLine } from './edges/ConnectionLine';
import { CanvasToolbar } from './CanvasToolbar';

const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
} as any;

const edgeTypes: any = {
  default: ConnectionLine,
};

interface Props {
  projectId: string;
}

function CanvasViewComponent({ projectId: _projectId }: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const updateViewport = useCanvasStore((s) => s.updateViewport);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);

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

  const fitView = useCallback(() => {
    updateViewport({ x: 0, y: 0, zoom: 1 });
  }, [updateViewport]);

  return (
    <div ref={reactFlowWrapper} className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange as OnNodesChange}
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
        noWheelClassName="nowheel"
        proOptions={{ hideAttribution: true }}
        className="bg-[#000000]"
      >
        <Background variant={BackgroundVariant.Dots} color="#555555" gap={16} size={1} />
        <CanvasToolbar zoom={viewport.zoom} onFitView={fitView} />
      </ReactFlow>
    </div>
  );
}

export const CanvasView = memo(CanvasViewComponent);
