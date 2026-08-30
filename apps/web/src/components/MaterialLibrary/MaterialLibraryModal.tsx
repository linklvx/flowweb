import { useEffect } from 'react';
import { Modal } from 'antd';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { MaterialLibraryBrowser } from './MaterialLibraryBrowser';
import type { MaterialFile } from '@flowweb/shared';
import './MaterialLibraryModal.css';

export default function MaterialLibraryModal() {
  const isOpen = useMaterialLibraryStore((s) => s.isOpen);
  const close = useMaterialLibraryStore((s) => s.close);
  const enterContext = useMaterialLibraryStore((s) => s.enterContext);

  // 画布场景 enterContext（spec §二.3 调用时机①）：context 取 canvasStore
  useEffect(() => {
    if (isOpen) {
      const cs = useCanvasStore.getState();
      enterContext({ teamId: cs.teamId ?? undefined, projectId: cs.projectId ?? undefined });
    }
  }, [isOpen, enterContext]);

  const handleClose = () => {
    useMaterialLibraryStore.getState().exitBatchMode();
    close();
  };

  const handleApplyFile = (f: MaterialFile) => {
    useCanvasStore.getState().requestAddMediaNode(f);
    useMaterialLibraryStore.getState().close();
  };

  if (!isOpen) return null;

  return (
    <Modal title="我的素材库" open={isOpen} onCancel={handleClose} footer={null}
      width="90%" style={{ top: 50 }}
      className="material-library-modal">
      <MaterialLibraryBrowser title="我的素材库" onApplyFile={handleApplyFile} />
    </Modal>
  );
}
