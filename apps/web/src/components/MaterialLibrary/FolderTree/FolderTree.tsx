import React from 'react';
import { Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFolder } from '@flowweb/shared';

function buildTree(folders: MaterialFolder[], parentId: string | null = null): TreeDataNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({
      key: f.id,
      title: f.name,
      children: buildTree(folders, f.id),
    }));
}

/** Determine if a drop target is valid */
export function canDrop(
  folders: MaterialFolder[],
  dragKey: string,
  dropKey: string,
  dropPosition: -1 | 0 | 1,
): boolean {
  if (dragKey === dropKey) return false;
  void folders;
  void dropPosition;
  return true;
}

/**
 * Compute parentId and afterId from drag-and-drop event data.
 *
 * Uses mouse position relative to the target DOM element to determine
 * whether the drop is "into" (middle 50%), "above" (top 25%), or "below" (bottom 25%).
 * This bypasses rc-tree's complex dropPosition logic which doesn't reliably detect
 * "drop into" for folders without children.
 */
export function computeDropParams(
  folders: MaterialFolder[],
  dragKey: string,
  targetKey: string,
  event: { clientY: number; target: EventTarget | null },
): { parentId: string | null; afterId: string | null } {
  const targetEl = (event.target as HTMLElement)?.getBoundingClientRect?.();
  const clientY = event.clientY;

  if (targetEl && clientY !== undefined) {
    const relativeY = clientY - targetEl.top;
    const ratio = relativeY / targetEl.height;

    // Middle 50% → drop INTO the folder (make it a child)
    if (ratio > 0.25 && ratio < 0.75) {
      return { parentId: targetKey, afterId: null };
    }

    // Top 25% → drop ABOVE the target
    if (ratio <= 0.25) {
      const targetFolder = folders.find((f) => f.id === targetKey);
      const parentId = targetFolder?.parentId ?? null;
      const siblings = folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const targetIdx = siblings.findIndex((f) => f.id === targetKey);
      return { parentId, afterId: targetIdx > 0 ? siblings[targetIdx - 1].id : null };
    }
  }

  // Bottom 25% (or fallback) → drop BELOW the target
  const targetFolder = folders.find((f) => f.id === targetKey);
  const parentId = targetFolder?.parentId ?? null;
  const siblings = folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const targetIdx = siblings.findIndex((f) => f.id === targetKey);
  return { parentId, afterId: targetIdx >= 0 ? siblings[targetIdx]?.id ?? targetKey : targetKey };
}

export default function FolderTree() {
  const folders = useMaterialLibraryStore((s) => s.folders);
  const selectedFolderId = useMaterialLibraryStore((s) => s.selectedFolderId);
  const setSelectedFolder = useMaterialLibraryStore((s) => s.setSelectedFolder);

  const treeData = buildTree(folders);

  // Track drag-over state for visual feedback
  const dragStateRef = React.useRef<{
    targetEl: HTMLElement | null;
    cleanup: (() => void) | null;
  }>({ targetEl: null, cleanup: null });

  const handleDragOver = React.useCallback((info: any) => {
    const { event } = info;
    // Find the treenode DOM element
    const treenodeEl = (event.target as HTMLElement)?.closest?.('.ant-tree-treenode') as HTMLElement | null;
    if (!treenodeEl) return;

    const rect = treenodeEl.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const ratio = relativeY / rect.height;
    const isIntoZone = ratio > 0.25 && ratio < 0.75;

    // Clean up previous state if hovering a different node
    if (dragStateRef.current.targetEl !== treenodeEl) {
      dragStateRef.current.cleanup?.();
      dragStateRef.current.targetEl = treenodeEl;
      dragStateRef.current.cleanup = null;
    }

    if (isIntoZone) {
      if (!dragStateRef.current.cleanup) {
        treenodeEl.classList.add('drop-into-highlight');
        dragStateRef.current.cleanup = () => treenodeEl.classList.remove('drop-into-highlight');
      }
    } else {
      dragStateRef.current.cleanup?.();
      dragStateRef.current.cleanup = null;
    }
  }, []);

  const handleDragEnd = React.useCallback(() => {
    dragStateRef.current.cleanup?.();
    dragStateRef.current.cleanup = null;
    dragStateRef.current.targetEl = null;
  }, []);

  return (
    <div className="folder-tree-container">
      <div className="sidebar-header">
        <button className="new-folder-btn" onClick={() => {
          const name = prompt('请输入文件夹名称');
          if (name) useMaterialLibraryStore.getState().createFolder(name);
        }}>
          + 新建文件夹
        </button>
      </div>
      <Tree
        className="draggable-folder-tree"
        showLine
        defaultExpandAll
        draggable
        allowDrop={({ dragNode, dropNode, dropPosition }) =>
          canDrop(folders, dragNode.key as string, dropNode.key as string, dropPosition)
        }
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDrop={(info) => {
          // Clean up highlight
          handleDragEnd();
          // eslint-disable-next-line no-console
          console.log('[FolderTree onDrop]', {
            dragKey: info.dragNode.key,
            targetKey: info.node.key,
            dragName: (info.dragNode as any).title,
            targetName: (info.node as any).title,
          });
          const params = computeDropParams(
            folders,
            info.dragNode.key as string,
            info.node.key as string,
            info.event,
          );
          // eslint-disable-next-line no-console
          console.log('[FolderTree onDrop] computed params:', params);
          useMaterialLibraryStore.getState().moveFolder(
            info.dragNode.key as string,
            params,
          );
        }}
        selectedKeys={selectedFolderId ? [selectedFolderId] : []}
        onSelect={(keys) => {
          const folderId = keys[0] as string || null;
          setSelectedFolder(folderId);
          useMaterialLibraryStore.getState().loadFiles();
        }}
        treeData={treeData}
      />
    </div>
  );
}
