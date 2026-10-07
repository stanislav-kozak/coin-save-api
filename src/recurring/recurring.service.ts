import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  RecurringFrequency,
  RecurringTransaction,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lastDueDateBefore } from './recurring-due-dates';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

export interface CreateRecurringTransactionInput {
  walletId: string;
  categoryId?: string;
  type: TransactionType;
  amount: number;
  name: string;
  note?: string;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
}

export interface UpdateRecurringTransactionInput {
  walletId?: string;
  categoryId?: string | null;
  amount?: number;
  name?: string;
  note?: string;
  dayOfMonth?: number;
  endDate?: string | null;
}

@Injectable()
export class RecurringService {
  constructor(private readonly prisma: PrismaService) {}

  async createRecurringTransaction(
    spaceId: string,
    createdById: string,
    input: CreateRecurringTransactionInput,
  ): Promise<RecurringTransaction> {
    const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }

    const startDate = new Date(input.startDate);
    const endDate = input.endDate ? new Date(input.endDate) : undefined;
    if (endDate && endDate.getTime() <= startDate.getTime()) {
      throw new AppException(
        ERROR_CODES.INVALID_RECURRING_DATE_RANGE,
        HttpStatus.BAD_REQUEST,
        'endDate must be after startDate',
      );
    }

    // Don't back-fill due dates that are already past, but keep this
    // month's upcoming one (see lastDueDateBefore).
    const now = new Date();
    const lastGeneratedAt =
      startDate.getTime() <= now.getTime()
        ? (lastDueDateBefore({
            startDate,
            dayOfMonth: input.dayOfMonth,
            before: now,
          }) ?? undefined)
        : undefined;

    return this.prisma.recurringTransaction.create({
      data: {
        spaceId,
        walletId: input.walletId,
        categoryId: input.categoryId,
        type: input.type,
        amount: input.amount,
        currency: wallet.currency,
        name: input.name,
        note: input.note,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth,
        startDate,
        endDate,
        lastGeneratedAt,
        createdById,
      },
    });
  }

  listRecurringTransactions(
    spaceId: string,
    includeInactive: boolean,
  ): Promise<RecurringTransaction[]> {
    return this.prisma.recurringTransaction.findMany({
      where: { spaceId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  getRecurringTransaction(
    spaceId: string,
    id: string,
  ): Promise<RecurringTransaction> {
    return this.findRecurringOrThrow(spaceId, id);
  }

  async updateRecurringTransaction(
    spaceId: string,
    id: string,
    input: UpdateRecurringTransactionInput,
  ): Promise<RecurringTransaction> {
    const existing = await this.findRecurringOrThrow(spaceId, id);

    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }

    if (
      input.endDate &&
      new Date(input.endDate).getTime() <= existing.startDate.getTime()
    ) {
      throw new AppException(
        ERROR_CODES.INVALID_RECURRING_DATE_RANGE,
        HttpStatus.BAD_REQUEST,
        'endDate must be after startDate',
      );
    }

    let currency: string | undefined;
    if (input.walletId) {
      const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
      currency = wallet.currency;
    }

    return this.prisma.recurringTransaction.update({
      where: { id },
      data: {
        walletId: input.walletId,
        categoryId: input.categoryId === null ? null : input.categoryId,
        amount: input.amount,
        currency,
        name: input.name,
        note: input.note,
        dayOfMonth: input.dayOfMonth,
        endDate:
          input.endDate === null
            ? null
            : input.endDate
              ? new Date(input.endDate)
              : undefined,
      },
    });
  }

  pauseRecurringTransaction(
    spaceId: string,
    id: string,
  ): Promise<RecurringTransaction> {
    return this.setActive(spaceId, id, false);
  }

  async resumeRecurringTransaction(
    spaceId: string,
    id: string,
  ): Promise<RecurringTransaction> {
    // Payments that fell due while paused are not back-filled; upcoming
    // ones, including later this month, are generated as usual.
    const recurring = await this.findRecurringOrThrow(spaceId, id);
    const skipUntil = lastDueDateBefore({
      startDate: recurring.startDate,
      dayOfMonth: recurring.dayOfMonth,
      before: new Date(),
    });
    const advances =
      skipUntil &&
      (!recurring.lastGeneratedAt ||
        skipUntil.getTime() > recurring.lastGeneratedAt.getTime());
    return this.prisma.recurringTransaction.update({
      where: { id },
      data: advances
        ? { active: true, lastGeneratedAt: skipUntil }
        : { active: true },
    });
  }

  async deleteRecurringTransaction(spaceId: string, id: string): Promise<void> {
    await this.findRecurringOrThrow(spaceId, id);
    await this.prisma.recurringTransaction.delete({ where: { id } });
  }

  private async setActive(
    spaceId: string,
    id: string,
    active: boolean,
  ): Promise<RecurringTransaction> {
    await this.findRecurringOrThrow(spaceId, id);
    return this.prisma.recurringTransaction.update({
      where: { id },
      data: { active },
    });
  }

  private async findRecurringOrThrow(
    spaceId: string,
    id: string,
  ): Promise<RecurringTransaction> {
    const recurring = await this.prisma.recurringTransaction.findUnique({
      where: { id },
    });
    if (!recurring || recurring.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.RECURRING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Recurring transaction not found',
      );
    }
    return recurring;
  }

  private async assertWalletInSpace(
    spaceId: string,
    walletId: string,
  ): Promise<{ id: string; currency: string }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet || wallet.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.WALLET_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Wallet not found',
      );
    }
    if (wallet.archived) {
      throw new AppException(
        ERROR_CODES.WALLET_ARCHIVED,
        HttpStatus.CONFLICT,
        'Cannot use an archived wallet',
      );
    }
    return wallet;
  }

  private async assertCategoryInSpace(
    spaceId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.CATEGORY_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Category not found',
      );
    }
    if (category.archived) {
      throw new AppException(
        ERROR_CODES.CATEGORY_ARCHIVED,
        HttpStatus.CONFLICT,
        'Cannot use an archived category',
      );
    }
  }
}
