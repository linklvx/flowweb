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
  const draggedFolder = folders.find((f) => f.id === dragKey);
  if (draggedFolder?.isDefault) return false;
  // If dropping INSIDE a node (making it a child), reject if target is default
  if (dropPosition === 0) {
    const targetFolder = folders.find((f) => f.id === dropKey);
    if (targetFolder?.isDefault) return false;
  }
  return true;
}

/** Compute parentId and afterId from drag-and-drop event data */
export function computeDropParams(
  folders: MaterialFolder[],
  dragKey: string,
  targetKey: string,
  dropPosition: -1 | 0 | 1,
  dropToGap: boolean,
): { parentId: string | null; afterId: string | null } {
  if (!dropToGap && dropPosition === 0) {
    // Drop INTO a folder: becomes child, append at end
    return { parentId: targetKey, afterId: null };
  }

  // Drop above/below a sibling
  const targetFolder = folders.find((f) => f.id === targetKey);
  const parentId = targetFolder?.parentId ?? null;
  const siblings = folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const targetIdx = siblings.findIndex((f) => f.id === targetKey);

  if (dropPosition === -1) {
    // Above: afterId = the sibling just before target
    return { parentId, afterId: targetIdx > 0 ? siblings[targetIdx - 1].id : null };
  }
  // Below: afterId = target itself
  return { parentId, afterId: targetKey };
}

export default function FolderTree() {
  const folders = useMaterialLibraryStore((s) => s.folders);
  const selectedFolderId = useMaterialLibraryStore((s) => s.selectedFolderId);
  const setSelectedFolder = useMaterialLibraryStore((s) => s.setSelectedFolder);

  const treeData = buildTree(folders);

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
        draggable={(node) => {
          const folder = folders.find((f) => f.id === node.key);
          return !folder?.isDefault;
        }}
        allowDrop={({ dragNode, dropNode, dropPosition }) =>
          canDrop(folders, dragNode.key as string, dropNode.key as string, dropPosition)
        }
        onDrop={({ node, dragNode, dropPosition, dropToGap }) => {
          const params = computeDropParams(
            folders,
            dragNode.key as string,
            node.key as string,
            dropPosition,
            dropToGap,
          );
          useMaterialLibraryStore.getState().moveFolder(
            dragNode.key as string,
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
