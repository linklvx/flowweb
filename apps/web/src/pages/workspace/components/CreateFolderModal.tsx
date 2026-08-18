import { useEffect, useState } from 'react';
import { Modal, Input } from 'antd';

interface CreateFolderModalProps {
  open: boolean;
  initialName?: string;
  onOk: (name: string) => void;
  onCancel: () => void;
}

export function CreateFolderModal({ open, initialName, onOk, onCancel }: CreateFolderModalProps) {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(initialName ?? ''); }, [open, initialName]);

  return (
    <Modal
      title={initialName ? '重命名文件夹' : '新建文件夹'}
      open={open}
      okText="确定" cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => onOk(name.trim())}
      onCancel={onCancel}
      destroyOnClose
    >
      <Input aria-label="文件夹名称" placeholder="输入文件夹名称" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={() => name.trim() && onOk(name.trim())} />
    </Modal>
  );
}
