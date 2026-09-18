// VideoPlayerModal.tsx（外壳：路由驱动开关 + 关闭算法 + 视图切换）
import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ConfigProvider, App as AntdApp } from 'antd';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { LoginModal } from '@/components/auth/LoginModal';
import { fetchVideoWorkDetail, recordView } from '@/api/videoWorkApi';
import type { VideoWorkDetail } from '@flowweb/shared';
import { PlayView } from './PlayView';          // Task 8.2
import { ProcessView } from './ProcessView';    // Task 9.2
import { CarouselBar } from './CarouselBar';    // Task 8.3

/** 弹层 z 基座（第十一轮 S2 引入、第十二轮口径修正）：token 与 data-zprovider 锚点同源——Task 8.4 断言锚点值为
 *  字面量 '100000'，**改本常量即红**（值耦合，这是该断言真正钉住的东西）。ConfigProvider/AntdApp 均为 context
 *  组件无 DOM 痕迹，"Provider 包裹存在"那半边 jsdom 不可测（删层重写时若保留锚点 div，断言仍绿）——层叠正确性
 *  由浏览器手工验收 #6 兜底（C7-B5"注释+手工验收"防线），勿声称"删层即红" */
const VIDEO_MODAL_Z_BASE = 100000;

export function VideoPlayerModal() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<VideoWorkDetail | null>(null);
  const [view, setView] = useState<'play' | 'process'>('play');
  const [playing, setPlaying] = useState(false);        // 裁定 A：playing 上提外壳（播放态隐藏轮播 + P5b 条件）；id 变化必须复位——漏则切作品后停在无轮播伪播放态死状态
  const [showLogin, setShowLogin] = useState(false);   // Task 8.4 页内登录（D18）
  const shellRef = useRef<HTMLDivElement | null>(null); // 弹层容器（getPopupContainer，C1-3 两层配方）

  useEffect(() => {
    if (!id) { setDetail(null); setView('play'); setPlaying(false); return; }   // id 消失 → 关闭并复位
    let stale = false;   // 竞态守卫（批次 8 勘误②，同批次 7 VideosPage 模式）——快速轮播切换时旧响应晚到不覆盖/晚到 404 不误踢回列表
    setDetail(null); setView('play'); setPlaying(false);
    fetchVideoWorkDetail(id)
      .then(d => { if (!stale) setDetail(d); })
      .catch(() => { if (!stale) navigate('/videos', { replace: true }); }); // 404 → 回列表
    recordView(id);                                          // view 单点埋点（打开时，D15）
    return () => { stale = true; };
  }, [id]);

  /** 关闭算法（模式 A）：fromList → navigate(-1)；否则 replace /videos。
   *  首行 Esc 守卫是承重机制（C1-3 第七轮措辞修正）：焦点不在登录框内时 Esc 事件不经 rc-dialog 的
   *  wrapper 节点、直达 document 触发壳关闭——无守卫时关掉的是整个播放 Modal；守卫使该场景只关登录层 */
  const close = useCallback(() => {
    if (showLogin) { setShowLogin(false); return; } // 登录层开着 → 只关登录层（Task 8.4 接入 state）
    if ((location.state as any)?.fromList) navigate(-1);
    else navigate('/videos', { replace: true });
  }, [location.state, navigate, showLogin]);

  if (!id || !detail) return null;

  return (
    <BaseFullscreenModal open onClose={close} label="视频作品预览" closeOnBackdrop={false}>
      {/* 弹层作用域两层配方（C1-3 第七轮措辞修正）：getPopupContainer 进壳 + AntdApp component={false}
          照抄 VideoEditorShell.tsx:136-141 结构；⚠ zIndexPopupBase:100000 是本 plan 新增层（先例没有——其弹层从不落
          body 故不需要），勿删：shellRef 未挂载首帧 getPopupContainer 回退 body 时，它是登录框可见性
          （100100 > 壳 100000）的唯一保障（删掉则 11100 < 100000 被壳盖住，jsdom 测不出、手工验收 #6 才暴露）。
          PlayView/ProcessView 的 useApp() toast 依赖内层 AntdApp（holder 渲染在壳 DOM 内） */}
      <div ref={shellRef} data-vw-shell className="fixed inset-0 bg-black text-white [color-scheme:dark]">
      {/* 第六轮：fixed inset-0（VideoEditorShell.tsx:132 同款）——BaseFullscreenModal 的 dialog 包装 div 无尺寸类，
          relative h-full 的百分比在 auto 高度父级上解析为 auto → 壳内容塌成 0 高度（jsdom 无布局测不出，手工验收 #3 才暴露；
          壳内 PlayView/CarouselBar/关闭钮全是绝对定位不贡献静态高度，必须由视口尺寸的内含块撑起） */}
        <ConfigProvider theme={{ token: { zIndexPopupBase: VIDEO_MODAL_Z_BASE } }} getPopupContainer={() => shellRef.current ?? document.body}>
          <AntdApp component={false}>
            {/* 第十一轮 S2：data-zprovider 锚点从壳根挪进 Provider 内层并绑定 token 常量（断言钉住**值耦合**：改
                VIDEO_MODAL_Z_BASE 即红；"Provider 包裹存在"jsdom 不可测——context 组件无 DOM，层叠正确性走手工验收 #6）；
                display:contents 使锚点 div 不产生布局盒（壳内绝对定位元素的参照物仍是壳根 fixed）。 */}
            <div data-zprovider={String(VIDEO_MODAL_Z_BASE)} style={{ display: 'contents' }}>
              {view === 'play'
                ? <PlayView detail={detail} playing={playing} onPlayingChange={setPlaying} onViewProcess={() => setView('process')} onNeedLogin={() => setShowLogin(true)} onDetailRefresh={() => fetchVideoWorkDetail(detail.id).then(setDetail).catch(() => {})} />
                : <ProcessView workId={detail.id} title={detail.title} canClone={detail.canClone} onBack={() => setView('play')} onNeedLogin={() => setShowLogin(true)} />}
              {view === 'play' && !playing && (  // P5b/裁定 A：process 与播放态均不渲染（播放态隐藏使 controls 落可点区，P0-1 第二根因）
                <CarouselBar currentId={detail.id} categoryId={detail.categoryId} onSwitch={(wid) =>
                  navigate(`/videos/${wid}`, { replace: true, state: location.state })} />  /* 继承 state 原值透传（§5.1） */
              )}
              {showLogin && <LoginModal onClose={() => setShowLogin(false)} />} {/* 读最近 Provider token → z=100100；D18 */}
              <button data-testid="close-btn" onClick={close} aria-label="关闭" className="absolute top-3 right-3 z-10 rounded-lg bg-[rgba(50,50,50,0.45)] px-3 py-1.5 text-sm backdrop-blur-[6px]">✕</button>
            </div>
          </AntdApp>
        </ConfigProvider>
      </div>
    </BaseFullscreenModal>
  );
}
