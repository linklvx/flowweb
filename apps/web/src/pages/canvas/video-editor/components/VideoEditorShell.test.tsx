import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { VideoEditorShell, hasPendingWork } from './VideoEditorShell';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { hasUnsyncedCanvasChanges } from '@/stores/canvasCollabRuntime';
import { useConfirmModalStore } from '@/stores/confirmModalStore';
import { ConfirmModal } from '@/pages/canvas/components/ConfirmModal';
import { isGroupEditContext } from '@/hooks/useGroupKeyboard';
import { upsertProject, patchProject } from '@/api/videoProjectApi';
import { createDefaultProjectData } from '../types';
import { useEditorStore } from '../store/editorStore';
import { LAST_ASPECT_KEY } from '../timeline/canvas-size';

vi.mock('@/api/videoProjectApi', () => ({
  upsertProject: vi.fn(),
  patchProject: vi.fn(),
  getProjectByNode: vi.fn().mockResolvedValue(null),
  deleteProjectByNode: vi.fn(),
}));

// 批6：hasUnsyncedCanvasChanges 测试缝——真实谓词（rebuildPending||provider.hasUnsyncedChanges）
// 的置位/清除语义由 conn.spec 批1-3/1-4 直测；此处控制返回值锚定 Shell 谓词消费（重建窗口半边）。
// 其余导出经 importOriginal 原样保留（测试环境无 provider ⇒ 真实值本就是 false，默认实现不改变既有用例）
vi.mock('@/stores/canvasCollabRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/canvasCollabRuntime')>();
  return { ...actual, hasUnsyncedCanvasChanges: vi.fn(() => false) };
});

/** 批6：patchProject mock 返回值（完整 VideoProjectDto 形状——onSaved 只消费 updatedAt） */
const patchDto = () => ({
  id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
  data: createDefaultProjectData(), updatedAt: 't1',
});

