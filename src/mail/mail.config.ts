import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MailerOptions } from '@nestjs-modules/mailer';

// Resend's shared sender: works without a verified domain, but only delivers
// to the Resend account owner's own address. Fine for local dev only.
export const FALLBACK_MAIL_FROM = 'CoinSave <onboarding@resend.dev>';

export function buildMailerOptions(config: ConfigService): MailerOptions {
  let from = config.get<string>('MAIL_FROM');
  if (!from) {
    new Logger('MailConfig').warn(
      `MAIL_FROM is not set; falling back to ${FALLBACK_MAIL_FROM}, which only ` +
        'delivers to the Resend account owner. Set MAIL_FROM to an address ' +
        'on a domain verified in Resend.',
    );
    from = FALLBACK_MAIL_FROM;
  }

  return {
    transport: {
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: {
        user: 'resend',
        pass: config.get<string>('RESEND_API_KEY'),
      },
    },
    defaults: { from },
  };
}
