import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CreateCanvasModal } from '../components/CreateCanvasModal';
import type { Folder } from '../types';

// 独立文件：含 antd Select 的 Modal 同一 jsdom 实例只能挂载一次（antd5 测试坑 #5）
const { mockGetNextUntitledName } = vi.hoisted(() => ({ mockGetNextUntitledName: vi.fn() }));
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
  saveCanvas: vi.fn(),
  getNextUntitledName: mockGetNextUntitledName,
}));

const folders: Folder[] = [
  { id: 'f1', name: '文件夹一', parentId: null, createdAt: '', updatedAt: '' },
];

describe('CreateCanvasModal 预填失败降级（Fix 8）', () => {
  it('预填请求失败时不预填，必填校验维持现状', async () => {
    mockGetNextUntitledName.mockRejectedValue(new Error('net'));
    render(<CreateCanvasModal open folders={folders} defaultFolderId={null} onOk={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => expect(mockGetNextUntitledName).toHaveBeenCalled());
    expect(screen.getByLabelText('画布名称')).toHaveValue('');
    expect(screen.getByRole('button', { name: '确 定' })).toBeDisabled();
  });
});
