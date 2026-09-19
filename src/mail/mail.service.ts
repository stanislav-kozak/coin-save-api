import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { readFileSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';

export type MailLocale = 'uk' | 'en';
export type MailTemplate = 'verify-email' | 'password-reset' | 'invitation';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async send(
    to: string,
    locale: MailLocale,
    template: MailTemplate,
    subject: string,
    vars: Record<string, string>,
  ): Promise<void> {
    const html = await this.render(locale, template, vars);
    await this.mailerService.sendMail({ to, subject, html });
  }

  private async render(
    locale: MailLocale,
    template: MailTemplate,
    vars: Record<string, string>,
  ): Promise<string> {
    const templatePath = join(
      __dirname,
      'templates',
      locale,
      `${template}.mjml.hbs`,
    );
    const source = readFileSync(templatePath, 'utf-8');
    const mjmlMarkup = Handlebars.compile(source)(vars);
    const { html, errors } = await mjml2html(mjmlMarkup);

    if (errors.length > 0) {
      throw new Error(
        `MJML compile error: ${errors.map((e) => e.formattedMessage).join('; ')}`,
      );
    }

    return html;
  }
}
