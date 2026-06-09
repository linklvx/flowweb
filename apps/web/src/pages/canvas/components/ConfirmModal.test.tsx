import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';
import { useConfirmModalStore } from '@/stores/confirmModalStore';

describe('ConfirmModal', () => {
  beforeEach(() => {
    useConfirmModalStore.setState({
      isOpen: false,
      title: '',
      content: '',
      cancelText: '',
      secondaryText: undefined,
      primaryText: '',
      primaryType: 'default',
      onClose: () => {},
      onSecondary: undefined,
      onPrimary: () => {},
    });
    document.body.innerHTML = '';
  });

  it('renders nothing when isOpen=false', () => {
    render(<ConfirmModal />);
    expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
  });

  it('renders title, content, and buttons when isOpen=true', () => {
    useConfirmModalStore.getState().show({
      title: '放弃未保存的更改？',
      content: '当前变换尚未保存',
      cancelText: '取消',
      secondaryText: '保留节点',
      primaryText: '放弃并删除',
      primaryType: 'danger',
      onClose: vi.fn(),
      onSecondary: vi.fn(),
      onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    expect(screen.getByText('放弃未保存的更改？')).toBeInTheDocument();
    expect(screen.getByText('当前变换尚未保存')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
    expect(screen.getByText('保留节点')).toBeInTheDocument();
    expect(screen.getByText('放弃并删除')).toBeInTheDocument();
  });

  it('does not render secondary button when onSecondary not provided', () => {
    useConfirmModalStore.getState().show({
      title: 'Test', content: 'Test', cancelText: 'Cancel',
      primaryText: 'OK', primaryType: 'default',
      onClose: vi.fn(), onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    expect(screen.queryByText('保留节点')).not.toBeInTheDocument();
  });

  it('calls onClose when cancel button clicked', () => {
    const onClose = vi.fn();
    useConfirmModalStore.getState().show({
      title: 'Test', content: 'Test', cancelText: 'Cancel',
      primaryText: 'OK', primaryType: 'default',
      onClose, onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onPrimary when primary button clicked', () => {
    const onPrimary = vi.fn();
    useConfirmModalStore.getState().show({
      title: 'Test', content: 'Test', cancelText: 'Cancel',
      primaryText: 'OK', primaryType: 'danger',
      onClose: vi.fn(), onPrimary,
    });
    render(<ConfirmModal />);
    fireEvent.click(screen.getByText('OK'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('calls onSecondary when secondary button clicked', () => {
    const onSecondary = vi.fn();
    useConfirmModalStore.getState().show({
      title: 'Test', content: 'Test', cancelText: 'Cancel',
      secondaryText: 'Secondary', primaryText: 'OK', primaryType: 'primary',
      onClose: vi.fn(), onSecondary, onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    fireEvent.click(screen.getByText('Secondary'));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay background is clicked', () => {
    const onClose = vi.fn();
    useConfirmModalStore.getState().show({
      title: 'Test', content: 'Test', cancelText: 'Cancel',
      primaryText: 'OK', primaryType: 'default',
      onClose, onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    const overlay = document.body.querySelector('.fixed.inset-0')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when inner card is clicked (stopPropagation)', () => {
    const onClose = vi.fn();
    useConfirmModalStore.getState().show({
      title: 'Stop Prop', content: 'Test', cancelText: 'Cancel',
      primaryText: 'OK', primaryType: 'default',
      onClose, onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    fireEvent.click(screen.getByText('Stop Prop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders via createPortal to document.body', () => {
    useConfirmModalStore.getState().show({
      title: 'T', content: 'C', cancelText: 'X',
      primaryText: 'Y', primaryType: 'default',
      onClose: vi.fn(), onPrimary: vi.fn(),
    });
    const { container } = render(<ConfirmModal />);
    expect(container.innerHTML).toBe('');
    const portalEl = document.body.querySelector('.fixed.inset-0');
    expect(portalEl).toBeTruthy();
  });

  it('calls onClose when Escape key pressed', () => {
    const onClose = vi.fn();
    useConfirmModalStore.getState().show({
      title: 'T', content: 'C', cancelText: 'X',
      primaryText: 'Y', primaryType: 'default',
      onClose, onPrimary: vi.fn(),
    });
    render(<ConfirmModal />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
