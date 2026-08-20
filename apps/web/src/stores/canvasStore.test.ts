import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { AiToolId, ImageNodeData } from './nodeStore';

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

  it('should add an imageExt node as imageExtGen', () => {
    useCanvasStore.getState().addNode('imageExt', { x: 50, y: 60 });
    const s = useCanvasStore.getState();
    expect(s.nodes[0].type).toBe('imageExtGen');
  });

  it('imageExt node should have default mediaName "扩展图片"', () => {
    const nodeId = useCanvasStore.getState().addNode('imageExt', { x: 50, y: 60 });
    const nsNode = useNodeStore.getState().nodes[nodeId];
    expect((nsNode.data as ImageNodeData).mediaName).toBe('扩展图片');
  });

  it('copyNode should preserve imageExtGen type', () => {
    const id1 = useCanvasStore.getState().addNode('imageExt', { x: 50, y: 60 });
    const { copyNode } = useCanvasStore.getState() as any;
    const id2 = copyNode(id1);
    const copied = useCanvasStore.getState().nodes.find((n: any) => n.id === id2)!;
    expect(copied.type).toBe('imageExtGen');
    const nsCopied = useNodeStore.getState().nodes[id2];
    expect(nsCopied.type).toBe('imageExtGen');
  });

  it('addChildNodes should inherit imageExtGen type from parent', () => {
    const parentId = useCanvasStore.getState().addNode('imageExt', { x: 100, y: 100 });
    const { addChildNodes } = useCanvasStore.getState() as any;
    const childIds = addChildNodes(parentId, [{ data: { fileId: 'test' }, gridRow: 0, gridCol: 0 }]);
    const child = useCanvasStore.getState().nodes.find((n: any) => n.id === childIds[0])!;
    expect(child.type).toBe('imageExtGen');
    const nsChild = useNodeStore.getState().nodes[childIds[0]];
    expect(nsChild.type).toBe('imageExtGen');
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
  it('addNode text should set default width=300 height=300', () => {
    const nodeId = useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId)!;
    expect(node.width).toBe(300);
    expect(node.height).toBe(300);
  });

  it('addNode text should also populate nodeStore with width/height', () => {
    const nodeId = useCanvasStore.getState().addNode('text', { x: 100, y: 200 });
    const nsNode = useNodeStore.getState().nodes[nodeId];
    expect(nsNode.width).toBe(300);
    expect(nsNode.height).toBe(300);
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
      dimensions: { width: 400, height: 300 },
      setAttributes: true,
    } as any]);
    const node = useCanvasStore.getState().nodes.find(n => n.id === nodeId)!;
    expect(node.width).toBe(400);
    expect(node.height).toBe(300);
  });

  // ---- addNodeWithEdge ----

  it('addNodeWithEdge should create new node and edge from source', () => {
    const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    // Load source node with image data
    useNodeStore.getState().updateConfig(sourceId, { fileId: 'img-xyz', prompt: { text: '', html: '', allImages: [], referencedImageIds: [] } });

    const { addNodeWithEdge } = useCanvasStore.getState() as any;
    expect(typeof addNodeWithEdge).toBe('function');
    const newId = addNodeWithEdge(sourceId);

    const s = useCanvasStore.getState();
    // New node created
    const newNode = s.nodes.find((n: any) => n.id === newId)!;
    expect(newNode).toBeDefined();
    expect(newNode.position.x).not.toBe(100); // offset to the right of source
    expect(newNode.position.y).toBe(100); // same row (smart positioning places node to the right)

    // Edge created from source to new node
    const edge = s.edges.find((e: any) => e.source === sourceId && e.target === newId);
    expect(edge).toBeDefined();

    // Source node deselected, new node selected
    const sourceNode = s.nodes.find((n: any) => n.id === sourceId)!;
    expect(sourceNode.selected).toBeFalsy();
    expect(newNode.selected).toBe(true);
    expect(s.selectedId).toBe(newId);
  });

  it('addNodeWithEdge should set transformMode on new node', () => {
    const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    useNodeStore.getState().updateConfig(sourceId, { fileId: 'img-xyz' });

    const { addNodeWithEdge } = useCanvasStore.getState() as any;
    const newId = addNodeWithEdge(sourceId);

    const nsNode = useNodeStore.getState().nodes[newId];
    expect((nsNode.data as ImageNodeData).transformMode).toBe(true);
  });

  it('addNodeWithEdge should copy source node image data to new node', () => {
    const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    useNodeStore.getState().updateConfig(sourceId, { fileId: 'img-xyz' });

    const { addNodeWithEdge } = useCanvasStore.getState() as any;
    const newId = addNodeWithEdge(sourceId);

    const nsNode = useNodeStore.getState().nodes[newId];
    expect((nsNode.data as ImageNodeData).fileId).toBe('img-xyz');
  });

  // ── deleteTransformNode ──

  it('deleteTransformNode should remove node from nodes array', () => {
    const id = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === id)).toBe(true);

    (useCanvasStore.getState() as any).deleteTransformNode(id);
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === id)).toBe(false);
  });

  it('deleteTransformNode should remove connected edges', () => {
    const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    useNodeStore.getState().updateConfig(sourceId, { fileId: 'src-img' });
    const { addNodeWithEdge, deleteTransformNode } = useCanvasStore.getState() as any;
    const newId = addNodeWithEdge(sourceId);

    // Should have 1 edge before deletion
    expect(useCanvasStore.getState().edges.length).toBe(1);

    deleteTransformNode(newId);
    expect(useCanvasStore.getState().edges.length).toBe(0);
  });

  it('deleteTransformNode should clear selectedId if deleted node was selected', () => {
    const id = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    expect(useCanvasStore.getState().selectedId).toBe(id); // auto-selected on add

    (useCanvasStore.getState() as any).deleteTransformNode(id);
    expect(useCanvasStore.getState().selectedId).toBeNull();
  });

  it('deleteTransformNode should call nodeStore.deleteNode', () => {
    const id = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    const deleteNodeSpy = vi.spyOn(useNodeStore.getState(), 'deleteNode');

    (useCanvasStore.getState() as any).deleteTransformNode(id);
    expect(deleteNodeSpy).toHaveBeenCalledWith(id);
  });

  it('deleteTransformNode should call nodeStore.unregisterSaveHandler', () => {
    const id = useCanvasStore.getState().addNode('image', { x: 100, y: 100 });
    const unregisterSpy = vi.spyOn(useNodeStore.getState(), 'unregisterSaveHandler');

    (useCanvasStore.getState() as any).deleteTransformNode(id);
    expect(unregisterSpy).toHaveBeenCalledWith(id);
  });

  it('deleteTransformNode should noop for non-existent id', () => {
    expect(() => {
      (useCanvasStore.getState() as any).deleteTransformNode('nonexistent');
    }).not.toThrow();
  });

  it('setNodeDraggable should update node draggable flag', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
    useCanvasStore.getState().setNodeDraggable(nodeId, false);
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    expect(node?.draggable).toBe(false);
  });

  it('setNodeDraggable(true) should restore draggable', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
    useCanvasStore.getState().setNodeDraggable(nodeId, false);
    useCanvasStore.getState().setNodeDraggable(nodeId, true);
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    expect(node?.draggable).toBe(true);
  });

  // ── addNode dataOverride ──

  it('addNode with dataOverride should merge custom data into node data', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 100, y: 100 }, { fileId: 'x', status: 'done' });
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)!;
    expect(node.data.fileId).toBe('x');
    expect(node.data.status).toBe('done');
  });

  it('addNode with dataOverride for video should include fileId', () => {
    const nodeId = useCanvasStore.getState().addNode('video', { x: 0, y: 0 }, { fileId: 'vid-1' });
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)!;
    expect(node.data.fileId).toBe('vid-1');
  });

  it('addNode without dataOverride should produce empty data (backward compat)', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 10, y: 10 });
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)!;
    expect(node.data).toEqual({});
  });

  it('addNode with dataOverride should also populate nodeStore with custom data', () => {
    const nodeId = useCanvasStore.getState().addNode('image', { x: 50, y: 50 }, { fileId: 'abc', status: 'done' });
    const nsNode = useNodeStore.getState().nodes[nodeId];
    expect(nsNode).toBeDefined();
    expect((nsNode.data as ImageNodeData).fileId).toBe('abc');
    expect((nsNode.data as ImageNodeData).status).toBe('done');
  });

  // ── pendingMediaFile / requestAddMediaNode ──

  it('should start with null pendingMediaFile', () => {
    expect(useCanvasStore.getState().pendingMediaFile).toBeNull();
  });

  it('requestAddMediaNode should set pendingMediaFile', () => {
    const file = { id: 'f1', originalName: 'test.png', mimeType: 'image/png', size: 100, createdAt: '2026-01-01', updatedAt: '2026-01-01', isFavorite: false, folderId: null };
    useCanvasStore.getState().requestAddMediaNode(file as any);
    expect(useCanvasStore.getState().pendingMediaFile).toEqual(file);
  });

  it('requestAddMediaNode should overwrite previous pending file', () => {
    const file1 = { id: 'f1', originalName: 'a.png', mimeType: 'image/png', size: 100, createdAt: '2026-01-01', updatedAt: '2026-01-01', isFavorite: false, folderId: null };
    const file2 = { id: 'f2', originalName: 'b.mp4', mimeType: 'video/mp4', size: 200, createdAt: '2026-01-02', updatedAt: '2026-01-02', isFavorite: true, folderId: null };
    useCanvasStore.getState().requestAddMediaNode(file1 as any);
    useCanvasStore.getState().requestAddMediaNode(file2 as any);
    expect(useCanvasStore.getState().pendingMediaFile?.id).toBe('f2');
  });

  // ══════════════════════════════════════════════════════
  // ── ImageExtNode: extConfig defaults, copy, split ──
  // ══════════════════════════════════════════════════════

  describe('imageExtGen — extConfig initialization', () => {
    it('addNode("imageExt") should inject extConfig with default values', () => {
      const nodeId = useCanvasStore.getState().addNode('imageExt', { x: 50, y: 60 });
      const nsNode = useNodeStore.getState().nodes[nodeId];
      expect((nsNode.data as ImageNodeData).extConfig).toBeDefined();
      expect((nsNode.data as ImageNodeData).extConfig!.ratio).toBe('16:9');
      expect((nsNode.data as ImageNodeData).extConfig!.resolution).toBe('2K');
      expect((nsNode.data as ImageNodeData).extConfig!.quality).toBe('standard');
      expect((nsNode.data as ImageNodeData).extConfig!.generateCount).toBe(1);
    });

    it('addNode("imageExt") should include allImages: [] at root level', () => {
      const nodeId = useCanvasStore.getState().addNode('imageExt', { x: 50, y: 60 });
      const nsNode = useNodeStore.getState().nodes[nodeId];
      expect((nsNode.data as ImageNodeData).allImages).toEqual([]);
    });

    it('addNode("image") should NOT include extConfig', () => {
      const nodeId = useCanvasStore.getState().addNode('image', { x: 10, y: 10 });
      const nsNode = useNodeStore.getState().nodes[nodeId];
      expect((nsNode.data as ImageNodeData).extConfig).toBeUndefined();
    });

    it('copyNode should preserve extConfig completely for imageExt node', () => {
      const id1 = useCanvasStore.getState().addNode('imageExt', { x: 50, y: 60 }, {
        extConfig: { model: 'custom-ext-model', ratio: '9:16', resolution: '4K', quality: 'high', generateCount: 4 },
      });

      const { copyNode } = useCanvasStore.getState() as any;
      const id2 = copyNode(id1);
      const nsCopied = useNodeStore.getState().nodes[id2];
      expect(nsCopied.type).toBe('imageExtGen');
      expect((nsCopied.data as ImageNodeData).extConfig).toBeDefined();
      expect((nsCopied.data as ImageNodeData).extConfig!.model).toBe('custom-ext-model');
      expect((nsCopied.data as ImageNodeData).extConfig!.generateCount).toBe(4);
      expect((nsCopied.data as ImageNodeData).extConfig!.ratio).toBe('9:16');
    });
  });

  // ── createDerivedExtNode ──

  describe('createDerivedExtNode', () => {
    it('should create a new imageExtGen node to the right of the source', () => {
      useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
      useNodeStore.setState({ nodes: {} });

      const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
      const refImg = { id: 'file-123', url: 'https://example.com/img.png', name: 'test.png', status: 'success' as const };
      const result = useCanvasStore.getState().createDerivedExtNode({
        sourceNodeId: sourceId,
        allImages: [refImg],
        aiTool: 'nine_camera' as AiToolId,
      });

      expect(result).toBeTruthy();
      const s = useCanvasStore.getState();
      const newNode = s.nodes.find((n: any) => n.id === result);
      expect(newNode).toBeTruthy();
      expect(newNode!.type).toBe('imageExtGen');
      // Position: 100 + 300 (default width) + 80 = 480
      expect(newNode!.position.x).toBe(480);
      expect(newNode!.position.y).toBe(200);

      // nodeStore data
      const nsNode = useNodeStore.getState().nodes[result!];
      expect((nsNode.data as ImageNodeData).aiTool).toBe('nine_camera');
      expect((nsNode.data as ImageNodeData).allImages).toEqual([refImg]);
    });

    it('should create an edge from source to new node', () => {
      useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
      useNodeStore.setState({ nodes: {} });

      const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
      const result = useCanvasStore.getState().createDerivedExtNode({
        sourceNodeId: sourceId,
        allImages: [],
        aiTool: 'four_panel' as AiToolId,
      });

      const s = useCanvasStore.getState();
      const edge = s.edges.find((e: any) => e.source === sourceId && e.target === result);
      expect(edge).toBeTruthy();
    });

    it('should select the new node', () => {
      useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
      useNodeStore.setState({ nodes: {} });

      const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
      const result = useCanvasStore.getState().createDerivedExtNode({
        sourceNodeId: sourceId,
        allImages: [],
        aiTool: 'four_panel' as AiToolId,
      });

      const s = useCanvasStore.getState();
      expect(s.selectedId).toBe(result);
    });

    it('should return null for non-existent source node', () => {
      const result = useCanvasStore.getState().createDerivedExtNode({
        sourceNodeId: 'nonexistent',
        allImages: [],
        aiTool: 'nine_camera' as AiToolId,
      });
      expect(result).toBeNull();
    });

    it('should initialize allImages as empty array when no referenceImage', () => {
      useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
      useNodeStore.setState({ nodes: {} });

      const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
      const result = useCanvasStore.getState().createDerivedExtNode({
        sourceNodeId: sourceId,
        allImages: [],
        aiTool: 'nine_camera' as AiToolId,
      });

      const nsNode = useNodeStore.getState().nodes[result!];
      expect((nsNode.data as ImageNodeData).allImages).toEqual([]);
    });

    it('should initialize extConfig with defaults', () => {
      useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
      useNodeStore.setState({ nodes: {} });

      const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
      const result = useCanvasStore.getState().createDerivedExtNode({
        sourceNodeId: sourceId,
        allImages: [],
        aiTool: 'nine_camera' as AiToolId,
      });

      const nsNode = useNodeStore.getState().nodes[result!];
      expect((nsNode.data as ImageNodeData).extConfig).toBeDefined();
      expect((nsNode.data as ImageNodeData).extConfig!.ratio).toBe('16:9');
      expect((nsNode.data as ImageNodeData).extConfig!.resolution).toBe('2K');
    });
  });

  describe('projectId', () => {
    it('should initialize projectId as null', () => {
      expect(useCanvasStore.getState().projectId).toBeNull();
    });

    it('should set and get projectId', () => {
      useCanvasStore.getState().setProjectId('cmr-test-123');
      expect(useCanvasStore.getState().projectId).toBe('cmr-test-123');
    });

    it('should allow setting projectId to different values', () => {
      useCanvasStore.getState().setProjectId('first-id');
      expect(useCanvasStore.getState().projectId).toBe('first-id');
      useCanvasStore.getState().setProjectId('second-id');
      expect(useCanvasStore.getState().projectId).toBe('second-id');
    });
  });
});
