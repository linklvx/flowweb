import { describe, it, expect, beforeEach } from 'vitest';
import { useAnnouncementStore } from './announcementStore';

describe('announcementStore', () => {
  beforeEach(() => {
    useAnnouncementStore.setState({
      visible: true,
      message: '欢迎来到 FlowAI',
      linkUrl: '/promo',
    });
  });

  it('should initialize with default state', () => {
    const state = useAnnouncementStore.getState();
    expect(state.visible).toBe(true);
    expect(state.message).toBe('欢迎来到 FlowAI');
  });

  it('should dismiss announcement', () => {
    const { dismiss } = useAnnouncementStore.getState();
    dismiss();
    const state = useAnnouncementStore.getState();
    expect(state.visible).toBe(false);
  });
});
