import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionBannerPublicController } from './subscription-banner.public.controller';
import { SubscriptionBannerService } from './subscription-banner.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SubscriptionBannerPublicController', () => {
  let controller: SubscriptionBannerPublicController;
  let mockService: { getPublicBanner: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockService = { getPublicBanner: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionBannerPublicController],
      providers: [
        { provide: SubscriptionBannerService, useValue: mockService },
      ],
    }).compile();
    controller = module.get<SubscriptionBannerPublicController>(SubscriptionBannerPublicController);
  });

  it('should return public banner', async () => {
    const data = {
      title: '促销',
      subtitle: '限时',
      backgroundImageKey: null,
      backgroundImageUrl: null,
      countdownEndAt: null,
    };
    mockService.getPublicBanner.mockResolvedValue(data);
    expect(await controller.getPublicBanner()).toEqual(data);
  });
});
