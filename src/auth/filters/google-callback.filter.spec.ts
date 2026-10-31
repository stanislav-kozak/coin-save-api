import { UnauthorizedException } from '@nestjs/common';
import {
  GOOGLE_SIGN_IN_FAILED_PATH,
  GoogleCallbackExceptionFilter,
} from './google-callback.filter';

function hostFor(cookies: Record<string, string> = {}) {
  const response = { redirect: vi.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ cookies }),
      getResponse: () => response,
    }),
  };
  return { host: host as never, response };
}

describe('GoogleCallbackExceptionFilter', () => {
  it('redirects to the login page instead of answering with a JSON 500', () => {
    const { host, response } = hostFor();

    // e.g. passport-oauth2's TokenError when the Google code was already used
    new GoogleCallbackExceptionFilter().catch(
      new Error('Malformed auth code.'),
      host,
    );

    expect(response.redirect).toHaveBeenCalledWith(GOOGLE_SIGN_IN_FAILED_PATH);
  });

  it('sends a user who already holds a session to the app', () => {
    const { host, response } = hostFor({ session: '1' });

    new GoogleCallbackExceptionFilter().catch(new Error('invalid_grant'), host);

    expect(response.redirect).toHaveBeenCalledWith('/');
  });

  it('redirects without logging an error when the user cancelled on Google', () => {
    const { host, response } = hostFor();
    const filter = new GoogleCallbackExceptionFilter();
    const logError = vi
      .spyOn(
        (filter as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => {});

    filter.catch(new UnauthorizedException(), host);

    expect(response.redirect).toHaveBeenCalledWith(GOOGLE_SIGN_IN_FAILED_PATH);
    expect(logError).not.toHaveBeenCalled();
  });
});
