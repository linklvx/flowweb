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

  it('should deselect previous node when adding a new one (only newest is selected)', () => {
    useCanvasStore.getState().addNode('image', { x: 10, y: 10 });
    useCanvasStore.getState().addNode('text', { x: 200, y: 200 });

    const s = useCanvasStore.getState();
    expect(s.nodes).toHaveLength(2);

    // First node should NOT be selected
    expect(s.nodes[0].selected).toBeFalsy();
    // Second node (latest) should be selected
    expect(s.nodes[1].selected).toBe(true);
    // selectedId points to the latest
    expect(s.selectedId).toBe(s.nodes[1].id);
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

  // Task 3: Resize — text node default dimensions
  it('addNode text should set default width=280 height=120', () => {
    const nodeId = useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId)!;
    expect(node.width).toBe(280);
    expect(node.height).toBe(120);
  });

  it('addNode text should also populate nodeStore with width/height', () => {
    const nodeId = useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    const nsNode = useNodeStore.getState().nodes[nodeId];
    expect(nsNode.width).toBe(280);
    expect(nsNode.height).toBe(120);
  });

  it('copyNode should copy width and height from original node', () => {
    const id1 = useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    // Manually set custom dimensions to simulate a resized node
    useCanvasStore.setState(s => ({
      nodes: s.nodes.map(n => n.id === id1 ? { ...n, width: 500, height: 300 } : n),
    }));
    // copyNode must exist on the store
    const { copyNode } = useCanvasStore.getState() as any;
    expect(typeof copyNode).toBe('function');
    const id2 = copyNode(id1);
    const copied = useCanvasStore.getState().nodes.find((n: any) => n.id === id2)!;
    expect(copied.width).toBe(500);
    expect(copied.height).toBe(300);
  });

  it('copyNode should pass width/height to nodeStore', () => {
    const id1 = useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    useCanvasStore.setState(s => ({
      nodes: s.nodes.map(n => n.id === id1 ? { ...n, width: 600, height: 400 } : n),
    }));
    const { copyNode } = useCanvasStore.getState() as any;
    const id2 = copyNode(id1);
    const nsNode = useNodeStore.getState().nodes[id2];
    expect(nsNode.width).toBe(600);
    expect(nsNode.height).toBe(400);
  });

  it('onNodesChange should apply dimensions changes with setAttributes', () => {
    const { addNode, onNodesChange } = useCanvasStore.getState();
    const nodeId = addNode('text', { x: 0, y: 0 });
    onNodesChange([{
      type: 'dimensions',
      id: nodeId,
      dimensions: { width: 400, height: 250 },
      setAttributes: true,
    } as any]);
    const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId)!;
    expect(node.width).toBe(400);
    expect(node.height).toBe(250);
  });
});
