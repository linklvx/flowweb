import { HttpExceptionFilter } from './http-exception.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

describe('HttpExceptionFilter', () => {
  it('should format HttpException response', () => {
    const filter = new HttpExceptionFilter();
    const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

    const mockJson = vi.fn();
    const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/api/test' }),
      }),
    };

    filter.catch(exception, host as any);
    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const callArg = mockJson.mock.calls[0][0];
    expect(callArg.code).toBe(-1);
    expect(callArg.data).toBeNull();
    expect(callArg.message).toBe('Test error');
  });
});
