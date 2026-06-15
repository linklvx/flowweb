import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import type { ImageNodeData } from '@/stores/nodeStore';

interface ImageFullscreenViewerProps {
  open: boolean;
  onClose: () => void;
  displayUrl: string | undefined;
  nodeData: ImageNodeData;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

type ImageState = 'loading' | 'success' | 'error';

// 局部滚动条样式（独立类名前缀避免冲突）
const SCROLLBAR_STYLES = `
  .image-fv-sidebar::-webkit-scrollbar { width: 6px; }
  .image-fv-sidebar::-webkit-scrollbar-track { background: transparent; }
  .image-fv-sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
  .image-fv-sidebar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
`;

function ImageFullscreenViewerComponent({
  open,
  onClose,
  displayUrl,
  nodeData,
  triggerRef,
}: ImageFullscreenViewerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [imageState, setImageState] = useState<ImageState>(
    displayUrl ? 'loading' : 'error',
  );
  const [imgSize, setImgSize] = useState<string | null>(null);

  // Reset state when displayUrl changes
  useEffect(() => {
    if (displayUrl) {
      setImageState('loading');
      setImgSize(null);
    } else {
      setImageState('error');
      setImgSize(null);
    }
  }, [displayUrl]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageState('success');
    setImgSize(`${img.naturalWidth} × ${img.naturalHeight}`);
  }, []);

  const handleError = useCallback(() => {
    setImageState('error');
    setImgSize(null);
  }, []);

  const prompt = nodeData.prompt?.text?.trim() || '';
  const model = nodeData.model || '未知';
  const quality = nodeData.quality || '未知';
  const ratio = nodeData.ratio || '未知';
  const sizeDisplay = imgSize || '未知';

  const downloadDisabled = !displayUrl;

  const imgAlt = prompt || '生成的图片';

  return (
    <BaseFullscreenModal
      open={open}
      onClose={onClose}
      label="全屏查看"
      triggerRef={triggerRef}
      initialFocusRef={closeBtnRef}
    >
      <style>{SCROLLBAR_STYLES}</style>
      <div className="w-full mx-5 max-w-[1400px] h-[calc(100vh-40px)] max-h-[876px] rounded-[16px] bg-[#1C1C1C]/80 border border-white/10 flex overflow-hidden">
        {/* 左侧：图片展示区 */}
        <div className="relative min-h-0 min-w-0 flex-1 flex flex-col items-center justify-center overflow-hidden">
          {imageState === 'loading' && (
            <div className="flex items-center justify-center text-white/40 text-sm">
              计算中
            </div>
          )}

          {imageState === 'error' && (
            <div className="flex flex-col items-center justify-center gap-2 text-white/40">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span className="text-sm">图片加载失败</span>
            </div>
          )}

          {imageState !== 'error' && displayUrl && (
            <img
              src={displayUrl}
              alt={imgAlt}
              className="max-w-full max-h-full object-contain cursor-zoom-in select-none transition-opacity duration-200"
              draggable={false}
              style={{ opacity: imageState === 'success' ? 1 : 0 }}
              onLoad={handleLoad}
              onError={handleError}
            />
          )}
        </div>

        {/* 右侧：侧边栏 — 纯 flex 流式布局 */}
        <div className="w-[284px] shrink-0 flex flex-col p-5 gap-5">
          {/* 顶部区块：关闭按钮 */}
          <div className="flex justify-end shrink-0">
            <button
              ref={closeBtnRef}
              type="button"
              aria-label="关闭全屏查看"
              className="flex w-8 h-8 justify-center items-center rounded-[8px] hover:bg-white/[0.09] transition-colors cursor-pointer border-0 bg-transparent text-popover-foreground"
              onClick={onClose}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 中间可滚动内容 */}
          <div className="flex-1 min-h-0 image-fv-sidebar overflow-y-auto">
            <div className="flex flex-col gap-5">
              {/* 提示词 */}
              <section className="space-y-2">
                <span className="text-sm font-semibold leading-5 text-neutral-400">提示词</span>
                <div className="relative h-[180px] self-stretch rounded-[12px] bg-white/5 text-sm leading-5 font-normal text-popover-foreground text-left overflow-hidden">
                  <div className="h-full pt-2 pl-3 pb-3 pr-1.5 overflow-y-auto image-fv-sidebar">
                    {prompt || '暂无提示词'}
                  </div>
                </div>
              </section>

              {/* 信息 */}
              <section className="flex flex-col gap-2.5">
                <span className="text-sm font-semibold leading-5 text-neutral-400">信息</span>
                <div className="flex flex-col items-start gap-2 py-2 px-2.5 self-stretch rounded-[12px] bg-white/5">
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">模型:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{model}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">质量:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{quality}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">宽高比:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{ratio}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-muted-foreground shrink-0">图片尺寸:</span>
                    <span className="text-sm font-normal leading-[150%] text-popover-foreground truncate min-w-0">{sizeDisplay}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* 底部下载按钮 — 统一使用 <a> 标签 */}
          <div className="w-full shrink-0">
            <a
              href={downloadDisabled ? undefined : displayUrl}
              download={!downloadDisabled}
              tabIndex={downloadDisabled ? -1 : 0}
              aria-disabled={downloadDisabled}
              title={downloadDisabled ? '图片加载失败，无法下载' : undefined}
              className={`gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex h-8 py-2 px-0 justify-center items-center self-stretch rounded-[8px] border-[1.33px] border-white/10 bg-[#646464] backdrop-blur-[50px] text-primary-foreground text-xs font-semibold leading-none w-full no-underline select-none ${
                downloadDisabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'shadow cursor-pointer hover:bg-[#757575]'
              }`}
            >
              下载图片
            </a>
          </div>
        </div>
      </div>
    </BaseFullscreenModal>
  );
}

export const ImageFullscreenViewer = memo(ImageFullscreenViewerComponent);
