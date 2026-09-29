import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currencies/currencies.service';
import { computeDueDates } from './recurring-due-dates';

@Injectable()
export class RecurringGeneratorService {
  private readonly logger = new Logger(RecurringGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  @Cron('0 1 * * *', {
    name: 'generateRecurringExpenses',
    timeZone: 'Europe/Kyiv',
  })
  async generateAll(): Promise<void> {
    const now = new Date();
    const dueRecurrings = await this.prisma.recurringTransaction.findMany({
      where: {
        active: true,
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      select: { id: true },
    });

    for (const { id } of dueRecurrings) {
      try {
        await this.generateForRecurring(id, now);
      } catch (error) {
        this.logger.warn(
          `Failed to generate occurrences for recurring transaction ${id}: ${(error as Error).message}`,
        );
      }
    }
  }

  async generateForRecurring(recurringId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${recurringId}))`;

      const recurring = await tx.recurringTransaction.findUnique({
        where: { id: recurringId },
      });
      if (!recurring || !recurring.active) {
        return;
      }
      if (recurring.startDate.getTime() > now.getTime()) {
        return;
      }
      if (recurring.endDate && recurring.endDate.getTime() < now.getTime()) {
        return;
      }

      const space = await tx.space.findUnique({
        where: { id: recurring.spaceId },
      });
      if (!space) {
        return;
      }

      const candidateDates = computeDueDates({
        startDate: recurring.startDate,
        endDate: recurring.endDate,
        dayOfMonth: recurring.dayOfMonth,
        lastGeneratedAt: recurring.lastGeneratedAt,
        now,
      });

      let maxGenerated: Date | null = null;
      for (const dueDate of candidateDates) {
        const existing = await tx.expense.findFirst({
          where: { recurringId: recurring.id, occurredAt: dueDate },
        });

        if (!existing) {
          const fxRate = (
            await this.currencyService.getRate(
              recurring.currency,
              space.primaryCurrency,
              dueDate,
            )
          ).toDecimalPlaces(8);
          const amountInPrimary = new Prisma.Decimal(recurring.amount).times(
            fxRate,
          );

          await tx.expense.create({
            data: {
              spaceId: recurring.spaceId,
              walletId: recurring.walletId,
              categoryId: recurring.categoryId,
              type: recurring.type,
              amount: recurring.amount,
              walletCurrency: recurring.currency,
              amountInPrimary,
              fxRate,
              note: recurring.note,
              occurredAt: dueDate,
              createdById: recurring.createdById,
              recurringId: recurring.id,
            },
          });
        }

        maxGenerated = dueDate;
      }

      if (maxGenerated) {
        await tx.recurringTransaction.update({
          where: { id: recurring.id },
          data: { lastGeneratedAt: maxGenerated },
        });
      }
    });
  }
}
