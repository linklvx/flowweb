import { useEffect } from 'react';
import { Modal } from 'antd';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';
import FolderTree from './FolderTree/FolderTree';
import FileGrid from './FileGrid/FileGrid';
import FileGridZoomControl from './FileGridZoomControl';
import './MaterialLibraryModal.css';

export default function MaterialLibraryModal() {
  const isOpen = useMaterialLibraryStore((s) => s.isOpen);
  const close = useMaterialLibraryStore((s) => s.close);
  const loadFolders = useMaterialLibraryStore((s) => s.loadFolders);
  const loadFiles = useMaterialLibraryStore((s) => s.loadFiles);
  const uploading = useMaterialLibraryStore((s) => s.uploading);

  useEffect(() => {
    if (isOpen) { loadFolders(); loadFiles(); }
  }, [isOpen, loadFolders, loadFiles]);

  if (!isOpen) return null;

  return (
    <Modal title="我的素材库" open={isOpen} onCancel={close} footer={null}
      width="90%" style={{ top: 20 }} className="material-library-modal">
      <div className="material-library-container">
        <div className="material-library-sidebar">
          <FolderTree />
        </div>
        <div className="material-library-main">
          <div className="main-header">
            <div className="flex items-center gap-3">
              <input type="file" accept="image/*,video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) useMaterialLibraryStore.getState().uploadFile(file);
                  e.target.value = '';
                }}
                disabled={uploading} />
              {uploading && <span className="text-blue-400 text-sm">上传中...</span>}
            </div>
            <FileGridZoomControl />
          </div>
          <FileGrid />
        </div>
      </div>
    </Modal>
  );
}