describe('VideoEditorShell', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    // Shell 接线后 open 即触发 upsertProject → loadProject；mock 全量 DTO（data 用真实默认工程形状）
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
  });
  it('open=false 不渲染；open 后渲染全屏壳与占位区', async () => {
    const { rerender } = render(<VideoEditorShell />);
    expect(screen.queryByTestId('video-editor-shell')).not.toBeInTheDocument();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    rerender(<VideoEditorShell />);
    expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument(); // PreviewPlayer 替换 PreviewPlaceholder（Task 8）
    // 入口时序（Task 14）：面板先 loading 禁编辑，loadProject resolve 后才就绪为 timeline-panel
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
  });
  it('点遮罩不关闭（closeOnBackdrop=false 透传）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    // 层级：遮罩 > role=dialog > video-editor-shell
    fireEvent.click(screen.getByTestId('video-editor-shell').parentElement!.parentElement!);
    expect(useVideoEditorStore.getState().open).toBe(true);
  });
  it('收起按钮 → close（经 handleClose：flush 排空后异步关，M1 检查点）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    fireEvent.click(screen.getByText('收起'));
    await waitFor(() => expect(useVideoEditorStore.getState().open).toBe(false));
  });
  it('编辑器 open 时 isGroupEditContext 恒 true（画布快捷键早退，spec 验收 27）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    expect(isGroupEditContext(document.body)).toBe(true);
    useVideoEditorStore.setState({ open: false });
    expect(isGroupEditContext(document.body)).toBe(false);
  });
  it('编辑器打开期间 Delete 通路隔离——根 div 带 nokey 且焦点移入壳内（C1 回归锁）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    const shell = screen.getByTestId('video-editor-shell');
    expect(shell.className).toContain('nokey');
    // 焦点断言：open 后焦点应落在壳内（initialFocusRef 生效），而非残留画布按钮
    await waitFor(() => expect(shell).toContainElement(document.activeElement as HTMLElement | null));
  });
  it('P0-A 回归：壳内 antd 弹层挂载容器归属壳节点（删 Shell 的 ConfigProvider 后此用例必红）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()); // 就绪（upsert → loadProject）
    fireEvent.click(screen.getByText('导出')); // 打开导出弹层（Task 19 起为 ExportPopover——批 1 壳内归属语义不变）
    await waitFor(() => {
      const wrap = document.querySelector('.ant-popover');
      expect(wrap).toBeTruthy();
      // 容器归属断言（真红点）：Popover 弹层挂进壳内而非 body 直挂——
      // 无 ConfigProvider(getPopupContainer) 时 wrap.closest(壳) === null，用例红
      expect((wrap as HTMLElement).closest('[data-testid="video-editor-shell"]')).not.toBeNull();
    });
  });
  it('布局为可调面板组：垂直(主区/时间轴) + 水平(素材/预览/属性) 各两级', async () => {
    // 复用 P0-A 渲染等待方式（upsert → loadProject 就绪）
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    // v2 DOM 属性 data-panel-group-id/data-panel-id（组 id ve-vertical/ve-horizontal 由实现写入）
    expect(document.querySelectorAll('[data-panel-group-id]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-panel-group-id="ve-vertical"]')).not.toBeNull();
    expect(document.querySelector('[data-panel-group-id="ve-horizontal"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-panel-id]').length).toBe(5); // vertical 2 + horizontal 3
  });
  it('顶栏比例按钮存在且点击切换 canvasSize（走真实 store）+ 记忆写入', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    expect(screen.getByTestId('aspect-ratio-button')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aspect-ratio-button'));
    await waitFor(() => expect(screen.getByText('9:16（1080×1920）')).toBeInTheDocument());
    fireEvent.click(screen.getByText('9:16（1080×1920）'));
    await waitFor(() => expect(useEditorStore.getState().data!.canvasSize).toEqual({ width: 1080, height: 1920 }));
    expect(localStorage.getItem(LAST_ASPECT_KEY)).toBe('9:16');
  });
  it('新建工程默认画布用记忆比例（LAST_ASPECT_KEY——spec 5.1 D6 显式不静默）', async () => {
    localStorage.setItem(LAST_ASPECT_KEY, '9:16');
    try {
      useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
      render(<VideoEditorShell />);
      await waitFor(() => expect(vi.mocked(upsertProject)).toHaveBeenCalled());
      const calls = vi.mocked(upsertProject).mock.calls; // 本文件 beforeEach 无 clearAllMocks——取最后一次调用
      expect(calls[calls.length - 1][0]).toMatchObject({
        data: { canvasSize: { width: 1080, height: 1920 } },
      });
    } finally {
      localStorage.removeItem(LAST_ASPECT_KEY);
    }
  });
  it('loadProject 迁移不触发 autosave（幻影 PATCH 过滤——I2）', async () => {
    vi.useFakeTimers();
    try {
      useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
      render(<VideoEditorShell />);
      // upsertProject 已 resolve（microtask）→ loadProject 已跑 → 推进防抖窗口
      await vi.advanceTimersByTimeAsync(2000);
      expect(vi.mocked(upsertProject)).toHaveBeenCalled();
      expect(vi.mocked(patchProject)).not.toHaveBeenCalled(); // 零幻影 PATCH
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('批0d：Shell 数据止血接线（catch 不放行 + beforeunload + editorDirty）', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    useCanvasStore.setState({ editorDirty: false });
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
  });

  it('flush 异常路径不放行：保存链路异常时 handleClose 不 close（close=丢出口，数据留编辑器重试）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()); // ready
    // 构造 flush reject：setSaveState 抛错 → doSave 在 onStateChange('saving')（try 外）reject → flush reject
    const spy = vi.spyOn(useEditorStore.getState(), 'setSaveState').mockImplementation(() => { throw new Error('boom'); });
    try {
      act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); }); // 编辑 → notifyChange（dirty 排队）
      fireEvent.click(screen.getByText('收起')); // handleClose → flush → reject → .catch
      await act(async () => {}); // flush microtask 排空
      expect(useVideoEditorStore.getState().open).toBe(true); // 不 close——数据留在编辑器给用户重试
    } finally {
      spy.mockRestore();
    }
  });

  it('editorDirty true 时 beforeunload preventDefault（B4——关标签无提示丢拦截）', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()); // ready
    act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); }); // 编辑 → notifyChange → latch 置位
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('批6：红2f″ beforeunload 全组判据（defaultPrevented 场景矩阵）', () => {
  // ⚠ 已知残留（sticky activation，平台行为不修）：浏览器 tab 激活恢复后 beforeunload 可能被
  // 浏览器策略忽略（Chrome 需先有 sticky user activation）——jsdom 断言 defaultPrevented 是
  // 谓词级锚，不覆盖该浏览器策略层
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    useCanvasStore.setState({ editorDirty: false, collabReadOnly: false, wsAuthNotice: null });
    vi.mocked(hasUnsyncedCanvasChanges).mockReset().mockReturnValue(false);
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
    vi.mocked(patchProject).mockReset().mockResolvedValue(patchDto());
  });

  const fire = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  async function openReady() {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
  }
  const edit = () => act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); });

  it('本地编辑后（editorDirty=true）→ 拦', async () => {
    await openReady();
    edit(); // notifyChange → latch 即时置位（防抖窗口内也是"未落库"）
    expect(useCanvasStore.getState().editorDirty).toBe(true);
    expect(fire()).toBe(true);
  });

  it('零编辑 → 不拦（干净编辑器无噪音）', async () => {
    await openReady();
    expect(useCanvasStore.getState().editorDirty).toBe(false);
    expect(fire()).toBe(false);
  });

  it('仅几何回写（Origin.Geometry 不入编辑器链）→ 不拦', async () => {
    await openReady();
    // 结构性保证：editorDirty 唯一置位源=autosave.onDirtyChange（editorStore.data 订阅触发）；
    // S1 几何回写（dispatchSystemIntents origin=Geometry）只写 canvasStore/doc，不触碰
    // editorStore.data。此处以画布侧几何变化代表该路径——editorDirty 保持 false
    act(() => {
      useCanvasStore.setState({ nodes: [{ id: 'g1', type: 'group', position: { x: 99, y: 99 }, data: {} } as any] });
    });
    expect(useCanvasStore.getState().editorDirty).toBe(false);
    expect(fire()).toBe(false);
  });

  it('正常保存后（patch 成功 onDirtyChange(false)）→ 不拦（噪音防回归）', async () => {
    await openReady();
    vi.useFakeTimers();
    try {
      edit(); // notifyChange 的防抖 timer 须注册进 fake 时钟（先切 fake 再编辑）
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); }); // 防抖到期 → PATCH 成功
      expect(useCanvasStore.getState().editorDirty).toBe(false);
      expect(fire()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('409 后（latch 不清）→ 拦', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    vi.mocked(patchProject).mockReset().mockRejectedValue(err);
    await openReady();
    vi.useFakeTimers();
    try {
      edit();
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); }); // 首发 409 → onConflict，latch 保持
      expect(useCanvasStore.getState().editorDirty).toBe(true);
      expect(fire()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('退避耗尽后（B4）→ 拦', async () => {
    vi.mocked(patchProject).mockReset().mockRejectedValue(new Error('network'));
    await openReady();
    vi.useFakeTimers();
    try {
      edit();
      await act(async () => { await vi.advanceTimersByTimeAsync(1500 + 1000 + 4000 + 16000 + 100); }); // 首发+3 次退避全烧完
      expect(useCanvasStore.getState().editorDirty).toBe(true); // 耗尽不清 latch
      expect(fire()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auth 终态+未同步 → 仍拦（guardBlocked 仅 collabReadOnly 锚——编辑器数据不因 auth 拒连而消失）', async () => {
    await openReady();
    edit();
    act(() => {
      // auth 终态形态：WS 拒连、画布只读——但编辑器 latch（REST 侧）不因此清零
      useCanvasStore.setState({ collabReadOnly: true, wsAuthNotice: { reason: 'viewer', terminal: true } });
    });
    expect(useCanvasStore.getState().editorDirty).toBe(true);
    expect(fire()).toBe(true);
  });

  it('重建窗口（recoverConnection 后未 healthy——rebuildPending=true）→ 拦（谓词另一半独立起效）', async () => {
    await openReady();
    // 零编辑（editorDirty=false）；谓词 WS 半边为真：终态重建后未 ack 的 rebuildPending 窗口
    // （hasUnsyncedCanvasChanges=rebuildPending||provider.hasUnsyncedChanges，批1-3 并入）
    vi.mocked(hasUnsyncedCanvasChanges).mockReturnValueOnce(true);
    expect(fire()).toBe(true);
  });
});

describe('批6：handleClose 三选（flush 失败 → ConfirmModal 重试保存/放弃修改并收起/取消）', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    useCanvasStore.setState({ editorDirty: false });
    useConfirmModalStore.getState().close();
    vi.mocked(hasUnsyncedCanvasChanges).mockReset().mockReturnValue(false);
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
  });

  /** 装置：409 冲突形态（latch=true、dirty=false——flush 即返 false，无需烧退避额度）
   *  patch 首发 reject 409 → 三选；「重试保存」补发走第二次 resolve */
  async function setupConflictAndOpenModal() {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    vi.mocked(patchProject).mockReset()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ ...patchDto(), updatedAt: 't2' });
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<><VideoEditorShell /><ConfirmModal /></>); // ConfirmModal 生产挂载在 CanvasView——测试并排渲染
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    vi.useFakeTimers();
    act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); }); // 编辑 → latch
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); }); // 首发 409 → onConflict + latch 保持
    expect(useCanvasStore.getState().editorDirty).toBe(true);
    fireEvent.click(screen.getByText('收起')); // handleClose → flush 即返 false → 三选
    await act(async () => {}); // flush promise microtask 排空
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush 失败 → 三按钮出现且不 close（数据留编辑器）', async () => {
    await setupConflictAndOpenModal();
    expect(useConfirmModalStore.getState().isOpen).toBe(true);
    expect(screen.getByText('重试保存')).toBeInTheDocument();
    expect(screen.getByText('放弃修改并收起')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
    expect(useVideoEditorStore.getState().open).toBe(true); // 不 close
  });

  it('「取消」→ 留编辑器、latch 不清（关标签仍拦）', async () => {
    await setupConflictAndOpenModal();
    fireEvent.click(screen.getByText('取消'));
    await act(async () => {});
    expect(useConfirmModalStore.getState().isOpen).toBe(false);
    expect(useVideoEditorStore.getState().open).toBe(true);
    expect(useCanvasStore.getState().editorDirty).toBe(true); // 未保存工作仍在
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('「放弃修改并收起」→ release+close 且 editorDirty 清零（显式确认=清除语义，beforeunload 解除）', async () => {
    await setupConflictAndOpenModal();
    fireEvent.click(screen.getByText('放弃修改并收起'));
    await act(async () => {});
    expect(useVideoEditorStore.getState().open).toBe(false);
    expect(useCanvasStore.getState().editorDirty).toBe(false); // 用户显式确认=清除
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // 放弃后不再拦
  });

  it('「重试保存」→ 补发成功 → close', async () => {
    await setupConflictAndOpenModal();
    fireEvent.click(screen.getByText('重试保存'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); }); // retry 补发 + flush 排空
    expect(vi.mocked(patchProject)).toHaveBeenCalledTimes(2); // 真的再保存了一次（非纯 flush 判 latch）
    expect(useVideoEditorStore.getState().open).toBe(false); // 成功 → close
    expect(useCanvasStore.getState().editorDirty).toBe(false);
  });
});

