import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { CreditsPage } from './CreditsPage';

describe('CreditsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display credit balance from API', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ credits: 88, updatedAt: '2026-05-15T16:00:00.000Z' })
    });
    render(<CreditsPage />);
    await waitFor(() => {
      expect(screen.getByText(/88/)).toBeDefined();
    });
  });

  it('should display updatedAt time', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ credits: 100, updatedAt: '2026-05-15T16:30:00.000Z' })
    });
    render(<CreditsPage />);
    await waitFor(() => {
      expect(screen.getByText(/最后更新/)).toBeDefined();
    });
  });
});
