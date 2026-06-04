import { useState, useEffect } from 'react';
import { Modal } from 'antd';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import FolderInputModal from './FolderInputModal';
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

  const [createSubModalOpen, setCreateSubModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);

  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleDelete = () => {
    Modal.confirm({
      title: '删除文件夹',
      content: `确定删除文件夹"${folder.name}"及其所有子文件夹？此操作不可恢复。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteFolder(folder.id);
        } catch (e) {
          // error handled in store
        }
      },
    });
    onClose();
  };

  const items: { label: string; onClick: () => void; danger?: boolean }[] = [
    { label: '新建子文件夹', onClick: () => { setCreateSubModalOpen(true); } },
    { label: '重命名', onClick: () => { setRenameModalOpen(true); } },
    { label: '删除', onClick: handleDelete, danger: true },
    { label: '向上移动', onClick: () => { moveFolderUp(folder.id); onClose(); } },
  ];

  const adjustedX = Math.min(x, window.innerWidth - 160);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return (
    <>
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
      <FolderInputModal
        open={createSubModalOpen}
        title="新建子文件夹"
        defaultValue=""
        onOk={(value) => { createFolder(value, folder.id); setCreateSubModalOpen(false); }}
        onCancel={() => setCreateSubModalOpen(false)}
      />
      <FolderInputModal
        open={renameModalOpen}
        title="重命名"
        defaultValue={folder.name}
        onOk={(value) => { renameFolder(folder.id, value); setRenameModalOpen(false); }}
        onCancel={() => setRenameModalOpen(false)}
      />
    </>
  );
}
