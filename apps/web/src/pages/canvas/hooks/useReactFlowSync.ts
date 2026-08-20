import { useEffect, useMemo, useRef } from 'react';
import { useNodesState, type Node, type NodeChange } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';

// ---------------------------------------------------------------------------
// Pure functions (extracted for testability and clarity)
// ---------------------------------------------------------------------------

/** Maps a store node record to a React Flow node array. */
function nodesToReactFlow(storeNodeMap: Record<string, any>): any[] {
  return Object.values(storeNodeMap).map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data,
    selected: node.selected,
    dragging: node.dragging,
  }));
}

/** Applies a single NodeChange to the store (position, select, remove). */
function applyChangeToStore(
  change: NodeChange,
  storeNodes: Record<string, any>,
  updateNodeData: (id: string, data: any) => void,
  deleteNode: (id: string) => Promise<void>,
): void {
  if (change.type === 'position' && change.id && change.position) {
    const node = storeNodes[change.id];
    if (node) updateNodeData(change.id, { position: change.position } as any);
  }
  if (change.type === 'select' && change.id) {
    updateNodeData(change.id, { selected: change.selected } as any);
  }
  if (change.type === 'remove' && change.id) {
    deleteNode(change.id);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReactFlowSync() {
  const [reactFlowNodes, setReactFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const storeNodes = useNodeStore((state) => state.nodes);
  const updateNodeData = useNodeStore((state) => state.updateNodeData);
  const deleteNode = useNodeStore((state) => state.deleteNode);

  const prevStoreNodesRef = useRef<string>('');
  const isUpdatingFromStoreRef = useRef(false);

  // Memoize the mapped nodes so the mapping only re-runs when storeNodes changes
  const derivedNodes = useMemo(
    () => nodesToReactFlow(storeNodes),
    [storeNodes],
  );

  // Store → ReactFlow (one-way sync)
  useEffect(() => {
    const serialized = JSON.stringify(storeNodes);
    if (serialized === prevStoreNodesRef.current) return;
    prevStoreNodesRef.current = serialized;
    isUpdatingFromStoreRef.current = true;

    setReactFlowNodes(derivedNodes);

    setTimeout(() => {
      isUpdatingFromStoreRef.current = false;
    }, 0);
  }, [storeNodes, setReactFlowNodes, derivedNodes]);

  // ReactFlow → Store (system fields only: position, selected, remove)
  const handleNodesChange = (changes: NodeChange[]) => {
    onNodesChange(changes);
    if (isUpdatingFromStoreRef.current) return;

    for (const change of changes) {
      try {
        applyChangeToStore(change, storeNodes, updateNodeData, deleteNode);
      } catch (err) {
        console.error('[useReactFlowSync] error handling change:', change, err);
      }
    }
  };

  return { reactFlowNodes, handleNodesChange };
}
