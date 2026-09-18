// 文件顶部装配（第七轮补全——原块无 harness，renderPlay/detail 全程未定义即 ReferenceError）：
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { App as AntdApp } from 'antd';
import * as api from '@/api/videoWorkApi';
import { PlayView } from '../PlayView';
import type { VideoWorkDetail } from '@flowweb/shared';

vi.mock('@/api/videoWorkApi');
// C5 模板（PlayView 链上 useAuth）——vi.hoisted 与 vi.mock 平级声明
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));

const detail: VideoWorkDetail = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };

// play() harness（spec v3.1 B3/F3）：组件在 playing 变 true 时经 effect 直调 play()——jsdom 返回 undefined 会 TypeError。
// 仅 play（组件全程不调 pause()——冻结靠 muted 属性直写 + 不 play）
let playSpy: MockInstance<() => Promise<void>>;
afterEach(() => { vi.restoreAllMocks(); });   // spyOn 每用例重建防 calls 跨用例累积（vi.mock automock 不受影响，下方 beforeEach 重设）

function renderPlay(d = detail, onDetailRefresh: Mock = vi.fn(), playing = false, onPlayingChange: Mock = vi.fn()) {
  render(<AntdApp><PlayView detail={d} playing={playing} onPlayingChange={onPlayingChange} onViewProcess={() => {}} onNeedLogin={() => {}} onDetailRefresh={onDetailRefresh} /></AntdApp>);
  return { onDetailRefresh, onPlayingChange };
}

/** 播放态切换用 rerender 驱动（playing 是 prop，点击只调 onPlayingChange 不自重渲——3c-1 签字条件） */
function renderForRerender(d = detail, onPlayingChange: Mock = vi.fn()) {
  const props = { detail: d, onViewProcess: () => {}, onNeedLogin: () => {}, onDetailRefresh: vi.fn() };
  const utils = render(<AntdApp><PlayView {...props} playing={false} onPlayingChange={onPlayingChange} /></AntdApp>);
  const rer = (playing: boolean) => utils.rerender(<AntdApp><PlayView {...props} playing={playing} onPlayingChange={onPlayingChange} /></AntdApp>);
  return { rer, onPlayingChange };
}

