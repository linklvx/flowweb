import { useEffect } from 'react';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFolder } from '@flowweb/shared';

interface Props {
  x: number;
  y: number;
  folder: MaterialFolder;
  onClose: () => void;
}

export default function FolderContextMenu({ x, y, folder, onClose }: Props) {
  const createFolder = useMaterialLibraryStore((s) => s.createFolder);
  const renameFolder = useMaterialLibraryStore((s) => s.renameFolder);
  const deleteFolder = useMaterialLibraryStore((s) => s.deleteFolder);
  const moveFolderUp = useMaterialLibraryStore((s) => s.moveFolderUp);

  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleCreateSub = () => {
    const name = prompt('请输入子文件夹名称');
    if (name) createFolder(name, folder.id);
    onClose();
  };

  const handleRename = () => {
    const name = prompt('请输入新名称', folder.name);
    if (name && name !== folder.name) renameFolder(folder.id, name);
    onClose();
  };

  const handleDelete = () => {
    if (confirm(`确定删除文件夹"${folder.name}"？`)) deleteFolder(folder.id);
    onClose();
  };

  const items: { label: string; onClick: () => void; danger?: boolean }[] = [
    { label: '新建子文件夹', onClick: handleCreateSub },
  ];
  if (!folder.isDefault) {
    items.push(
      { label: '重命名', onClick: handleRename },
      { label: '删除', onClick: handleDelete, danger: true },
      { label: '向上移动', onClick: () => { moveFolderUp(folder.id); onClose(); } },
    );
  }

  // Prevent menu from overflowing viewport edges
  const adjustedX = Math.min(x, window.innerWidth - 160);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return (
    <div className="fixed z-50 bg-[#2a2a2a] border border-[#444] rounded-lg py-1 shadow-lg"
      style={{ left: adjustedX, top: adjustedY, minWidth: 140 }}>
      {items.map((item) => (
        <button key={item.label}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#333] transition-colors ${item.danger ? 'text-red-400' : 'text-gray-200'}`}
          onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
