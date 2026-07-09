import { HttpException, HttpStatus } from '@nestjs/common';

const ERROR_HTTP_MAP: Record<string, HttpStatus> = {
  SUBSCRIPTION_FEATURE_DISABLED: HttpStatus.FORBIDDEN,
};

export class BusinessException extends HttpException {
  readonly errorCode: string;

  constructor(code: string, message?: string, httpStatus?: HttpStatus) {
    const status = httpStatus ?? ERROR_HTTP_MAP[code] ?? HttpStatus.BAD_REQUEST;
    super(message ?? code, status);
    this.errorCode = code;
  }

  getResponse(): string | object {
    return {
      ...(super.getResponse() as object),
      errorCode: this.errorCode,
    };
  }
}
