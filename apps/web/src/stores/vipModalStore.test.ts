import { describe, it, expect, beforeEach } from 'vitest';
import { useVipModalStore } from './vipModalStore';

describe('vipModalStore', () => {
  beforeEach(() => {
    useVipModalStore.setState({ visible: false });
  });

  it('should initialize with visible false', () => {
    expect(useVipModalStore.getState().visible).toBe(false);
  });

  it('open() should set visible to true', () => {
    useVipModalStore.getState().open();
    expect(useVipModalStore.getState().visible).toBe(true);
  });

  it('close() should set visible to false', () => {
    useVipModalStore.getState().open();
    expect(useVipModalStore.getState().visible).toBe(true);
    useVipModalStore.getState().close();
    expect(useVipModalStore.getState().visible).toBe(false);
  });

  it('should support full open → close cycle', () => {
    expect(useVipModalStore.getState().visible).toBe(false);
    useVipModalStore.getState().open();
    expect(useVipModalStore.getState().visible).toBe(true);
    useVipModalStore.getState().close();
    expect(useVipModalStore.getState().visible).toBe(false);
  });
});
