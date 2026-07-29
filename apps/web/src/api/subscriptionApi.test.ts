import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test uploadBannerImage directly by importing it
// The module under test uses fetch and apiFetch internally
describe('subscriptionApi — uploadBannerImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should extract imageKey from wrapped TransformInterceptor response', async () => {
    // Server wraps responses with TransformInterceptor:
    // { code: 0, data: { imageKey: "..." }, message: "ok" }
    const mockKey = 'uploaded/system/abc123.webp';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        code: 0,
        data: { imageKey: mockKey },
        message: 'ok',
      }),
    });

    // Dynamic import so the mock is in place when the module loads
    const { subscriptionApi } = await import('./subscriptionApi');
    const result = await subscriptionApi.uploadBannerImage(
      new File(['test'], 'test.webp', { type: 'image/webp' }),
    );

    expect(result.imageKey).toBe(mockKey);
  });

  it('should throw on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    const { subscriptionApi } = await import('./subscriptionApi');

    await expect(
      subscriptionApi.uploadBannerImage(
        new File(['test'], 'test.webp', { type: 'image/webp' }),
      ),
    ).rejects.toThrow('Unauthorized');
  });
});
