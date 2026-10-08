import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';

export type MailLocale = 'uk' | 'en';
export type MailTemplate =
  'verify-email' | 'password-reset' | 'invitation' | 'recurring-reminder';

export const BRAND = 'CoinSaveKeeper';

// Subjects are plain text (no HTML escaping); {{vars}} come from send().
const SUBJECTS: Record<MailTemplate, Record<MailLocale, string>> = {
  'verify-email': {
    en: 'Confirm your email for CoinSaveKeeper',
    uk: 'Підтвердіть пошту для CoinSaveKeeper',
  },
  'password-reset': {
    en: 'Reset your CoinSaveKeeper password',
    uk: 'Скидання пароля CoinSaveKeeper',
  },
  invitation: {
    en: '{{inviterName}} invited you to {{spaceName}} on CoinSaveKeeper',
    uk: '{{inviterName}} запрошує вас до «{{spaceName}}» у CoinSaveKeeper',
  },
  'recurring-reminder': {
    en: 'CoinSaveKeeper: {{recurringName}} is due in 3 days',
    uk: 'CoinSaveKeeper: платіж «{{recurringName}}» через 3 дні',
  },
};

const TEMPLATES_DIR = join(__dirname, 'templates');

@Injectable()
export class MailService {
  // Own Handlebars instance with the shared layout partials (head, header,
  // footer) registered once.
  private readonly hbs = MailService.createHandlebars();

  constructor(
    private readonly mailerService: MailerService,
    private readonly config: ConfigService,
  ) {}

  async send(
    to: string,
    locale: MailLocale,
    template: MailTemplate,
    vars: Record<string, string>,
  ): Promise<void> {
    const context = {
      ...vars,
      lang: locale,
      appUrl: this.config.get<string>('FRONTEND_URL') ?? '',
    };
    const subject = this.hbs.compile(SUBJECTS[template][locale], {
      noEscape: true,
    })(context);
    const html = await this.renderHtml(locale, template, context);
    const text = this.hbs.compile(this.read(locale, `${template}.txt.hbs`), {
      noEscape: true,
    })(context);
    await this.mailerService.sendMail({ to, subject, html, text });
  }

  private async renderHtml(
    locale: MailLocale,
    template: MailTemplate,
    context: Record<string, string>,
  ): Promise<string> {
    const mjmlMarkup = this.hbs.compile(
      this.read(locale, `${template}.mjml.hbs`),
    )(context);
    const { html, errors } = await mjml2html(mjmlMarkup, {
      validationLevel: 'strict',
      // System fonts only: no Google Fonts request on every open.
      fonts: {},
    });
    if (errors.length > 0) {
      throw new Error(
        `MJML compile error: ${errors.map((e) => e.formattedMessage).join('; ')}`,
      );
    }
    return html;
  }

  private read(locale: MailLocale, file: string): string {
    return readFileSync(join(TEMPLATES_DIR, locale, file), 'utf-8');
  }

  private static createHandlebars(): typeof Handlebars {
    const hbs = Handlebars.create();
    const partialsDir = join(TEMPLATES_DIR, 'partials');
    for (const file of readdirSync(partialsDir)) {
      const name = file.replace(/\.(mjml|txt)\.hbs$/, '');
      // A clash would silently replace one partial with another (e.g. the
      // text footer ending up in the HTML), so refuse it.
      if (hbs.partials[name]) {
        throw new Error(`Duplicate mail partial name: ${name}`);
      }
      hbs.registerPartial(name, readFileSync(join(partialsDir, file), 'utf-8'));
    }
    return hbs;
  }
}
