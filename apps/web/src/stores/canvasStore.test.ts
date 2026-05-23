import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

describe('canvasStore', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selectedId: null });
    useNodeStore.setState({ nodes: {} });
  });

  it('should initialize with empty canvas', () => {
    const s = useCanvasStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.viewport.zoom).toBe(1);
    expect(s.selectedId).toBeNull();
  });

  it('should add a node', () => {
    useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    const s = useCanvasStore.getState();
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0].type).toBe('textInput');
    expect(s.nodes[0].position).toEqual({ x: 100, y: 200 });
  });

  it('should add an image node', () => {
    useCanvasStore.getState().addNode('image', { x: 50, y: 60 });
    const s = useCanvasStore.getState();
    expect(s.nodes[0].type).toBe('imageGen');
  });

  it('should add a video node', () => {
    useCanvasStore.getState().addNode('video', { x: 10, y: 20 });
    const s = useCanvasStore.getState();
    expect(s.nodes[0].type).toBe('videoGen');
  });

  it('should select a node by id', () => {
    const { addNode, selectNode } = useCanvasStore.getState();
    const nodeId = addNode('text', { x: 0, y: 0 });
    selectNode(nodeId);
    expect(useCanvasStore.getState().selectedId).toBe(nodeId);
  });

  it('should auto-select newly added node (selectedId + selected flag)', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 10, y: 10 });
    const s = useCanvasStore.getState();
    expect(s.selectedId).toBe(nodeId);
    expect(s.nodes[0].selected).toBe(true);
  });

  it('should auto-select newly added video node', () => {
    const nodeId = useCanvasStore.getState().addNode('video', { x: 20, y: 20 });
    const s = useCanvasStore.getState();
    expect(s.selectedId).toBe(nodeId);
    expect(s.nodes[0].selected).toBe(true);
  });

  it('should deselect when id is null', () => {
    useCanvasStore.getState().selectNode(null);
    expect(useCanvasStore.getState().selectedId).toBeNull();
  });

  it('should delete a node and related edges', () => {
    const { addNode, deleteNode } = useCanvasStore.getState();
    const nodeId = addNode('text', { x: 0, y: 0 });
    deleteNode(nodeId);
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });

  it('should update viewport', () => {
    useCanvasStore.getState().updateViewport({ x: 10, y: 20, zoom: 1.5 });
    const s = useCanvasStore.getState();
    expect(s.viewport.zoom).toBe(1.5);
  });

  it('should handle onNodesChange for position update', () => {
    const { addNode, onNodesChange } = useCanvasStore.getState();
    const nodeId = addNode('text', { x: 100, y: 200 });

    onNodesChange([{ type: 'position', id: nodeId, position: { x: 300, y: 400 } }]);
    const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId);
    expect(node).toBeDefined();
    expect(node!.position).toEqual({ x: 300, y: 400 });
  });

  it('should handle onEdgesChange for removal', () => {
    useCanvasStore.setState({
      edges: [{ id: 'e1', source: 'n1', target: 'n2' } as any],
    });
    useCanvasStore.getState().onEdgesChange([{ type: 'remove', id: 'e1' }]);
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });

  it('should handle onConnect to create edge', () => {
    const { onConnect } = useCanvasStore.getState();
    onConnect({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null });
    const edges = useCanvasStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('n1');
    expect(edges[0].target).toBe('n2');
  });

  it('addNode should also populate nodeStore so ImageConfigPanel can read node data', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 50, y: 60 });
    const node = useNodeStore.getState().nodes[nodeId];
    expect(node).toBeDefined();
    expect(node.type).toBe('imageGen');
    expect(node.position).toEqual({ x: 50, y: 60 });
  });
});
