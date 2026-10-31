import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { redact } from '../../common/filters/app-exception.filter';

// Unprefixed: the frontend adds the user's locale and keeps the query.
export const GOOGLE_SIGN_IN_FAILED_PATH = '/login?error=GOOGLE_AUTH_FAILED';

// The Google callback is a browser navigation, not an API call: a JSON error
// would be shown to the user as a raw page. Send them back to the app
// instead — to the app itself when they already hold a session (e.g. the
// same sign-in completed in a parallel callback, and this one failed on the
// already-used Google code), otherwise to the login page.
@Catch()
export class GoogleCallbackExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GoogleCallbackExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // Cancelling on Google's consent screen is a 401 from the guard: an
    // expected outcome, not a server problem.
    if (!(exception instanceof HttpException)) {
      const error = exception instanceof Error ? exception : undefined;
      this.logger.error(
        redact(`Google sign-in failed: ${error?.message ?? String(exception)}`),
        error?.stack ? redact(error.stack) : undefined,
      );
    }

    const cookies = request.cookies as Record<string, string> | undefined;
    response.redirect(cookies?.session ? '/' : GOOGLE_SIGN_IN_FAILED_PATH);
  }
}
