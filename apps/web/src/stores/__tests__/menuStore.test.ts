import { describe, it, expect, beforeEach } from 'vitest';
import { useMenuStore } from '../menuStore';

describe('menuStore', () => {
  beforeEach(() => {
    useMenuStore.setState({ isOpen: false });
  });

  it('初始状态 isOpen 为 false', () => {
    expect(useMenuStore.getState().isOpen).toBe(false);
  });

  it('open() 设置 isOpen 为 true', () => {
    useMenuStore.getState().open();
    expect(useMenuStore.getState().isOpen).toBe(true);
  });

  it('close() 设置 isOpen 为 false', () => {
    useMenuStore.getState().open();
    useMenuStore.getState().close();
    expect(useMenuStore.getState().isOpen).toBe(false);
  });

  it('toggle() 切换 isOpen', () => {
    expect(useMenuStore.getState().isOpen).toBe(false);
    useMenuStore.getState().toggle();
    expect(useMenuStore.getState().isOpen).toBe(true);
    useMenuStore.getState().toggle();
    expect(useMenuStore.getState().isOpen).toBe(false);
  });
});
