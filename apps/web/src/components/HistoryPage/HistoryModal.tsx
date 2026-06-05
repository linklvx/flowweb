import { useHistoryStore } from '@/stores/historyStore';
import { HistorySidebar } from './HistorySidebar';
import FileGrid from '../MaterialLibrary/FileGrid/FileGrid';
import FileGridZoomControl from '../MaterialLibrary/FileGridZoomControl';
import { Modal, message } from 'antd';
import { useEffect } from 'react';

export function HistoryModal() {
  const isOpen = useHistoryStore((s) => s.isOpen);
  const close = useHistoryStore((s) => s.close);
  const activeTab = useHistoryStore((s) => s.activeTab);
  const files = useHistoryStore((s) => s.files);
  const fileGridSize = useHistoryStore((s) => s.fileGridSize);
  const loading = useHistoryStore((s) => s.loading);
  const batchMode = useHistoryStore((s) => s.batchMode);
  const selectedFileIds = useHistoryStore((s) => s.selectedFileIds);

  const enterBatchMode = useHistoryStore((s) => s.enterBatchMode);
  const exitBatchMode = useHistoryStore((s) => s.exitBatchMode);
  const selectAllFiles = useHistoryStore((s) => s.selectAllFiles);
  const batchDelete = useHistoryStore((s) => s.batchDelete);
  const toggleFileSelection = useHistoryStore((s) => s.toggleFileSelection);
  const deleteFile = useHistoryStore((s) => s.deleteFile);
  const toggleFavorite = useHistoryStore((s) => s.toggleFavorite);
  const setFileGridSize = useHistoryStore((s) => s.setFileGridSize);

  // Keyboard shortcuts in batch mode
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && batchMode) {
        exitBatchMode();
        return;
      }
      if (e.ctrlKey && e.key === 'a' && batchMode) {
        e.preventDefault();
        selectAllFiles();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, batchMode, exitBatchMode, selectAllFiles]);

  const handleClose = () => {
    if (batchMode) exitBatchMode();
    close();
  };

  const handleBatchDelete = async () => {
    if (selectedFileIds.size === 0) {
      message.warning('请先选择文件');
      return;
    }
    await batchDelete();
  };

  const emptyText = `暂无${activeTab === 'image' ? '图片' : activeTab === 'video' ? '视频' : '音频'}历史记录`;

  return (
    <Modal
      title="历史记录"
      open={isOpen}
      onCancel={handleClose}
      footer={null}
      width="90%"
      style={{ top: 50 }}
      className="material-library-modal"
    >
      <div className="material-library-container">
        <div className="material-library-sidebar" style={{ width: 180 }}>
          <HistorySidebar />
        </div>
        <div className="material-library-main">
          <div className="main-header">
            {batchMode ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">已选择 {selectedFileIds.size} 项</span>
                <button
                  type="button"
                  className="text-sm text-blue-400 hover:text-blue-300"
                  onClick={() => selectAllFiles()}
                >
                  全选当前页
                </button>
                <button
                  type="button"
                  className="text-sm text-red-400 hover:text-red-300"
                  onClick={handleBatchDelete}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="text-sm text-gray-400 hover:text-gray-300"
                  onClick={exitBatchMode}
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-sm text-blue-400 hover:text-blue-300"
                  onClick={enterBatchMode}
                >
                  批量操作
                </button>
              </div>
            )}
            <FileGridZoomControl
              value={fileGridSize}
              onChange={setFileGridSize}
            />
          </div>
          <FileGrid
            files={files}
            fileGridSize={fileGridSize}
            loading={loading}
            batchMode={batchMode}
            selectedFileIds={selectedFileIds}
            emptyText={emptyText}
            onToggleFavorite={toggleFavorite}
            onDelete={deleteFile}
            store={{
              toggleFileSelection,
              selectFile: (id) => useHistoryStore.getState().toggleFileSelection(id),
              deselectFile: (id) => useHistoryStore.getState().toggleFileSelection(id),
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
