import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currencies/currencies.service';
import { computeDueDates } from './recurring-due-dates';

// Cron fires at 01:00 Europe/Kyiv, which lands 22:00-23:00 UTC on the
// PREVIOUS UTC calendar day (Kyiv is UTC+2/UTC+3). Due dates are always
// exact UTC midnight, so without this buffer every occurrence would be
// excluded until the following night's run. 3h covers both DST offsets
// with margin.
const KYIV_CRON_UTC_LAG_BUFFER_MS = 3 * 60 * 60 * 1000;

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
    const effectiveNow = new Date(now.getTime() + KYIV_CRON_UTC_LAG_BUFFER_MS);
    const dueRecurrings = await this.prisma.recurringTransaction.findMany({
      where: {
        active: true,
        startDate: { lte: effectiveNow },
      },
      select: { id: true },
    });

    for (const { id } of dueRecurrings) {
      try {
        await this.generateForRecurring(id, effectiveNow);
      } catch (error) {
        this.logger.warn(
          `Failed to generate occurrences for recurring transaction ${id}: ${(error as Error).message}`,
        );
      }
    }
  }

  async generateForRecurring(recurringId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
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

        const space = await tx.space.findUnique({
          where: { id: recurring.spaceId },
        });
        if (!space) {
          return;
        }

        const wallet = await tx.wallet.findUnique({
          where: { id: recurring.walletId },
        });
        if (!wallet || wallet.archived) {
          this.logger.warn(
            `Skipping recurring transaction ${recurring.id}: wallet is archived or missing`,
          );
          return;
        }

        if (recurring.categoryId) {
          const category = await tx.category.findUnique({
            where: { id: recurring.categoryId },
          });
          if (!category || category.archived) {
            this.logger.warn(
              `Skipping recurring transaction ${recurring.id}: category is archived or missing`,
            );
            return;
          }
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
      },
      { timeout: 30_000 },
    );
  }
}
