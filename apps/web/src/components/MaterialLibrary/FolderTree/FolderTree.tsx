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
        showLine
        defaultExpandAll
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
