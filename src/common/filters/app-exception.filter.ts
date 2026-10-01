import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { GENERIC_ERROR_CODES } from '../constants/error-codes';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'code' in body) {
        const typedBody = body as {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
        const payload: ErrorBody = {
          statusCode: status,
          code: typedBody.code,
          message: typedBody.message,
          details: typedBody.details,
        };
        response.status(status).json(payload);
        return;
      }

      const rawMessage =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: string | string[] }).message
          : exception.message;

      response.status(status).json({
        statusCode: status,
        code:
          status === Number(HttpStatus.BAD_REQUEST)
            ? GENERIC_ERROR_CODES.VALIDATION_ERROR
            : GENERIC_ERROR_CODES.HTTP_ERROR,
        message: Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage,
      });
      return;
    }

    response.status(500).json({
      statusCode: 500,
      code: GENERIC_ERROR_CODES.INTERNAL_ERROR,
      message: 'Internal server error',
    });
  }
}
