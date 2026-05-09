import { TransformInterceptor } from './transform.interceptor';
import { of } from 'rxjs';
import { describe, it, expect } from 'vitest';

describe('TransformInterceptor', () => {
  it('should wrap success response', async () => {
    const interceptor = new TransformInterceptor();
    const context = {
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
});
