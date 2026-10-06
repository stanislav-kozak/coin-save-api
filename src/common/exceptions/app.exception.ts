import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '../constants/error-codes';

export class AppException extends HttpException {
  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super({ code, message, details }, statusCode, options);
  }
}
