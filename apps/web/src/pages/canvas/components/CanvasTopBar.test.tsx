import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

// Mock fetch for credits
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

import { CanvasTopBar } from './CanvasTopBar';

describe('CanvasTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ code: 0, data: { credits: 88 } }) });
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
    // Shows first letter avatar "U" from "U1"
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('should display credits fetched from API', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u1@flowai.dev', name: 'U1' },
      loading: false,
    });
    renderBar();
    expect(await screen.findByText(/88/)).toBeDefined();
  });

  it('should show login link when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderBar();
    expect(screen.getByText('登录')).toBeDefined();
  });
});
