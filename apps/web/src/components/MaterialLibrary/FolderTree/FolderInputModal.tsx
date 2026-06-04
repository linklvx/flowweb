import { useState, useEffect, useRef } from 'react';
import { Modal, Input } from 'antd';

interface Props {
  open: boolean;
  title: string;
  defaultValue: string;
  onOk: (value: string) => void;
  onCancel: () => void;
}

export default function FolderInputModal({ open, title, defaultValue, onOk, onCancel }: Props) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, defaultValue]);

  const trimmed = value.trim();
  const disabled = trimmed === '';

  const handleOk = () => {
    if (!disabled) onOk(trimmed);
  };

  return (
    <Modal
      open={open}
      title={title}
      onOk={handleOk}
      onCancel={onCancel}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled }}
      destroyOnClose
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleOk();
        }}
        maxLength={50}
      />
    </Modal>
  );
}
