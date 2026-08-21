import { TransformInterceptor } from './transform.interceptor';
import { of } from 'rxjs';
import { describe, it, expect } from 'vitest';

describe('TransformInterceptor', () => {
  it('should wrap success response', async () => {
    const interceptor = new TransformInterceptor({ get: () => false } as any);
    const context = {
      getHandler: () => () => {},
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    };

    const next = { handle: () => of({ id: '123', title: 'test' }) };
    const result$ = interceptor.intercept(context as any, next as any);

    const result = await new Promise((resolve) => {
      result$.subscribe({ next: resolve });
    });
    expect(result).toEqual({
      code: 0,
      data: { id: '123', title: 'test' },
      message: 'ok',
    });
  });

  it('should pass through unwrapped when @NoTransform metadata is set', async () => {
    const interceptor = new TransformInterceptor({ get: () => true } as any);
    const context = {
      getHandler: () => () => {},
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    };

    const next = { handle: () => of({ id: '123', title: 'test' }) };
    const result$ = interceptor.intercept(context as any, next as any);

    const result = await new Promise((resolve) => {
      result$.subscribe({ next: resolve });
    });
    expect(result).toEqual({ id: '123', title: 'test' });
  });
});
