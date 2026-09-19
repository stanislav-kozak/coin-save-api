import { MailService } from './mail.service';

describe('MailService', () => {
  it('renders the MJML+Handlebars template and sends the resulting HTML', async () => {
    const mailerService = { sendMail: vi.fn().mockResolvedValue(undefined) };
    const service = new MailService(mailerService as never);

    await service.send(
      'user@example.com',
      'uk',
      'verify-email',
      'Підтвердіть пошту',
      {
        verifyUrl: 'https://app.coinsave.com/verify-email?token=abc123',
      },
    );

    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
    const call = mailerService.sendMail.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe('Підтвердіть пошту');
    expect(call.html).toContain(
      'https://app.coinsave.com/verify-email?token=abc123',
    );
    expect(call.html).toContain('<!doctype html');
  });

  it('renders the invitation template with the accept link', async () => {
    const mailerService = { sendMail: vi.fn().mockResolvedValue(undefined) };
    const service = new MailService(mailerService as never);

    await service.send(
      'invitee@example.com',
      'uk',
      'invitation',
      'Запрошення до CoinSave',
      {
        spaceName: 'Family',
        inviterName: 'Stas',
        acceptUrl: 'https://app.coinsave.com/invitations/accept?token=xyz789',
      },
    );

    const call = mailerService.sendMail.mock.calls[0][0] as {
      to: string;
      html: string;
    };
    expect(call.to).toBe('invitee@example.com');
    expect(call.html).toContain(
      'https://app.coinsave.com/invitations/accept?token=xyz789',
    );
    expect(call.html).toContain('Family');
  });
});
