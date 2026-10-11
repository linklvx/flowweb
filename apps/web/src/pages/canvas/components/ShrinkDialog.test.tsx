// apps/web/src/pages/canvas/components/ShrinkDialog.test.tsx
// Y0b-4 T11：瘦身对话框——节点按 utf8 字节降序+勾选删除/纯重新校准/vacuum 入口（residue>50%×limit
// 亮出+二次确认）+发起端 undoManager.clear+localDocBytes 重置（watermark——对端不清）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { message, Modal } from 'antd';
import { ShrinkDialog } from './ShrinkDialog';
import { useCanvasStore } from '@/stores/canvasStore';
import { makeChild, seedCanvas } from '@/test/fixtures/canvas';

const shrinkMock = vi.hoisted(() => vi.fn());
const vacuumMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/collabApi', () => ({ shrink: shrinkMock, vacuum: vacuumMock }));
const umClear = vi.hoisted(() => vi.fn());
// partial mock：Origin 等真实导出保留（canvasCollabRuntime 顶层消费），仅 getUndoManager 换桩
vi.mock('@/stores/canvasUndo', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUndoManager: () => ({ clear: umClear }),
}));
// location.reload jsdom [Unforgeable] 不可 spy——stubGlobal 整体替换（t9.spec 先例）
const reloadSpy = vi.fn();

const reset = () => {
  seedCanvas([]);
  useCanvasStore.setState({
    quotaOver: true, quotaLimitBytes: 8_388_608, quotaSoftLimitBytes: 6_710_886,
    quotaResidueBytes: undefined, localDocBytes: 9_000_000, localDelta: 0, wsQuotaTerminal: null,
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  reset();
  reloadSpy.mockClear();
  umClear.mockClear();
  shrinkMock.mockReset();
  vacuumMock.mockReset();
  vi.stubGlobal('location', { reload: reloadSpy });
});
afterEach(() => {
  act(() => { vi.runAllTimers(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Modal.destroyAll();
  reset();
});

/** 双节点种子：big（data JSON 字节大）/small（小）——排序断言的确定性数据面 */
const seedTwoNodes = () => seedCanvas([
  makeChild({ id: 'small', type: 'textInput', data: { content: 'a' } }),
  makeChild({ id: 'big', type: 'imageGen', data: { prompt: 'x'.repeat(300) } }),
]);

const renderOpen = () => {
  render(<ShrinkDialog open onClose={() => {}} projectId="p1" />);
  act(() => { vi.runAllTimers(); });   // flush Modal 入场动画 timer
};

describe('ShrinkDialog（T11）', () => {
  it('节点列表按 utf8 字节降序+勾选删除→shrink(deleteNodeIds)+ok 档：undo 清理+watermark 重置+成功提示+关闭', async () => {
    seedTwoNodes();
    shrinkMock.mockResolvedValue({ result: 'ok', watermark: 4_096, deletedIds: ['big', 'small'], thawed: true });
    const successSpy = vi.spyOn(message, 'success');
    renderOpen();
    // 降序：big（≈300+ 字节）在 small（个位数）前
    const rows = screen.getAllByTestId(/^shrink-row-/);
    expect(rows[0].dataset.testid).toBe('shrink-row-big');
    expect(rows[1].dataset.testid).toBe('shrink-row-small');
    act(() => { fireEvent.click(screen.getByTestId('shrink-check-big')); });
    await act(async () => { fireEvent.click(screen.getByTestId('shrink-submit-btn')); });
    expect(shrinkMock).toHaveBeenCalledWith('p1', { deleteNodeIds: ['big'] });
    expect(umClear).toHaveBeenCalledTimes(1);                       // 发起端 undo 清理（对端不清）
    expect(useCanvasStore.getState().localDocBytes).toBe(4_096);    // watermark 重置
    expect(useCanvasStore.getState().localDelta).toBe(0);
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('已瘦身'));
  });

  it('still-over 档：仍超 X KB 警告（KB 取整）+对话框保持打开（导出引导不强制关）', async () => {
    seedTwoNodes();
    shrinkMock.mockResolvedValue({ stillOver: true, bytes: 9_000_000, limit: 8_388_608 });
    const warnSpy = vi.spyOn(message, 'warning');
    let closed = false;
    render(<ShrinkDialog open onClose={() => { closed = true; }} projectId="p1" />);
    act(() => { vi.runAllTimers(); });
    act(() => { fireEvent.click(screen.getByTestId('shrink-check-big')); });
    await act(async () => { fireEvent.click(screen.getByTestId('shrink-submit-btn')); });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('8789KB'));   // 9000000/1024
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('导出'));
    expect(closed).toBe(false);
    expect(umClear).not.toHaveBeenCalled();
  });

  it('recalibrated 档：纯重新校准→watermark 重置+「已重新校准」+关闭；undo 不清（未删内容——栈仍有效）', async () => {
    seedTwoNodes();
    shrinkMock.mockResolvedValue({ result: 'recalibrated', watermark: 8_000_000, thawed: false });
    const successSpy = vi.spyOn(message, 'success');
    let closed = false;
    render(<ShrinkDialog open onClose={() => { closed = true; }} projectId="p1" />);
    act(() => { vi.runAllTimers(); });
    await act(async () => { fireEvent.click(screen.getByTestId('shrink-recalibrate-btn')); });
    expect(shrinkMock).toHaveBeenCalledWith('p1', { recalibrate: true });
    expect(useCanvasStore.getState().localDocBytes).toBe(8_000_000);
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('已重新校准'));
    expect(closed).toBe(true);
    expect(umClear).not.toHaveBeenCalled();
  });

  it('vacuum 入口显隐：residue≤50%×limit 不亮出；>50% 亮出+二次确认文案→确认→vacuum+reload', async () => {
    seedTwoNodes();
    // ≤50%：4MB ≤ 4194304——不亮出
    useCanvasStore.setState({ quotaResidueBytes: 4_000_000, quotaLimitBytes: 8_388_608 });
    renderOpen();
    expect(screen.queryByTestId('shrink-vacuum-btn')).not.toBeInTheDocument();
    // >50%：5MB > 4194304——亮出
    act(() => { useCanvasStore.setState({ quotaResidueBytes: 5_000_000 }); });
    act(() => { vi.runAllTimers(); });
    const vacBtn = screen.getByTestId('shrink-vacuum-btn');
    vacuumMock.mockResolvedValue({ result: 'ok', generation: 2, bytes: 1_000 });
    act(() => { fireEvent.click(vacBtn); });
    act(() => { vi.runAllTimers(); });
    expect(screen.getByText(/将刷新所有在线成员，确认重建？/)).toBeInTheDocument();   // 二次确认（明确告知全端刷新）
    await act(async () => { fireEvent.click(screen.getByText('OK')); });
    expect(vacuumMock).toHaveBeenCalledWith('p1');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(reloadSpy).toHaveBeenCalledTimes(1);                       // 重建后本端刷新（WS 死时唯一出路）
  });

  it('vacuum 非 ok 档（skip-low-residue）：提示不刷新', async () => {
    seedTwoNodes();
    useCanvasStore.setState({ quotaResidueBytes: 5_000_000, quotaLimitBytes: 8_388_608 });
    vacuumMock.mockResolvedValue({ result: 'skip-low-residue' });
    const warnSpy = vi.spyOn(message, 'warning');
    renderOpen();
    act(() => { fireEvent.click(screen.getByTestId('shrink-vacuum-btn')); });
    act(() => { vi.runAllTimers(); });
    await act(async () => { fireEvent.click(screen.getByText('OK')); });
    expect(vacuumMock).toHaveBeenCalledWith('p1');
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
