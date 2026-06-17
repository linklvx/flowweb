import { useEffect, useState, useMemo } from 'react';
import { Modal, Select } from 'antd';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';
import type { MaterialFolder } from '@flowweb/shared';
import FolderTree from './FolderTree/FolderTree';
import FileGrid from './FileGrid/FileGrid';
import FileGridZoomControl from './FileGridZoomControl';
import './MaterialLibraryModal.css';

function flattenFolders(
  folders: MaterialFolder[],
  parentId: string | null = null,
  depth = 0,
): { value: string; label: string; depth: number }[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((f) => [
      { value: f.id, label: f.name, depth },
      ...flattenFolders(folders, f.id, depth + 1),
    ]);
}

export default function MaterialLibraryModal() {
  const isOpen = useMaterialLibraryStore((s) => s.isOpen);
  const close = useMaterialLibraryStore((s) => s.close);
  const loadFolders = useMaterialLibraryStore((s) => s.loadFolders);
  const loadFiles = useMaterialLibraryStore((s) => s.loadFiles);
  const uploading = useMaterialLibraryStore((s) => s.uploading);
  const batchMode = useMaterialLibraryStore((s) => s.batchMode);
  const selectedFileIds = useMaterialLibraryStore((s) => s.selectedFileIds);
  const selectedFolderId = useMaterialLibraryStore((s) => s.selectedFolderId);
  const folders = useMaterialLibraryStore((s) => s.folders);

  const [folderSelectorOpen, setFolderSelectorOpen] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);

  const folderOptions = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    if (isOpen) { loadFolders(); loadFiles(); }
  }, [isOpen, loadFolders, loadFiles]);

  // Keyboard shortcuts for batch mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useMaterialLibraryStore.getState();
      if (!state.batchMode) return;
      if (e.key === 'Escape') {
        state.exitBatchMode();
      } else if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        state.selectAllFiles();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClose = () => {
    useMaterialLibraryStore.getState().exitBatchMode();
    close();
  };

  const handleBatchDelete = () => {
    const state = useMaterialLibraryStore.getState();
    if (state.selectedFileIds.size === 0) return;
    Modal.confirm({
      title: '批量删除文件',
      content: `确定删除选中的 ${state.selectedFileIds.size} 个文件？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => state.batchDelete(),
    });
  };

  const openFolderSelector = () => {
    setTargetFolderId(selectedFolderId ?? '__root__');
    setFolderSelectorOpen(true);
  };

  const handleBatchMove = () => {
    const folderId = targetFolderId === '__root__' ? null : targetFolderId;
    useMaterialLibraryStore.getState().batchMove(folderId);
    setFolderSelectorOpen(false);
    setTargetFolderId(null);
  };

  if (!isOpen) return null;

  return (
    <Modal title="我的素材库" open={isOpen} onCancel={handleClose} footer={null}
      width="90%" style={{ top: 50 }}
      className="material-library-modal">
      <div className="material-library-container">
        <div className="material-library-sidebar">
          <FolderTree />
        </div>
        <div className="material-library-main">
          <div className="main-header">
            {batchMode ? (
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  已选 {selectedFileIds.size} 项
                </span>
                <button className="batch-btn batch-btn-select-all"
                  onClick={() => useMaterialLibraryStore.getState().selectAllFiles()}>
                  全选当前页
                </button>
                <button className="batch-btn batch-btn-move"
                  disabled={selectedFileIds.size === 0}
                  onClick={openFolderSelector}>
                  移动到
                </button>
                <button className="batch-btn batch-btn-delete"
                  disabled={selectedFileIds.size === 0}
                  onClick={handleBatchDelete}>
                  删除已选
                </button>
                <button className="batch-btn batch-btn-cancel"
                  onClick={() => useMaterialLibraryStore.getState().exitBatchMode()}>
                  取消
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className={`upload-btn-wrapper ${uploading ? 'upload-btn-disabled' : ''}`}>
                  <button className="upload-btn">选择文件</button>
                  <input type="file" accept="image/*,video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) useMaterialLibraryStore.getState().uploadFile(file);
                      e.target.value = '';
                    }}
                    disabled={uploading} />
                </div>
                {uploading ? (
                  <span className="text-blue-400 text-sm">上传中...</span>
                ) : (
                  <span className="upload-hint">未选择任何文件</span>
                )}
                <button className="batch-btn batch-btn-enter"
                  onClick={() => useMaterialLibraryStore.getState().enterBatchMode()}>
                  批量操作
                </button>
              </div>
            )}
            <FileGridZoomControl />
          </div>
          <FileGrid />
        </div>
      </div>
      <Modal title="选择目标文件夹" open={folderSelectorOpen}
        onCancel={() => setFolderSelectorOpen(false)}
        onOk={handleBatchMove}
        okText="移动" cancelText="取消"
        okButtonProps={{ disabled: !targetFolderId }}>
        <Select
          placeholder="请选择目标文件夹"
          style={{ width: '100%' }}
          value={targetFolderId}
          onChange={(v) => setTargetFolderId(v)}
          options={[
            { value: '__root__', label: '根目录', depth: 0 },
            ...folderOptions,
          ]}
          optionRender={(option) => (
            <span style={{ paddingLeft: `${(option.data as any).depth * 16}px` }}>
              {option.label}
            </span>
          )}
        />
      </Modal>
    </Modal>
  );
}
