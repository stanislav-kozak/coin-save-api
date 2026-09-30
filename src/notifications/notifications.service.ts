import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { computeNextOccurrenceDate } from '../recurring/recurring-due-dates';

const REMINDER_LEAD_DAYS = 3;
const NOTIFICATION_CHANNEL = 'email';

type RecurringWithReminderRelations = Prisma.RecurringTransactionGetPayload<{
  include: { createdBy: true; wallet: true; category: true };
}>;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 9 * * *', {
    name: 'sendRecurringReminders',
    timeZone: 'Europe/Kyiv',
  })
  async sendRecurringReminders(): Promise<void> {
    const today = startOfUtcDay(new Date());
    const targetDate = addUtcDays(today, REMINDER_LEAD_DAYS);

    const recurrings = await this.prisma.recurringTransaction.findMany({
      where: { active: true },
      include: { createdBy: true, wallet: true, category: true },
    });

    for (const recurring of recurrings) {
      try {
        await this.remindIfDue(recurring, targetDate);
      } catch (error) {
        this.logger.warn(
          `Failed to send reminder for recurring transaction ${recurring.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async remindIfDue(
    recurring: RecurringWithReminderRelations,
    targetDate: Date,
  ): Promise<void> {
    const nextOccurrence = computeNextOccurrenceDate({
      startDate: recurring.startDate,
      endDate: recurring.endDate,
      dayOfMonth: recurring.dayOfMonth,
      lastGeneratedAt: recurring.lastGeneratedAt,
    });

    if (!nextOccurrence || nextOccurrence.getTime() !== targetDate.getTime()) {
      return;
    }

    const existingLog = await this.prisma.recurringNotificationLog.findUnique({
      where: {
        recurringId_forDate_channel: {
          recurringId: recurring.id,
          forDate: nextOccurrence,
          channel: NOTIFICATION_CHANNEL,
        },
      },
    });
    if (existingLog) {
      return;
    }

    const locale = recurring.createdBy.locale === 'en' ? 'en' : 'uk';
    const occurrenceDate = new Intl.DateTimeFormat(
      locale === 'en' ? 'en-US' : 'uk-UA',
      { day: 'numeric', month: 'long' },
    ).format(nextOccurrence);

    await this.mail.send(
      recurring.createdBy.email,
      locale,
      'recurring-reminder',
      locale === 'en' ? 'Upcoming payment reminder' : 'Нагадування про платіж',
      {
        walletIcon: recurring.wallet.icon ?? '',
        walletName: recurring.wallet.name,
        categoryIcon: recurring.category?.icon ?? '',
        recurringName: recurring.name,
        amount: recurring.amount.toFixed(2),
        currency: recurring.currency,
        occurrenceDate,
        manageUrl: `${this.config.get<string>('FRONTEND_URL')}/recurring`,
      },
    );

    await this.prisma.recurringNotificationLog.create({
      data: {
        recurringId: recurring.id,
        forDate: nextOccurrence,
        channel: NOTIFICATION_CHANNEL,
      },
    });
  }
}
