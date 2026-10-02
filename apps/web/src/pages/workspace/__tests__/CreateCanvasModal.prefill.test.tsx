import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateCanvasModal } from '../components/CreateCanvasModal';
import type { Folder } from '../types';

// 独立文件：含 antd Select 的 Modal 同一 jsdom 实例只能挂载一次（antd5 测试坑 #5）
const { mockGetNextUntitledName } = vi.hoisted(() => ({ mockGetNextUntitledName: vi.fn() }));
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
  getNextUntitledName: mockGetNextUntitledName,
}));

const folders: Folder[] = [
  { id: 'f1', name: '文件夹一', parentId: null, createdAt: '', updatedAt: '' },
  { id: 'f2', name: '文件夹二', parentId: null, createdAt: '', updatedAt: '' },
];

describe('CreateCanvasModal 预填（Fix 8）', () => {
  it('打开时预填下一个默认名可直接提交，改名后按新名提交', async () => {
    mockGetNextUntitledName.mockResolvedValue({ name: '画布4' });
    const onOk = vi.fn();
    render(<CreateCanvasModal open folders={folders} defaultFolderId="f1" onOk={onOk} onCancel={vi.fn()} />);

    // 预填完成前不提交，避免竞态
    await waitFor(() => expect(screen.getByLabelText('画布名称')).toHaveValue('画布4'));
    expect(screen.getByRole('button', { name: '确 定' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    expect(onOk).toHaveBeenCalledWith('画布4', 'f1');

    // 用户可修改预填名
    fireEvent.change(screen.getByLabelText('画布名称'), { target: { value: '新画布' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    expect(onOk).toHaveBeenCalledWith('新画布', 'f1');
    expect(mockGetNextUntitledName).toHaveBeenCalledTimes(1);
  });
});
