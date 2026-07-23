import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BannerManagementTab } from './BannerManagementTab';

const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    App: {
      ...(actual as any).App,
      useApp: () => ({ message: mockMessage }),
    },
  };
});

vi.mock('@/api/subscriptionApi', () => ({
  subscriptionApi: {
    getAdminBanner: vi.fn(),
    updateBanner: vi.fn(),
    uploadBannerImage: vi.fn(),
  },
}));

vi.mock('@/api/mediaApi', () => ({
  getPresignedUrlByKey: vi.fn(),
}));

import { subscriptionApi } from '@/api/subscriptionApi';
import { getPresignedUrlByKey } from '@/api/mediaApi';

const mockBanner = {
  id: 'subscription-banner-singleton',
  title: 'Test Title',
  subtitle: 'Test Subtitle',
  backgroundImageUrl: '',
  backgroundImageKey: null,
  countdownEndAt: null,
  autoExtend: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderTab() {
  return render(<BannerManagementTab />);
}

describe('BannerManagementTab - image upload URL display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subscriptionApi.getAdminBanner).mockResolvedValue(mockBanner);
    vi.mocked(subscriptionApi.uploadBannerImage).mockResolvedValue({ imageKey: 'uploads/system/2026-07-20/abc123.png' });
    vi.mocked(getPresignedUrlByKey).mockResolvedValue('/flowai/uploads/system/2026-07-20/abc123.png');
  });

  it('shows the uploaded image URL after successful upload', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    const file = new File(['dummy'], 'test-bg.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/\/flowai\/uploads\/system\/2026-07-20\/abc123\.png/)).toBeInTheDocument();
    });
  });

  it('shows URL text when banner is loaded with an existing backgroundImageKey', async () => {
    vi.mocked(subscriptionApi.getAdminBanner).mockResolvedValue({
      ...mockBanner,
      backgroundImageKey: 'uploads/system/2026-07-19/existing.png',
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/\/flowai\/uploads\/system\/2026-07-19\/existing\.png/)).toBeInTheDocument();
    });
  });

  it('does not show URL text when no image is uploaded', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    expect(screen.queryByText(/\/flowai\//)).toBeNull();
  });
});
