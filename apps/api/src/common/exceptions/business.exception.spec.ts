import { describe, it, expect } from 'vitest';
import { BusinessException } from './business.exception';

describe('BusinessException', () => {
  it('should create exception with error code and default HTTP 400', () => {
    const ex = new BusinessException('CREDIT_INSUFFICIENT');
    expect(ex.getStatus()).toBe(400);
    expect(ex.message).toBe('CREDIT_INSUFFICIENT');
  });

  it('should create exception with custom message', () => {
    const ex = new BusinessException('CREDIT_INSUFFICIENT', '积分余额不足，需要 500 积分');
    expect(ex.getStatus()).toBe(400);
    expect(ex.message).toBe('积分余额不足，需要 500 积分');
  });

  it('should map SUBSCRIPTION_FEATURE_DISABLED to 403', () => {
    const ex = new BusinessException('SUBSCRIPTION_FEATURE_DISABLED');
    expect(ex.getStatus()).toBe(403);
  });

  it('should map SUBSCRIPTION_ACTIVE_EXISTS to 400', () => {
    const ex = new BusinessException('SUBSCRIPTION_ACTIVE_EXISTS');
    expect(ex.getStatus()).toBe(400);
  });

  it('should map STATE_MACHINE_TERMINAL to 400', () => {
    const ex = new BusinessException('STATE_MACHINE_TERMINAL');
    expect(ex.getStatus()).toBe(400);
  });

  it('should accept custom HTTP status code', () => {
    const ex = new BusinessException('CUSTOM_ERROR', 'custom message', 500);
    expect(ex.getStatus()).toBe(500);
  });

  it('should contain the error code in response', () => {
    const ex = new BusinessException('UPGRADE_INVALID_TIER');
    const response = ex.getResponse();
    expect(response).toHaveProperty('errorCode', 'UPGRADE_INVALID_TIER');
  });
});
