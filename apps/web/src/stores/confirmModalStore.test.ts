import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConfirmModalStore } from './confirmModalStore';

describe('confirmModalStore', () => {
  beforeEach(() => {
    useConfirmModalStore.setState({
      isOpen: false,
      title: '',
      content: '',
      cancelText: '',
      primaryText: '',
      primaryType: 'default',
      onClose: () => {},
      onPrimary: () => {},
    });
  });

  it('should initialize with isOpen false', () => {
    expect(useConfirmModalStore.getState().isOpen).toBe(false);
  });

  it('show() should set isOpen to true and apply config', () => {
    useConfirmModalStore.getState().show({
      title: 'Test Title',
      content: 'Test Content',
      cancelText: 'Cancel',
      primaryText: 'Confirm',
      primaryType: 'danger',
      onClose: vi.fn(),
      onPrimary: vi.fn(),
    });

    const state = useConfirmModalStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.title).toBe('Test Title');
    expect(state.content).toBe('Test Content');
    expect(state.cancelText).toBe('Cancel');
    expect(state.primaryText).toBe('Confirm');
    expect(state.primaryType).toBe('danger');
  });

  it('show() should set optional secondaryText and onSecondary', () => {
    useConfirmModalStore.getState().show({
      title: 'T',
      content: 'C',
      cancelText: 'Cancel',
      primaryText: 'OK',
      primaryType: 'primary',
      secondaryText: 'Save',
      onClose: vi.fn(),
      onSecondary: vi.fn(),
      onPrimary: vi.fn(),
    });

    const state = useConfirmModalStore.getState();
    expect(state.secondaryText).toBe('Save');
    expect(state.onSecondary).toBeDefined();
  });

  it('close() should set isOpen to false', () => {
    useConfirmModalStore.getState().show({
      title: 'T', content: 'C', cancelText: 'X', primaryText: 'Y', primaryType: 'default',
      onClose: vi.fn(), onPrimary: vi.fn(),
    });
    expect(useConfirmModalStore.getState().isOpen).toBe(true);

    useConfirmModalStore.getState().close();
    expect(useConfirmModalStore.getState().isOpen).toBe(false);
  });

  it('show() while already open should call old onClose first', () => {
    const oldOnClose = vi.fn();

    useConfirmModalStore.getState().show({
      title: 'Old', content: 'Old', cancelText: 'X', primaryText: 'Y', primaryType: 'default',
      onClose: oldOnClose, onPrimary: vi.fn(),
    });

    useConfirmModalStore.getState().show({
      title: 'New', content: 'New', cancelText: 'X', primaryText: 'Y', primaryType: 'default',
      onClose: vi.fn(), onPrimary: vi.fn(),
    });

    expect(oldOnClose).toHaveBeenCalledTimes(1);
  });
});
