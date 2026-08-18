import { useEffect, useState } from 'react';
import { Modal, Input, Select } from 'antd';
import type { Folder } from '../types';

interface CreateCanvasModalProps {
  open: boolean;
  folders: Folder[];
  defaultFolderId: string | null;
  onOk: (name: string, folderId: string | null) => void;
  onCancel: () => void;
}

export function CreateCanvasModal({ open, folders, defaultFolderId, onOk, onCancel }: CreateCanvasModalProps) {
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  useEffect(() => { if (open) { setName(''); setFolderId(defaultFolderId); } }, [open, defaultFolderId]);

  return (
    <Modal
      title="新建画布"
      open={open}
      okText="确定" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => onOk(name.trim(), folderId)}
      onCancel={onCancel}
      destroyOnClose
    >
      <div className="flex flex-col gap-3">
        <Input aria-label="画布名称" placeholder="输入画布名称" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          aria-label="目标文件夹"
          value={folderId ?? '__root__'}
          onChange={(v) => setFolderId(v === '__root__' ? null : v)}
          options={[
            { value: '__root__', label: '根目录（未分组）' },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </div>
    </Modal>
  );
}
