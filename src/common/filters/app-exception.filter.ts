import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GENERIC_ERROR_CODES } from '../constants/error-codes';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Errors from SMTP, Prisma etc. can echo addresses back; keep them out of logs.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const redact = (text: string): string => text.replace(EMAIL_PATTERN, '[email]');

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    this.logServerError(exception, http.getRequest<Request | undefined>());

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

  // 4xx are expected client errors and stay out of the logs; anything 5xx
  // is a server problem we need to see. Only method and path are logged —
  // no query string, body or headers (they may hold tokens or personal data).
  private logServerError(exception: unknown, request?: Request): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status < 500) {
      return;
    }

    const route = request
      ? `${request.method} ${(request.originalUrl ?? request.url ?? '').split('?')[0]}`
      : 'unknown route';
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const code =
      typeof body === 'object' && body !== null && 'code' in body
        ? ` ${String(body.code)}`
        : '';
    // An AppException may wrap the real failure (e.g. an SMTP error); log
    // that, since the AppException's own message/stack say little.
    const cause = exception instanceof Error ? exception.cause : undefined;
    const causeText =
      cause instanceof Error ? ` (caused by: ${cause.message})` : '';
    const message =
      (exception instanceof Error ? exception.message : String(exception)) +
      causeText;
    const stack =
      cause instanceof Error
        ? cause.stack
        : exception instanceof Error
          ? exception.stack
          : undefined;

    this.logger.error(
      redact(`${route} -> ${status}${code}: ${message}`),
      stack ? redact(stack) : undefined,
    );
  }
}
