import { ArgumentsHost, HttpStatus } from '@nestjs/common';
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
      new AppException(ERROR_CODES.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, 'Invalid email or password'),
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
});
