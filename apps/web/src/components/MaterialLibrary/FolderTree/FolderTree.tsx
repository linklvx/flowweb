import React, { useState } from 'react';
import { Tree, Input } from 'antd';
import type { TreeDataNode } from 'antd';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import FolderInputModal from './FolderInputModal';
import FolderContextMenu from './FolderContextMenu';
import type { MaterialFolder } from '@flowweb/shared';

interface InlineEditState {
  folderId: string;
  defaultValue: string;
}

function buildTree(
  folders: MaterialFolder[],
  parentId: string | null = null,
  onDoubleClick?: (id: string, name: string) => void,
  onContextMenu?: (id: string, name: string, e: React.MouseEvent) => void,
  editingFolderId?: string | null,
  inlineEditProps?: {
    defaultValue: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  },
): TreeDataNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => {
      const isEditing = f.id === editingFolderId && inlineEditProps;
      return {
        key: f.id,
        title: isEditing ? (
          <InlineEditInput
            defaultValue={inlineEditProps!.defaultValue}
            onConfirm={inlineEditProps!.onConfirm}
            onCancel={inlineEditProps!.onCancel}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              onDoubleClick?.(f.id, f.name);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu?.(f.id, f.name, e);
            }}
          >
            {f.name}
          </span>
        ),
        children: buildTree(folders, f.id, onDoubleClick, onContextMenu, editingFolderId, inlineEditProps),
      };
    });
}

function InlineEditInput({ defaultValue, onConfirm, onCancel }: {
  defaultValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = React.useRef<any>(null);

  React.useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={onCancel}
      size="small"
      style={{ width: 120 }}
      maxLength={50}
      onClick={(e) => e.stopPropagation()}
    />
  );
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
  const renameFolder = useMaterialLibraryStore((s) => s.renameFolder);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder: MaterialFolder } | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => folders.map((f) => f.id));

  const startInlineEdit = React.useCallback((folderId: string, defaultValue: string) => {
    setInlineEdit({ folderId, defaultValue });
  }, []);

  const cancelInlineEdit = React.useCallback(() => {
    setInlineEdit(null);
  }, []);

  const confirmInlineEdit = React.useCallback((value: string) => {
    if (!inlineEdit) return;
    renameFolder(inlineEdit.folderId, value);
    setInlineEdit(null);
  }, [inlineEdit, renameFolder]);

  const handleDoubleClick = React.useCallback((id: string, name: string) => {
    startInlineEdit(id, name);
  }, [startInlineEdit]);

  const handleContextMenu = React.useCallback((id: string, _name: string, e: React.MouseEvent) => {
    const folder = folders.find((f) => f.id === id);
    if (folder) {
      setContextMenu({ x: e.clientX, y: e.clientY, folder });
    }
  }, [folders]);

  const handleCreateSub = React.useCallback(async (parentFolder: MaterialFolder) => {
    let tempName = '新建文件夹';
    const parentKey = parentFolder.id;
    const siblings = folders.filter((f) => (f.parentId ?? null) === parentKey);
    let counter = 1;
    while (siblings.some((f) => f.name === tempName)) {
      tempName = `新建文件夹 ${counter}`;
      counter++;
    }
    await useMaterialLibraryStore.getState().createFolder(tempName, parentKey);
    const updated = useMaterialLibraryStore.getState().folders;
    const newFolder = updated.find(
      (f) => f.name === tempName && (f.parentId ?? null) === parentKey,
    );
    if (newFolder) {
      setExpandedKeys((prev) => prev.includes(parentKey) ? prev : [...prev, parentKey]);
      startInlineEdit(newFolder.id, '');
    }
  }, [folders, startInlineEdit]);

  const inlineEditProps = inlineEdit ? {
    defaultValue: inlineEdit.defaultValue,
    onConfirm: confirmInlineEdit,
    onCancel: cancelInlineEdit,
  } : undefined;

  const treeData = buildTree(
    folders, null, handleDoubleClick, handleContextMenu,
    inlineEdit?.folderId, inlineEditProps,
  );

  // Track drag-over state for visual feedback
  const dragStateRef = React.useRef<{
    targetEl: HTMLElement | null;
    cleanup: (() => void) | null;
  }>({ targetEl: null, cleanup: null });

  const handleDragOver = React.useCallback((info: any) => {
    const { event } = info;
    const treenodeEl = (event.target as HTMLElement)?.closest?.('.ant-tree-treenode') as HTMLElement | null;
    if (!treenodeEl) return;

    const rect = treenodeEl.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const ratio = relativeY / rect.height;
    const isIntoZone = ratio > 0.25 && ratio < 0.75;

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
        <button className="new-folder-btn" onClick={() => setCreateModalOpen(true)}>
          + 新建文件夹
        </button>
      </div>
      <Tree
        className="draggable-folder-tree"
        showLine
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys as string[])}
        draggable
        allowDrop={({ dragNode, dropNode, dropPosition }) =>
          canDrop(folders, dragNode.key as string, dropNode.key as string, dropPosition)
        }
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDrop={(info) => {
          handleDragEnd();
          const params = computeDropParams(
            folders,
            info.dragNode.key as string,
            info.node.key as string,
            info.event,
          );
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
      <FolderInputModal
        open={createModalOpen}
        title="新建文件夹"
        defaultValue=""
        onOk={(value) => { useMaterialLibraryStore.getState().createFolder(value); setCreateModalOpen(false); }}
        onCancel={() => setCreateModalOpen(false)}
      />
      {contextMenu && (
        <FolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          folder={contextMenu.folder}
          onClose={() => setContextMenu(null)}
          onCreateSub={() => handleCreateSub(contextMenu.folder)}
          onRename={() => startInlineEdit(contextMenu.folder.id, contextMenu.folder.name)}
        />
      )}
    </div>
  );
}
