import {
  MailService,
  type MailLocale,
  type MailTemplate,
} from './mail.service';

function buildService() {
  const mailerService = { sendMail: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn().mockReturnValue('https://app.coinsavekeeper.com'),
  };
  const service = new MailService(mailerService as never, config as never);
  const sent = () =>
    mailerService.sendMail.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
  return { service, mailerService, sent };
}

const cases: {
  template: MailTemplate;
  vars: Record<string, string>;
  url: string;
}[] = [
  {
    template: 'verify-email',
    vars: {
      verifyUrl: 'https://app.coinsavekeeper.com/verify-email?token=abc',
    },
    url: 'https://app.coinsavekeeper.com/verify-email?token=abc',
  },
  {
    template: 'password-reset',
    vars: {
      resetUrl: 'https://app.coinsavekeeper.com/reset-password?token=r1',
    },
    url: 'https://app.coinsavekeeper.com/reset-password?token=r1',
  },
  {
    template: 'invitation',
    vars: {
      spaceName: 'Family',
      inviterName: 'Olena',
      acceptUrl: 'https://app.coinsavekeeper.com/invitations/accept?token=i1',
    },
    url: 'https://app.coinsavekeeper.com/invitations/accept?token=i1',
  },
  {
    template: 'recurring-reminder',
    vars: {
      walletIcon: '💳',
      walletName: 'Card',
      categoryIcon: '🎬',
      recurringName: 'Netflix',
      amount: '15.99',
      currency: 'USD',
      occurrenceDate: '15 October 2026',
      manageUrl: 'https://app.coinsavekeeper.com/recurring',
    },
    url: 'https://app.coinsavekeeper.com/recurring',
  },
];

describe('MailService', () => {
  for (const { template, vars, url } of cases) {
    for (const locale of ['en', 'uk'] as MailLocale[]) {
      it(`sends ${template} (${locale}) as branded HTML with one CTA, a fallback link and a plain-text part`, async () => {
        const { service, sent } = buildService();

        await service.send('user@example.com', locale, template, vars);

        const mail = sent();
        expect(mail.to).toBe('user@example.com');
        expect(mail.subject).toContain('CoinSaveKeeper');
        // HTML: rendered MJML, the CTA button and the raw link as fallback.
        expect(mail.html).toContain('<!doctype html');
        expect(mail.html).toContain(`lang="${locale}"`);
        expect(mail.html).toContain('color-scheme');
        // The CTA button and the plain link under it.
        const hrefs = mail.html.match(/href=["']([^"']*)["']/g) ?? [];
        expect(
          hrefs.filter((h) => h.includes(url)).length,
        ).toBeGreaterThanOrEqual(2);
        expect(mail.html).not.toContain('fonts.googleapis.com');
        expect(mail.html).toContain('CoinSave');
        expect(mail.html).toContain('KEEPER');
        // The brand mark served by the frontend, next to the text logo.
        expect(mail.html).toContain(
          'https://app.coinsavekeeper.com/apple-icon',
        );
        expect(mail.html).toContain(
          locale === 'en' ? 'kept together' : 'сімейні витрати разом',
        ); // footer
        // Every placeholder resolved (incl. title/preview in the head).
        expect(mail.html).not.toContain('{{');
        expect(mail.text).not.toContain('{{');
        expect(mail.subject).not.toContain('{{');
        // Plain text: same link, no markup.
        expect(mail.text).toContain(url);
        expect(mail.text).toContain('CoinSaveKeeper');
        expect(mail.text).not.toMatch(/<[a-z]/i);
      });
    }
  }

  it('speaks to the reader warmly in Ukrainian («ви»)', async () => {
    const { service, sent } = buildService();
    await service.send('u@example.com', 'uk', 'verify-email', cases[0].vars);
    expect(sent().text).toMatch(/ваш|Підтвердіть/);
  });

  it('mentions when the link expires', async () => {
    const { service, sent } = buildService();
    await service.send('u@example.com', 'en', 'password-reset', cases[1].vars);
    expect(sent().text).toContain('1 hour');
    await service.send('u@example.com', 'uk', 'invitation', cases[2].vars);
  });

  it('escapes user-provided values in HTML', async () => {
    const { service, sent } = buildService();
    await service.send('u@example.com', 'en', 'invitation', {
      ...cases[2].vars,
      spaceName: '<script>alert(1)</script>',
    });
    expect(sent().html).not.toContain('<script>alert(1)</script>');
    expect(sent().subject).toContain('<script>'); // plain-text subject, not HTML
  });
});
