import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { MoveToFolderModal } from '../components/MoveToFolderModal';
import type { Folder } from '../types';

// CreateCanvasModal（含 antd Select）的用例拆在独立文件：同一 jsdom 实例第二次挂载 Select
// 会触发 cssinjs 坏选择符崩溃并级联污染本文件后续测试（见 antd5 测试坑 #5）

const folders: Folder[] = [
  { id: 'f1', name: '文件夹一', parentId: null, createdAt: '', updatedAt: '' },
  { id: 'f2', name: '文件夹二', parentId: null, createdAt: '', updatedAt: '' },
];

describe('CreateFolderModal', () => {
  it('空名称时确认按钮禁用，输入后点击确认回传名称', () => {
    const onOk = vi.fn();
    render(<CreateFolderModal open onOk={onOk} onCancel={vi.fn()} />);
    const btn = screen.getByRole('button', { name: '确 定' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '新文件夹' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOk).toHaveBeenCalledWith('新文件夹');
  });
  it('重命名模式回填 initialName', () => {
    render(<CreateFolderModal open initialName="旧名" onOk={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue('旧名')).toBeInTheDocument();
  });
});

describe('MoveToFolderModal', () => {
  it('当前文件夹禁用并标「当前位置」，选择目标后确认回传', () => {
    const onOk = vi.fn();
    render(<MoveToFolderModal open folders={folders} currentFolderId="f1" onOk={onOk} onCancel={vi.fn()} />);
    expect(screen.getByText('当前位置')).toBeInTheDocument();
    fireEvent.click(screen.getByText('文件夹二'));
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    expect(onOk).toHaveBeenCalledWith('f2');
  });
  it('可选「根目录」回传 null', () => {
    const onOk = vi.fn();
    render(<MoveToFolderModal open folders={folders} currentFolderId="f1" onOk={onOk} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('根目录（未分组）'));
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    expect(onOk).toHaveBeenCalledWith(null);
  });
});
