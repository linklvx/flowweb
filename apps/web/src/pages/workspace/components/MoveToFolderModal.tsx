import { useEffect, useState } from 'react';
import { Modal } from 'antd';
import type { Folder } from '../types';

interface MoveToFolderModalProps {
  open: boolean;
  folders: Folder[];
  currentFolderId: string | null; // 画布当前所在文件夹
  onOk: (folderId: string | null) => void;
  onCancel: () => void;
}

export function MoveToFolderModal({ open, folders, currentFolderId, onOk, onCancel }: MoveToFolderModalProps) {
  const [selected, setSelected] = useState<string | null>(currentFolderId);
  useEffect(() => { if (open) setSelected(currentFolderId); }, [open, currentFolderId]);

  const Row = ({ id, label }: { id: string | null; label: string }) => {
    const isCurrent = id === currentFolderId;
    const isSelected = selected === id;
    return (
      <div
        onClick={() => !isCurrent && setSelected(id)}
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer ${isCurrent ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5'} ${isSelected ? 'bg-white/10' : ''}`}
        data-testid={`move-target-${id ?? 'root'}`}
      >
        <span className="text-sm text-white/90">{label}</span>
        {isCurrent && <span className="text-xs text-white/50">当前位置</span>}
      </div>
    );
  };

  return (
    <Modal
      title="移动到文件夹"
      open={open}
      okText="确定" cancelText="取消"
      onOk={() => onOk(selected)}
      onCancel={onCancel}
      destroyOnClose
    >
      <div className="flex flex-col gap-1">
        <Row id={null} label="根目录（未分组）" />
        {folders.map((f) => <Row key={f.id} id={f.id} label={f.name} />)}
      </div>
    </Modal>
  );
}
