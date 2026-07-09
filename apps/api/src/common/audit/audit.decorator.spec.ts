import { describe, it, expect } from 'vitest';
import { AUDIT_KEY, AuditLog } from './audit.decorator';

describe('@AuditLog', () => {
  it('should set audit metadata on the method', () => {
    class TestController {
      @AuditLog('create', 'subscription')
      async createSub() {
        return { id: 'sub-1' };
      }
    }

    const instance = new TestController();
    const metadata = Reflect.getMetadata(AUDIT_KEY, instance.createSub);

    expect(metadata).toEqual({ action: 'create', targetType: 'subscription' });
  });

  it('should set audit metadata for different action types', () => {
    class TestController {
      @AuditLog('upgrade', 'subscription')
      async upgrade() {
        return { id: 'sub-2' };
      }

      @AuditLog('grant', 'point')
      async grant() {
        return { amount: 100 };
      }
    }

    const instance = new TestController();
    expect(Reflect.getMetadata(AUDIT_KEY, instance.upgrade)).toEqual({
      action: 'upgrade',
      targetType: 'subscription',
    });
    expect(Reflect.getMetadata(AUDIT_KEY, instance.grant)).toEqual({
      action: 'grant',
      targetType: 'point',
    });
  });
});