describe('PlayView', () => {
  beforeEach(() => {
    vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue(detail as any);
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('顶栏：作者名 + 发布于 {publishedAt}（D13 日期定案）', async () => {
    renderPlay(detail);
    expect(screen.getByText('作者')).toBeInTheDocument();
    expect(screen.getByText(/发布于/)).toBeInTheDocument();
  });

  it('canViewProcess=false → 无「查看制作过程」按钮', () => {
    renderPlay(detail); // detail.canViewProcess=false
    expect(screen.queryByRole('button', { name: /制作过程/ })).toBeNull();
  });

  it('喜欢：liked=true 初始高亮；点击 toggle 调 API 且以响应为准', async () => {
    authCtx.user = { id: 'u1' }; // 登录态才走 toggleLike——D18 守卫下 user=null 短路 onNeedLogin、toggleLike 永不被调（本用例断言的就是登录路径）
    vi.mocked(api.toggleLike).mockResolvedValue({ liked: false, likeCount: 4 });
    renderPlay({ ...detail, liked: true });
    const btn = screen.getByRole('button', { name: /喜欢/ });
    expect(btn).toHaveAttribute('data-liked', 'true');
    fireEvent.click(btn);
    await waitFor(() => expect(api.toggleLike).toHaveBeenCalledWith('w1'));
    await waitFor(() => expect(btn).toHaveAttribute('data-liked', 'false')); // 响应为准
  });

  it('登录后 user 变化——再点喜欢走 toggleLike 而非再弹登录（deps 缺 user 时闭包持旧 null → onNeedLogin 变 2）', async () => {
    authCtx.user = null; // 初始未登录（先例用例可能残留登录态，显式复位）
    const onNeedLogin = vi.fn();
    vi.mocked(api.toggleLike).mockResolvedValue({ liked: true, likeCount: 6 });
    const props = { detail, onViewProcess: () => {}, onDetailRefresh: vi.fn() };
    const { rerender } = render(<AntdApp><PlayView {...props} playing={false} onPlayingChange={vi.fn()} onNeedLogin={onNeedLogin} /></AntdApp>);
    fireEvent.click(screen.getByRole('button', { name: /喜欢/ }));
    await waitFor(() => expect(onNeedLogin).toHaveBeenCalledTimes(1)); // 未登录 → 弹登录
    authCtx.user = { id: 'u1' }; // 登录成功（同一 mock 实例改值）
    rerender(<AntdApp><PlayView {...props} playing={false} onPlayingChange={vi.fn()} onNeedLogin={onNeedLogin} /></AntdApp>);
    fireEvent.click(screen.getByRole('button', { name: /喜欢/ }));
    await waitFor(() => expect(api.toggleLike).toHaveBeenCalledWith('w1'));
    expect(onNeedLogin).toHaveBeenCalledTimes(1); // 闭包过期时此处变 2
  });

  it('分享：clipboard 写入当前 URL + message', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); // 第七轮修语法错（原少右括号）
    renderPlay(detail);
    fireEvent.click(screen.getByRole('button', { name: /分享/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });

  it('视频 onError → 触发一次 onDetailRefresh 自愈（TTL 过期换新 URL；video 恒渲染无需先点击——spec v3.1 单元素；第二次 error 不再重试）', () => {
    const { onDetailRefresh } = renderPlay(detail);
    fireEvent.error(screen.getByTestId('video'));
    expect(onDetailRefresh).toHaveBeenCalledTimes(1);
    fireEvent.error(screen.getByTestId('video')); // 同一实例再次 error（对象已删场景）
    expect(onDetailRefresh).toHaveBeenCalledTimes(1); // retriedRef 一次性守卫
  });

  it('desc-panel：简介保留，无标签行/观看数（U1：tags+viewCount 元素已删——原断言反转）', () => {
    renderPlay({ ...detail, tags: ['验收', '城市夜景'], viewCount: 4, likeCount: 6 });
    const panel = screen.getByTestId('desc-panel');
    expect(panel).toHaveTextContent('简介');
    expect(panel.textContent).not.toContain('观看');   // 观看数不显示
    expect(panel.textContent).not.toContain('验收');   // 标签不显示
    expect(panel.textContent).not.toContain('城市夜景');
  });
});

// ─── P1 无声预播（spec v3.1）───
describe('PlayView P1 预播', () => {
  beforeEach(() => {
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('预览态：muted property + loop/autoPlay/playsInline attribute + 无 controls + poster', () => {
    renderPlay({ ...detail, coverUrl: '/flowai/c.jpg' });
    const v = screen.getByTestId('video') as HTMLVideoElement;
    expect(v.muted).toBe(true);                                   // property！React 对 muted 走 mustUseProperty，toHaveAttribute('muted') 必红
    expect(v).toHaveAttribute('loop');
    expect(v).toHaveAttribute('autoPlay');
    expect(v).toHaveAttribute('playsInline');
    expect(v).not.toHaveAttribute('controls');
    expect(v).toHaveAttribute('poster', '/flowai/c.jpg');
  });

  it('canPlay 一次性兜底：挂载不播（前置 0）→ canPlay 后 1 次 → 再 canPlay 仍 1 次', () => {
    renderPlay(detail);
    const v = screen.getByTestId('video');
    expect(playSpy.mock.calls.length).toBe(0);                    // 前置：冻结语义正面锚——实现若回退成"预览分支也 play"此处即红
    fireEvent.canPlay(v);
    expect(playSpy.mock.calls.length).toBe(1);
    fireEvent.canPlay(v);                                          // 二次 canplay（暂停回落/stall/seek 场景）不偷偷续播
    expect(playSpy.mock.calls.length).toBe(1);
  });
});

// ─── P4 播放交互（spec v3.1 状态机）───
describe('PlayView P4 播放', () => {
  beforeEach(() => {
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('点击立即观看：同一 video 元素续播（身份 + unmute + controls + src 不变）', () => {
    const { rer, onPlayingChange } = renderForRerender();
    const v = screen.getByTestId('video');
    fireEvent.click(screen.getByRole('button', { name: /立即观看/ }));
    expect(onPlayingChange).toHaveBeenCalledWith(true);
    rer(true);
    expect(screen.getByTestId('video')).toBe(v);                  // 单元素约束（F4/B1）——重挂载即红
    expect((v as HTMLVideoElement).muted).toBe(false);
    expect(v).toHaveAttribute('controls');
    expect(v.getAttribute('src')).toBe(detail.videoUrl);
  });

  it('降级：play 被拒 → 回静音 + 音量提示 + controls 仍在', async () => {
    playSpy.mockRejectedValueOnce(new Error('NotAllowedError'));
    renderPlay(detail, vi.fn(), true);                            // 直接播放态渲染触发 effect catch
    await screen.findByText(/音量/);                               // antd App 注不进 mock 实例——断真实 toast 文本（spec v3.1）
    const v = screen.getByTestId('video') as HTMLVideoElement;
    expect(v.muted).toBe(true);                                   // catch 内 el.muted = true（唯一 imperative 覆写点）
    expect(v).toHaveAttribute('controls');
  });

  it('暂停保持播放态（修订：点视频=原生暂停切换，UI 不回预览）——onPause 不接 onPlayingChange，③④ 不回归', () => {
    const { rer, onPlayingChange } = renderForRerender();
    rer(true);
    expect(screen.queryByTestId('desc-panel')).toBeNull();        // 播放态 ③④ 隐藏（A2）
    const v = screen.getByTestId('video') as HTMLVideoElement;
    fireEvent.pause(v);
    expect(onPlayingChange).not.toHaveBeenCalled();                // 暂停不再回落（原 v3.1"暂停=回预览"改判）
    expect(screen.queryByTestId('desc-panel')).toBeNull();        // 播放态 UI 保持
    expect(v.hasAttribute('controls')).toBe(true);                 // controls 仍在，可手动续播
  });

  it('播完 = 回预览首帧：currentTime 归零 + onPlayingChange(false)', () => {
    const { rer, onPlayingChange } = renderForRerender();
    rer(true);
    const v = screen.getByTestId('video') as HTMLVideoElement;
    v.currentTime = 12;                                            // jsdom currentTime 是普通属性初值 0——不预设断言恒过
    fireEvent.ended(v);
    expect(onPlayingChange).toHaveBeenCalledWith(false);
    expect(v.currentTime).toBe(0);
    rer(false);
    expect(screen.getByTestId('desc-panel')).toBeInTheDocument();
  });
});

// ─── P3 按钮组与布局（spec v3.1）───
describe('PlayView P3 UI', () => {
  beforeEach(() => {
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('按钮组：次要钮深灰实底白字；立即观看/分享圆形（U4/U6）；喜欢无数字（U5）', () => {
    renderPlay({ ...detail, canViewProcess: true, likeCount: 6 });
    const watch = screen.getByRole('button', { name: /立即观看/ });
    expect(watch.className).toContain('bg-white');
    expect(watch.className).toContain('w-9');                      // U4 圆形（md:w-10）
    expect(watch.textContent).not.toContain('立即观看');            // U4 文字移除（aria-label 保留定位）
    expect(watch.querySelector('svg')).toBeTruthy();               // U4 播放图标
    const process = screen.getByRole('button', { name: /查看制作过程/ });
    expect(process.className).toContain('bg-[#2f2f2f]');
    expect(process.className).toContain('text-white');
    const like = screen.getByRole('button', { name: /喜欢/ });
    expect(like.className).toContain('bg-[#2f2f2f]');
    expect(like.textContent).not.toContain('6');                    // U5 只显图标，数字不渲染
    const share = screen.getByRole('button', { name: /分享/ });
    expect(share.className).toContain('bg-[#2f2f2f]');
    expect(share.className).toContain('w-9');                      // U6 圆形
  });

  it('布局：UI 列 pointer-events-none + ③④ 区块 auto + 渐变遮罩 + ④ 容器 pb reserve+50px（U3）+ 按钮组居中（U2）', () => {
    renderPlay(detail);
    const uiCol = screen.getByTestId('ui-col');
    expect(uiCol.className).toContain('pointer-events-none');
    const block = screen.getByTestId('preview-block');
    expect(block.className).toContain('pointer-events-auto');
    expect(block.className).toContain('bg-gradient-to-t');
    expect(block.className).toContain('from-black/70');
    const btnRow = screen.getByRole('button', { name: /立即观看/ }).parentElement;
    expect(btnRow?.className).toContain('justify-center');                                       // U2 水平居中
    expect(btnRow?.className).toContain('pb-[calc(var(--vw-carousel-reserve)+50px)]');           // U3 轮播条高 + 50px 间隙
  });

  it('顶栏：pl-4 md:pl-8 + pr-[var(--vw-close-reserve)]，无 md:px-8 残留（P0-2 防复活）', () => {
    renderPlay(detail);
    const topbar = screen.getByText('作者').parentElement;
    expect(topbar?.className).toContain('md:pl-8');
    expect(topbar?.className).toContain('pr-[var(--vw-close-reserve)]');
    expect(topbar?.className).not.toContain('md:px-8');
    expect(topbar?.className).not.toContain('md:pr-8');
  });
});
