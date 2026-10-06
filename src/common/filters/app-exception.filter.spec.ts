import { ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { AppExceptionFilter } from './app-exception.filter';
import { AppException } from '../exceptions/app.exception';
import { ERROR_CODES } from '../constants/error-codes';

function createHost(jsonSpy: (body: unknown) => void) {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn((body: unknown) => jsonSpy(body)),
  };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        method: 'POST',
        originalUrl: '/api/auth/signup?email=secret@example.com',
      }),
    }),
    response,
  } as unknown as ArgumentsHost & { response: typeof response };
}

describe('AppExceptionFilter', () => {
  it('formats an AppException as { statusCode, code, message, details }', () => {
    const filter = new AppExceptionFilter();
    let captured: unknown;
    const host = createHost((body) => (captured = body));

    filter.catch(
      new AppException(
        ERROR_CODES.INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
        'Invalid email or password',
      ),
      host,
    );

    expect(host.response.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(captured).toEqual({
      statusCode: HttpStatus.UNAUTHORIZED,
      code: ERROR_CODES.INVALID_CREDENTIALS,
      message: 'Invalid email or password',
      details: undefined,
    });
  });

  it('maps an unrecognized error to a generic 500', () => {
    const filter = new AppExceptionFilter();
    let captured: unknown;
    const host = createHost((body) => (captured = body));

    filter.catch(new Error('boom'), host);

    expect(host.response.status).toHaveBeenCalledWith(500);
    expect(captured).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  describe('logging', () => {
    let errorSpy: MockInstance<Logger['error']>;

    beforeEach(() => {
      errorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('logs an unrecognized error with method, path and stack, without the query string', () => {
      const error = new Error('SMTP rejected the sender');

      new AppExceptionFilter().catch(
        error,
        createHost(() => undefined),
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, stack] = errorSpy.mock.calls[0] as [string, string];
      expect(message).toContain('POST /api/auth/signup');
      expect(message).toContain('SMTP rejected the sender');
      expect(message).not.toContain('secret@example.com');
      expect(stack).toBe(error.stack);
    });

    it('masks email addresses but keeps package paths in the stack readable', () => {
      const error = new Error(
        '550 Recipient user.name+tag@example.co.uk rejected',
      );
      error.stack =
        'Error: 550 Recipient user.name+tag@example.co.uk rejected\n' +
        '    at send (/app/node_modules/@nestjs-modules/mailer/dist/mailer.service.js:1:1)';

      new AppExceptionFilter().catch(
        error,
        createHost(() => undefined),
      );

      const [message, stack] = errorSpy.mock.calls[0] as [string, string];
      expect(message).toContain('Recipient [email] rejected');
      expect(stack).toContain('Recipient [email] rejected');
      expect(stack).toContain('/app/node_modules/@nestjs-modules/mailer/dist');
    });

    it('logs 5xx AppExceptions with their code', () => {
      new AppExceptionFilter().catch(
        new AppException(
          ERROR_CODES.CURRENCY_API_UNAVAILABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
          'Currency API unavailable',
        ),
        createHost(() => undefined),
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain(
        'CURRENCY_API_UNAVAILABLE',
      );
    });

    it('logs the underlying cause of a 5xx AppException', () => {
      const cause = new Error('450 domain is not verified');

      new AppExceptionFilter().catch(
        new AppException(
          ERROR_CODES.EMAIL_DELIVERY_FAILED,
          HttpStatus.SERVICE_UNAVAILABLE,
          'Could not send the verification email',
          undefined,
          { cause },
        ),
        createHost(() => undefined),
      );

      const [message, stack] = errorSpy.mock.calls[0] as [string, string];
      expect(message).toContain('EMAIL_DELIVERY_FAILED');
      expect(message).toContain('caused by: 450 domain is not verified');
      expect(stack).toBe(cause.stack);
    });

    it('does not log expected 4xx client errors', () => {
      new AppExceptionFilter().catch(
        new AppException(
          ERROR_CODES.INVALID_CREDENTIALS,
          HttpStatus.UNAUTHORIZED,
          'Invalid email or password',
        ),
        createHost(() => undefined),
      );

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
