// PlayView.tsx（spec v3.1：单 video 状态机 + 视频铺底 + UI 列流）
import { useState, useCallback, useRef, useEffect } from 'react';
import { App as AntdApp } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { toggleLike } from '@/api/videoWorkApi'; // fetchVideoWorkDetail 不 import——PlayView 自身不拉详情（onError 自愈由外壳 onDetailRefresh 回调注入；勿留未用导入，第八轮删）
import type { VideoWorkDetail } from '@flowweb/shared';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function PlayView({ detail, playing, onPlayingChange, onViewProcess, onNeedLogin, onDetailRefresh }: {
  detail: VideoWorkDetail;
  playing: boolean;
  onPlayingChange: (v: boolean) => void;   // v3.1 裁定 A：playing 上提外壳（播放态隐藏轮播 + 切作品复位）
  onViewProcess: () => void;
  onNeedLogin: () => void;
  onDetailRefresh: () => void; // onError 自愈回调
}) {
  const [liked, setLiked] = useState(detail.liked);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const retriedRef = useRef(false);        // onError 一次性自愈守卫——对象已从 MinIO 删除时防 错误→重取→新URL→再错误 无限循环
  const previewPlayTriedRef = useRef(false); // onCanPlay 一次性兜底（承重）：保证挂载 autoplay 被拒后兜底一次；此后用户暂停回预览时 stall/seek 触发的 canplay 不偷偷续播——非降噪冗余，勿删
  const { message } = AntdApp.useApp();    // 壳内上下文实例（C1-3——静态 message 落 body z≈2010 被壳盖）
  const { user } = useAuth();              // isLoggedIn() 不存在（C1-4）

  // P4 状态机 effect：预览分支只静音不 play（冻结语义——"暂停=回预览"与"预览恒循环"不可兼得，v3.1 裁定取前者）；
  // 播放分支 unmute + play（用户手势内调 play() 必被放行）。禁读 el.paused/el.ended 做分支——jsdom 恒 true/false 与真机分叉。
  useEffect(() => {
    const el = videoRef.current; if (!el) return;
    if (!playing) { el.muted = true; return; }
    el.muted = false;
    el.play()?.catch(() => {
      // 唯一允许的 imperative muted 覆写点：React 只在下一次 muted 值变化时才纠正此直写
      el.muted = true;
      message.warning('浏览器阻止了自动播放声音，请点击播放器音量图标');
    });
  }, [playing, detail.videoUrl]);

  const onLike = useCallback(async () => {
    if (!user) { onNeedLogin(); return; }   // D15/D18：未登录 → 页内 LoginModal（Task 8.4 接入）
    try {
      const res = await toggleLike(detail.id);      // 以响应为准
      setLiked(res.liked);
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else message.error('操作失败');
    }
  }, [detail.id, user]);

  const onShare = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    message.success('链接已复制');
  }, []);

  return (
    <div className="absolute inset-0">
      {/* 单 <video> 约束（F4/B1）：恒渲染、src 恒定、属性集随 playing 切换——禁条件分支/换 key，续播不重挂载 */}
      <video data-testid="video" ref={videoRef} src={detail.videoUrl}
        poster={detail.coverUrl ?? undefined}
        muted={!playing} loop={!playing} autoPlay playsInline controls={playing}
        className="absolute inset-0 h-full w-full object-contain"
        onError={() => { if (!retriedRef.current) { retriedRef.current = true; onPlayingChange(false); onDetailRefresh(); } }}  // 自愈换 URL 回预览态（B9）
        onCanPlay={(e) => { if (!playing && !previewPlayTriedRef.current) { previewPlayTriedRef.current = true; e.currentTarget.play()?.catch(() => {}); } }}
        onEnded={() => { const el = videoRef.current; if (el) el.currentTime = 0; onPlayingChange(false); }}  // 播完 = 回预览首帧；暂停不回落（点视频=原生暂停切换，播放态 UI 保持）
      />

      {/* UI 列（D1 承压：flex-1 min-h-0 把 ③④ 推到底；pointer-events-none 让空区点击穿透到视频 controls——D2/裁定 A） */}
      <div data-testid="ui-col" className="relative z-10 flex-1 min-h-0 h-full flex flex-col pointer-events-none">
        {/* ① 顶栏：作者 | 标题 …… 发布于（D13）+含 AI 生成内容。pl/md:pl 分轴写法——px-4 md:px-8 的 md:px-8 在 ≥768px 同特异性靠后压掉 pr（P0-2） */}
        <div className="pointer-events-auto flex items-center gap-3 pl-4 md:pl-8 pr-[var(--vw-close-reserve)] py-3 md:py-6 bg-gradient-to-b from-black/60 to-transparent">
          <span className="w-7 h-7 rounded-full bg-white/20 shrink-0" />
          <span className="text-sm md:text-base">{detail.authorName}</span>
          <span className="w-px h-4 bg-white/20" />
          <span className="flex-1 truncate text-sm md:text-base">{detail.title}</span>
          <span className="hidden sm:block text-sm text-white/90">发布于 {fmtDate(detail.publishedAt)}</span>
          <span className="text-xs text-white/60">含 AI 生成内容</span>
        </div>

        {/* ② 弹性空区（穿透） */}
        <div className="flex-1" />

        {/* ③④ 预览态区块（A2：播放态整块卸载；整块 pointer-events-auto——简介文本可选中，B3 口径）；外层渐变遮罩压亮画面可读（T4/M-2） */}
        {!playing && (
          <div data-testid="preview-block" className="pointer-events-auto bg-gradient-to-t from-black/70 to-transparent">
            {/* ③ 简介浮层（U1：仅简介文本——tags/观看数已删） */}
            <div data-testid="desc-panel" className="px-4 md:px-8 pb-2 max-w-[420px] text-xs text-white/75 leading-relaxed">
              {detail.description}
            </div>

            {/* ④ 按钮组（U2 居中；U3 pb=轮播条高+50px 间隙，仅预览态成立——播放态本块不渲染且轮播隐藏，勿套用） */}
            <div className="flex items-center justify-center gap-3 px-4 md:px-8 pb-[calc(var(--vw-carousel-reserve)+50px)]">
              {/* U4：圆形白底播放图标（文字移除，aria-label 供无障碍/测试） */}
              <button onClick={() => onPlayingChange(true)} aria-label="立即观看"
                className="border-none h-9 w-9 md:h-10 md:w-10 rounded-full bg-white text-[#171717] flex items-center justify-center hover:bg-white/90">
                <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M0 2.4a2.4 2.4 0 0 1 3.73-2l10.8 7.2a2.4 2.4 0 0 1 0 4l-10.8 7.2a2.4 2.4 0 0 1-3.73-2zm2.73-.5a.6.6 0 0 0-.93.5v14.4c0 .48.53.76.93.5l10.8-7.2a.6.6 0 0 0 0-1z" fill="currentColor" transform="translate(1.5 0) scale(0.833333)" />
                </svg>
              </button>
              {detail.canViewProcess && (
                <button onClick={onViewProcess} aria-label="查看制作过程"
                  className="border-none h-9 md:h-10 rounded-full bg-[#2f2f2f] text-white px-4 text-sm hover:bg-[#3a3a3a]">⌗ 查看制作过程</button>
              )}
              {/* U5：只显图标（likeCount 不渲染） */}
              <button onClick={onLike} aria-label="喜欢" data-liked={liked}
                className={`border-none h-9 w-9 md:h-10 md:w-10 rounded-full bg-[#2f2f2f] hover:bg-[#3a3a3a] flex items-center justify-center ${liked ? 'text-[#4ade80]' : 'text-white'}`}>♥</button>
              {/* U6：圆形分享 */}
              <button onClick={onShare} aria-label="分享"
                className="border-none h-9 w-9 md:h-10 md:w-10 rounded-full bg-[#2f2f2f] text-white flex items-center justify-center text-sm hover:bg-[#3a3a3a]">⇪</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
