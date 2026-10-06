import { Logger } from '@nestjs/common';
import { buildMailerOptions, FALLBACK_MAIL_FROM } from './mail.config';

const configWith = (values: Record<string, string | undefined>) => ({
  get: (key: string) => values[key],
});

describe('buildMailerOptions', () => {
  it('sends from MAIL_FROM through Resend SMTP with the API key', () => {
    const options = buildMailerOptions(
      configWith({
        MAIL_FROM: 'CoinSave <noreply@coinsavekeeper.com>',
        RESEND_API_KEY: 're_test',
      }) as never,
    );

    expect(options.defaults?.from).toBe(
      'CoinSave <noreply@coinsavekeeper.com>',
    );
    expect(options.transport).toMatchObject({
      host: 'smtp.resend.com',
      auth: { user: 'resend', pass: 're_test' },
    });
  });

  it("falls back to Resend's shared test sender and warns when MAIL_FROM is not set", () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const options = buildMailerOptions(configWith({}) as never);

    expect(options.defaults?.from).toBe(FALLBACK_MAIL_FROM);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAIL_FROM'));
    warn.mockRestore();
  });
});