describe('批6：hasPendingWork() 导出（外部查询编辑器有无未保存工作）', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
    useEditorStore.getState().reset();
    useCanvasStore.setState({ editorDirty: false });
    vi.mocked(hasUnsyncedCanvasChanges).mockReset().mockReturnValue(false);
    vi.mocked(upsertProject).mockResolvedValue({
      id: 'p1', sourceNodeId: 'n1', workflowId: 'w', teamId: 'team1', title: 't',
      data: createDefaultProjectData(), updatedAt: 't0',
    });
    vi.mocked(patchProject).mockReset().mockResolvedValue(patchDto());
  });

  it('干净 false；编辑 true；保存成功 false；关闭后 false', async () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
    expect(hasPendingWork()).toBe(false); // 干净
    vi.useFakeTimers();
    try {
      act(() => { useEditorStore.setState({ data: createDefaultProjectData() }); }); // 编辑（防抖注册进 fake 时钟）
      expect(hasPendingWork()).toBe(true);  // dirty（防抖窗口）
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); }); // 保存成功
      expect(hasPendingWork()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(screen.getByText('收起')); // 干净收起（flush 空 → drained → close）
    await waitFor(() => expect(useVideoEditorStore.getState().open).toBe(false));
    expect(hasPendingWork()).toBe(false);      // 关闭后（活控制器引用置 null）
  });
});
