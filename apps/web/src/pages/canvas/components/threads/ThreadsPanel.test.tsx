// ThreadsPanel.test.tsx（Y4b T11 侧滑面板三组+清理）
// 施工单 Step 1：三组渲染（active 按 nodeId 分组+摘录、resolved 折叠+计数、orphan 徽标+
// 「清理全部」→cleanupOrphans 调用）+ 空态档。
// Y5 T8 评审 I：动作面随 canEdit 闸——只读态回复/解决/重开/清理禁用（禁静默丢）。
// 面板=展示组件（视图+动作经 props 注入；store 接线单点在 page.tsx）——RED/GREEN 判据自持，
// 不随 T10 threadsStore 落地时序漂移（接口对齐假设见 task-11-report.md 偏离登记）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import {
  ThreadsPanel,
  type ThreadsViewData,
  type ThreadViewItem,
} from './ThreadsPanel';
import { useCanvasStore } from '@/stores/canvasStore';

const thread = (over: Partial<ThreadViewItem> & Pick<ThreadViewItem, 'id' | 'nodeId'>): ThreadViewItem => ({
  kind: 'node',
  resolved: false,
  createdAt: 1,
  comments: [],
  ...over,
});

describe('ThreadsPanel（Y4b T11 三组互斥+清理）', () => {
  let onCleanup: ReturnType<typeof vi.fn>;
  let onAddComment: ReturnType<typeof vi.fn>;
  let onSetResolved: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onCleanup = vi.fn();
    onAddComment = vi.fn(() => true);
    onSetResolved = vi.fn(() => true);
    onClose = vi.fn();
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });
  });

  const renderPanel = (view: ThreadsViewData) =>
    render(
      <ThreadsPanel
        view={view}
        onCleanup={onCleanup}
        onAddComment={onAddComment}
        onSetResolved={onSetResolved}
        onClose={onClose}
      />,
    );

  it('三组渲染：进行中按 nodeId 分组+摘录、已解决折叠+计数、失效徽标+「清理全部」→onCleanup', () => {
    renderPanel({
      active: [
        {
          nodeId: 'n1',
          threads: [
            thread({
              id: 't1', nodeId: 'n1', kind: 'text', excerpt: '锚定的正文',
              comments: [{ id: 'c1', authorId: 'u1', body: '第一条评论', createdAt: 1 }],
            }),
            thread({ id: 't2', nodeId: 'n1', createdAt: 2 }),
          ],
        },
      ],
      resolved: [thread({ id: 't3', nodeId: 'n2', kind: 'text', resolved: true, excerpt: '已解决的锚文本', createdAt: 3 })],
      orphan: [thread({ id: 't4', nodeId: 'gone', createdAt: 4 })],
    });

    const active = screen.getByTestId('threads-group-active');
    expect(within(active).getByText('进行中')).toBeInTheDocument();
    expect(within(active).getByText('节点 n1')).toBeInTheDocument();   // 按 nodeId 分组
    expect(within(active).getAllByTestId('thread-row')).toHaveLength(2);
    expect(within(active).getByText('锚定的正文')).toBeInTheDocument();  // 锚文本摘录

    // 已解决：折叠 + 计数（展开前不挂载内容）
    expect(screen.getByText('已解决 (1)')).toBeInTheDocument();
    expect(screen.queryByText('已解决的锚文本')).toBeNull();
    fireEvent.click(screen.getByText('已解决 (1)'));
    expect(screen.getByText('已解决的锚文本')).toBeInTheDocument();

    // 失效：计数徽标 + 「清理全部」→ onCleanup
    expect(screen.getByTestId('threads-group-orphan')).toBeInTheDocument();
    expect(screen.getByText('失效')).toBeInTheDocument();
    expect(screen.getByTestId('threads-orphan-badge')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /清理全部/ }));
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it('线程展开=评论列表+回复框+解决开关（§3.2 功能面）', () => {
    renderPanel({
      active: [
        {
          nodeId: 'n1',
          threads: [
            thread({
              id: 't1', nodeId: 'n1',
              comments: [{ id: 'c1', authorId: 'u1', body: '首条评论', createdAt: 1 }],
            }),
          ],
        },
      ],
      resolved: [],
      orphan: [],
    });

    fireEvent.click(screen.getByText('#t1'));
    expect(screen.getByText('首条评论')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('回复…'), { target: { value: '新回复' } });
    // antd 两字中文按钮自动插空格（回 复/解 决）——可及名按正则匹配
    fireEvent.click(screen.getByRole('button', { name: /回\s*复/ }));
    expect(onAddComment).toHaveBeenCalledWith('t1', '新回复');
    fireEvent.click(screen.getByRole('button', { name: /解\s*决/ }));
    expect(onSetResolved).toHaveBeenCalledWith('t1', true);
  });

  it('空态档：三组全空 → 「暂无批注」，不渲染分组标题与清理入口', () => {
    renderPanel({ active: [], resolved: [], orphan: [] });
    expect(screen.getByText('暂无批注')).toBeInTheDocument();
    expect(screen.queryByText('已解决 (0)')).toBeNull();
    expect(screen.queryByRole('button', { name: /清理全部/ })).toBeNull();
    expect(screen.queryByTestId('threads-group-active')).toBeNull();
  });

  it('Y5 T8：collabReadOnly=true ⇒ 回复/解决/清理全部禁用、点击零回调（禁静默丢）', () => {
    useCanvasStore.setState({ collabReadOnly: true });
    renderPanel({
      active: [
        { nodeId: 'n1', threads: [thread({ id: 't1', nodeId: 'n1' })] },
      ],
      resolved: [],
      orphan: [thread({ id: 't4', nodeId: 'gone', createdAt: 4 })],
    });

    expect(screen.getByRole('button', { name: /清理全部/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /清理全部/ }));
    expect(onCleanup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('#t1'));
    expect(screen.getByRole('button', { name: /回\s*复/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /解\s*决/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /回\s*复/ }));
    fireEvent.click(screen.getByRole('button', { name: /解\s*决/ }));
    expect(onAddComment).not.toHaveBeenCalled();
    expect(onSetResolved).not.toHaveBeenCalled();
  });
});
