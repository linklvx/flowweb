// PlayView.tsx
import { useState, useCallback, useRef } from 'react';
import { App as AntdApp } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { toggleLike } from '@/api/videoWorkApi'; // fetchVideoWorkDetail 不 import——PlayView 自身不拉详情（onError 自愈由外壳 onDetailRefresh 回调注入；勿留未用导入，第八轮删）
import type { VideoWorkDetail } from '@flowweb/shared';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function PlayView({ detail, onViewProcess, onNeedLogin, onDetailRefresh }: {
  detail: VideoWorkDetail;
  onViewProcess: () => void;
  onNeedLogin: () => void;
  onDetailRefresh: () => void; // onError 自愈回调
}) {
  const [liked, setLiked] = useState(detail.liked);
  const [likeCount, setLikeCount] = useState(detail.likeCount);
  const [playing, setPlaying] = useState(false);
  const retriedRef = useRef(false);       // 第七轮：onError 一次性自愈守卫——对象已从 MinIO 删除时防 错误→重取→新URL→再错误 无限循环
  const { message } = AntdApp.useApp();   // 壳内上下文实例（C1-3——静态 message 落 body z≈2010 被壳盖）
  const { user } = useAuth();             // isLoggedIn() 不存在（C1-4）

  const onLike = useCallback(async () => {
    if (!user) { onNeedLogin(); return; }   // D15/D18：未登录 → 页内 LoginModal（Task 8.4 接入）
    try {
      const res = await toggleLike(detail.id);      // 以响应为准
      setLiked(res.liked); setLikeCount(res.likeCount);
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else message.error('操作失败');
    }
  }, [detail.id]);

  const onShare = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    message.success('链接已复制');
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* 顶栏：作者 | 标题 …… 发布于（D13）+含 AI 生成内容 */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-6 bg-gradient-to-b from-black/60 to-transparent">
        <span className="w-7 h-7 rounded-full bg-white/20 shrink-0" />
        <span className="text-sm md:text-base">{detail.authorName}</span>
        <span className="w-px h-4 bg-white/20" />
        <span className="flex-1 truncate text-sm md:text-base">{detail.title}</span>
        <span className="hidden sm:block text-sm text-white/90">发布于 {fmtDate(detail.publishedAt)}</span>
        <span className="text-xs text-white/60">含 AI 生成内容</span>
      </div>

      {/* 视频区 */}
      <div className="flex-1 relative flex items-center justify-center">
        {playing ? (
          <video data-testid="video" src={detail.videoUrl} controls autoPlay playsInline
            className="h-full w-full object-contain"
            onError={() => { if (!retriedRef.current) { retriedRef.current = true; onDetailRefresh(); } }} />
        ) : (
          <div className="flex items-center gap-3">
            <button onClick={() => setPlaying(true)} aria-label="立即观看"
              className="h-9 md:h-10 rounded-full bg-white text-[#171717] px-5 text-sm font-semibold hover:bg-white/90">▶ 立即观看</button>
            {detail.canViewProcess && (
              <button onClick={onViewProcess} aria-label="查看制作过程"
                className="h-9 md:h-10 rounded-full bg-[rgba(50,50,50,0.45)] px-4 text-sm backdrop-blur-[6px] hover:bg-[rgba(30,30,30,0.45)]">⌗ 查看制作过程</button>
            )}
            <button onClick={onLike} aria-label="喜欢" data-liked={liked}
              className={`h-9 w-9 md:h-10 md:w-10 rounded-full bg-[rgba(50,50,50,0.45)] backdrop-blur-[6px] hover:bg-[rgba(30,30,30,0.45)] ${liked ? 'text-[#4ade80]' : ''}`}>
              ♥<span className="ml-1 text-xs">{likeCount}</span>
            </button>
            <button onClick={onShare} aria-label="分享"
              className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-[rgba(50,50,50,0.45)] backdrop-blur-[6px]">⇪</button>
          </div>
        )}
      </div>

      {/* 简介浮层（常显，§6）：简介 + 标签 + 观看数。data-testid 供计数断言收窄（C2 Task 8.2 ③——`/10/` 会误中无关文本） */}
      <div data-testid="desc-panel" className="px-4 md:px-8 pb-2 max-w-[420px] text-xs text-white/75 leading-relaxed">
        {detail.description}
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          {detail.tags.map(t => <span key={t} className="px-1.5 py-px rounded bg-white/15 text-[11px]">{t}</span>)}
          <span className="text-white/50">观看 {detail.viewCount}</span>
        </div>
      </div>
    </div>
  );
}
