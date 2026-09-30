import { HttpExceptionFilter } from './http-exception.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
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

  it('批3-3：BusinessException 的 errorCode 透出进响应 body（getResponse() 现状从不被调——37 处业务码全丢）', () => {
    const filter = new HttpExceptionFilter();
    const exception = new BusinessException('SESSION_EXPIRED', '会话已过期', HttpStatus.UNAUTHORIZED);

    const mockJson = vi.fn();
    const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/api/test' }),
      }),
    };

    filter.catch(exception, host as any);
    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    const callArg = mockJson.mock.calls[0][0];
    expect(callArg.code).toBe(-1);
    expect(callArg.message).toBe('会话已过期');
    expect(callArg.errorCode).toBe('SESSION_EXPIRED');
  });

  it('批3-3：非 BusinessException（裸 HttpException）→ 不伪造 errorCode 字段', () => {
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
    const callArg = mockJson.mock.calls[0][0];
    expect('errorCode' in callArg).toBe(false);
  });
});
