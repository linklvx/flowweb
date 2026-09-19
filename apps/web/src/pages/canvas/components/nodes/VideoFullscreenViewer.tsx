import { memo, useState, useRef, useEffect } from 'react';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';

interface VideoFullscreenViewerProps {
  open: boolean;
  onClose: () => void;
  videoUrl: string | undefined;
  triggerRef: React.RefObject<HTMLButtonElement>;
  nodeData: {
    model?: string;
    ratio?: string;
    duration?: number;
    resolution?: string;
    prompt?: { text?: string };
  };
}

type VideoState = 'loading' | 'ready' | 'error';

const SCROLLBAR_STYLES = `
  .video-fv-sidebar::-webkit-scrollbar { width: 6px; }
  .video-fv-sidebar::-webkit-scrollbar-track { background: transparent; }
  .video-fv-sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
  .video-fv-sidebar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
`;

function VideoFullscreenViewerComponent({
  open,
  onClose,
  videoUrl,
  triggerRef,
  nodeData,
}: VideoFullscreenViewerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [videoState, setVideoState] = useState<VideoState>(
    videoUrl ? 'loading' : 'error',
  );
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (videoUrl) {
      setVideoState('loading');
    } else {
      setVideoState('error');
    }
  }, [videoUrl]);

  const handleLoadedData = () => setVideoState('ready');
  const handleError = () => setVideoState('error');

  const handleDownload = async () => {
    if (!videoUrl || downloading) return;

    setDownloading(true);
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = '';
      a.click();

      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(videoUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const prompt = nodeData?.prompt?.text?.trim() || '';
  const model = nodeData?.model || '未知';
  const ratio = nodeData?.ratio || '16:9';
  const resolution = nodeData?.resolution || '1080p';
  const duration = nodeData?.duration != null ? `${nodeData.duration}s` : '5s';

  const downloadDisabled = !videoUrl || downloading;
  const downloadText = downloading ? '下载中...' : '下载视频';

  return (
    <BaseFullscreenModal
      open={open}
      onClose={onClose}
      label="全屏查看"
      triggerRef={triggerRef}
      initialFocusRef={closeBtnRef}
    >
      <style>{SCROLLBAR_STYLES}</style>
      <div className="relative w-full mx-5 max-w-[1400px] h-[calc(100vh-40px)] max-h-[876px] rounded-[16px] bg-[#1C1C1C]/80 border border-white/10 flex overflow-hidden">
        {/* 关闭按钮 */}
        <button
          ref={closeBtnRef}
          type="button"
          aria-label="关闭全屏查看"
          className="absolute top-3 right-3 z-10 flex w-11 h-11 justify-center items-center rounded-[8px] bg-white/[0.06] hover:bg-white/[0.12] text-white/60 hover:text-white/85 transition-colors border-0"
          onClick={onClose}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
          </svg>
        </button>

        {/* 左侧：视频展示区 */}
        <div className="relative min-h-0 min-w-0 flex-1 flex items-center justify-center bg-[#0A0A0A] overflow-hidden">
          {videoState === 'loading' && (
            <div className="flex items-center justify-center text-white/40 text-sm">
              加载中...
            </div>
          )}

          {videoState === 'error' && (
            <div className="flex flex-col items-center justify-center gap-2 text-white/40">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span className="text-sm">视频加载失败</span>
            </div>
          )}

          {videoUrl && (
            <video
              aria-label="全屏视频播放"
              controls
              autoPlay
              className="max-w-full max-h-full object-contain select-none"
              style={{ opacity: videoState === 'ready' ? 1 : 0 }}
              onLoadedData={handleLoadedData}
              onError={handleError}
            >
              <source src={videoUrl} type="video/mp4" />
            </video>
          )}
        </div>

        {/* 右侧：侧边栏 */}
        <div className="w-[284px] shrink-0 flex flex-col pt-16 pr-5 pb-5 pl-5 gap-5">
          {/* 中间可滚动内容 */}
          <div className="flex-1 min-h-0 video-fv-sidebar overflow-y-auto">
            <div className="flex flex-col gap-5">
              {/* 提示词 */}
              <section className="space-y-2">
                <span className="text-sm font-semibold leading-5 text-neutral-400">提示词</span>
                <div className="relative h-[180px] self-stretch rounded-[12px] bg-white/5 text-sm leading-5 font-normal text-neutral-200 text-left overflow-hidden">
                  <div className="h-full pt-2 pl-3 pb-3 pr-1.5 overflow-y-auto video-fv-sidebar">
                    {prompt || '暂无提示词'}
                  </div>
                </div>
              </section>

              {/* 信息 */}
              <section className="flex flex-col gap-2.5">
                <span className="text-sm font-semibold leading-5 text-neutral-400">信息</span>
                <div className="flex flex-col items-start gap-2 py-2 px-2.5 self-stretch rounded-[12px] bg-white/5">
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-neutral-400 shrink-0">模型:</span>
                    <span className="text-sm font-normal leading-[150%] text-neutral-200 truncate min-w-0">{model}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-neutral-400 shrink-0">时长:</span>
                    <span className="text-sm font-normal leading-[150%] text-neutral-200 truncate min-w-0">{duration}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-neutral-400 shrink-0">宽高比:</span>
                    <span className="text-sm font-normal leading-[150%] text-neutral-200 truncate min-w-0">{ratio}</span>
                  </div>
                  <div className="flex items-start text-sm gap-3">
                    <span className="text-sm font-normal leading-[150%] text-neutral-400 shrink-0">分辨率:</span>
                    <span className="text-sm font-normal leading-[150%] text-neutral-200 truncate min-w-0">{resolution}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* 底部下载按钮 */}
          <div className="w-full shrink-0">
            <button
              type="button"
              disabled={downloadDisabled}
              title={!videoUrl ? '视频加载失败，无法下载' : undefined}
              onClick={handleDownload}
              className={`gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 flex h-8 py-2 px-0 justify-center items-center self-stretch rounded-[8px] border-[1.33px] border-white/10 bg-[#646464] backdrop-blur-[50px] text-white text-xs font-semibold leading-none w-full select-none ${
                downloadDisabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'shadow hover:bg-[#757575]'
              }`}
            >
              {downloadText}
            </button>
          </div>
        </div>
      </div>
    </BaseFullscreenModal>
  );
}

export const VideoFullscreenViewer = memo(VideoFullscreenViewerComponent);
