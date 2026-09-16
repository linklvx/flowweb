// 文件顶部装配（第七轮补全——原块无 harness，renderPlay/detail 全程未定义即 ReferenceError）：
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { App as AntdApp } from 'antd';
import * as api from '@/api/videoWorkApi';
import { PlayView } from '../PlayView';

vi.mock('@/api/videoWorkApi');
// C5 模板（PlayView 链上 useAuth）——vi.hoisted 与 vi.mock 平级声明
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));

const detail = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };

function renderPlay(d = detail, onDetailRefresh: Mock = vi.fn()) {
  // onError 自愈回调由外壳注入（PlayView 自身不拉详情——旧断言 fetchVideoWorkDetail 计数无法成立，第七轮改断言回调）
  render(<AntdApp><PlayView detail={d} onViewProcess={() => {}} onNeedLogin={() => {}} onDetailRefresh={onDetailRefresh} /></AntdApp>);
  return { onDetailRefresh };
}

describe('PlayView', () => {
  beforeEach(() => { vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue(detail as any); });

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
    const { rerender } = render(<AntdApp><PlayView detail={detail} onViewProcess={() => {}} onNeedLogin={onNeedLogin} onDetailRefresh={vi.fn()} /></AntdApp>);
    fireEvent.click(screen.getByRole('button', { name: /喜欢/ }));
    await waitFor(() => expect(onNeedLogin).toHaveBeenCalledTimes(1)); // 未登录 → 弹登录
    authCtx.user = { id: 'u1' }; // 登录成功（同一 mock 实例改值）
    rerender(<AntdApp><PlayView detail={detail} onViewProcess={() => {}} onNeedLogin={onNeedLogin} onDetailRefresh={vi.fn()} /></AntdApp>);
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

  it('视频 onError → 触发一次 onDetailRefresh 自愈（TTL 过期换新 URL；第二次 error 不再重试——第七轮加重试上限防对象已删的无限循环）', async () => {
    const { onDetailRefresh } = renderPlay(detail);
    fireEvent.click(screen.getByRole('button', { name: /立即观看/ })); // 先进入播放态——idle 态无 video 元素（C2 Task 8.2 ②）
    fireEvent.error(screen.getByTestId('video'));
    expect(onDetailRefresh).toHaveBeenCalledTimes(1);
    fireEvent.error(screen.getByTestId('video')); // 同一实例再次 error（对象已删场景）
    expect(onDetailRefresh).toHaveBeenCalledTimes(1); // retriedRef 一次性守卫
  });

  it('viewCount/likeCount 展示收进 desc-panel（C2 Task 8.2 ③——裸 /10/ 会误中无关文本）', () => {
    renderPlay(detail); // viewCount:10 likeCount:5
    const panel = screen.getByTestId('desc-panel');
    expect(panel).toHaveTextContent('10');   // 观看数
    expect(screen.getByRole('button', { name: /喜欢/ })).toHaveTextContent('5');
  });
});
