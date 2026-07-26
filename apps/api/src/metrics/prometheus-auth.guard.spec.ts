import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PrometheusAuthGuard', () => {
  let guard: any;

  const mockContext = (token?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-prometheus-token': token },
      }),
    }),
  });

  beforeEach(() => {
    vi.resetModules();
    delete process.env.PROMETHEUS_TOKEN;
    delete process.env.NODE_ENV;
  });

  describe('development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should allow access without token configured', async () => {
      delete process.env.PROMETHEUS_TOKEN;
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(guard.canActivate(mockContext())).toBe(true);
    });

    it('should allow access when token matches', async () => {
      process.env.PROMETHEUS_TOKEN = 'dev-token';
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(guard.canActivate(mockContext('dev-token'))).toBe(true);
    });

    it('should reject access when token does not match', async () => {
      process.env.PROMETHEUS_TOKEN = 'dev-token';
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(() => guard.canActivate(mockContext('wrong'))).toThrow();
    });
  });

  describe('production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('should reject access when token is not configured', async () => {
      delete process.env.PROMETHEUS_TOKEN;
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(() => guard.canActivate(mockContext())).toThrow();
    });

    it('should allow access when token matches', async () => {
      process.env.PROMETHEUS_TOKEN = 'prod-secret';
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(guard.canActivate(mockContext('prod-secret'))).toBe(true);
    });

    it('should reject access when token does not match', async () => {
      process.env.PROMETHEUS_TOKEN = 'prod-secret';
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(() => guard.canActivate(mockContext('wrong'))).toThrow();
    });
  });

  describe('no NODE_ENV set (treated as production)', () => {
    it('should reject access when token is not configured', async () => {
      delete process.env.NODE_ENV;
      delete process.env.PROMETHEUS_TOKEN;
      const { PrometheusAuthGuard } = await import('./prometheus-auth.guard');
      guard = new PrometheusAuthGuard();
      expect(() => guard.canActivate(mockContext())).toThrow();
    });
  });
});
