import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { NO_TRANSFORM_KEY } from '../common/decorators/no-transform.decorator';

export interface WrappedResponse<T> {
  code: number;
  data: T;
  message: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, WrappedResponse<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<WrappedResponse<T> | T> {
    const noTransform = this.reflector.get<boolean>(NO_TRANSFORM_KEY, context.getHandler());
    if (noTransform) {
      return next.handle();
    }
    return next.handle().pipe(
      map(data => ({
        code: 0,
        data,
        message: 'ok',
      })),
    );
  }
}
