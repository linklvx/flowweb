import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { mockUseAuth, mockCreditsStore } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockCreditsStore: {
    credits: 88,
    subscriptionCredits: 12,
    subscriptionCreditsExpiry: null,
    loading: false,
    error: null,
    fetchBalance: vi.fn(),
    updateCredits: vi.fn(),
    isSubscriptionActive: vi.fn(() => false),
  },
}));

vi.mock('@/stores/creditsStore', () => ({
  useCreditsStore: () => mockCreditsStore,
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

import { CanvasTopBar } from './CanvasTopBar';

describe('CanvasTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderBar() {
    return render(
      <MemoryRouter>
        <CanvasTopBar projectId="test-pid" projectName="未命名项目" />
      </MemoryRouter>,
    );
  }

  it('should display user avatar when authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u1@flowai.dev', name: 'U1' },
      loading: false,
    });
    renderBar();
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('should display credits from store', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u1@flowai.dev', name: 'U1' },
      loading: false,
    });
    renderBar();
    expect(screen.getByLabelText('查看积分明细')).toBeDefined();
  });

  it('should show login link when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderBar();
    expect(screen.getByText('登录')).toBeDefined();
  });
});
