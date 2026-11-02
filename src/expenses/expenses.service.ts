import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currencies/currencies.service';
import {
  DEFAULT_TIME_ZONE,
  endOfZonedDay,
  startOfZonedDay,
  toCalendarDate,
} from '../common/utils/time-zone';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import { parseOccurredAt } from '../common/utils/occurred-at';
import type { EntryType } from '../common/constants/transaction-types';
import {
  toTransactionResponse,
  transactionInclude,
  type TransactionResponse,
  type TransactionWithToWallet,
} from './transaction-response';

export interface CreateExpenseInput {
  walletId: string;
  categoryId?: string;
  type: EntryType;
  amount: number;
  occurredAt: string;
  note?: string;
}

export interface ListExpensesFilter {
  walletId?: string;
  categoryId?: string;
  type?: TransactionType;
  from?: string;
  to?: string;
  tz?: string;
}

export interface UpdateExpenseInput {
  walletId?: string;
  categoryId?: string | null;
  amount?: number;
  occurredAt?: string;
  note?: string | null;
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  async createExpense(
    spaceId: string,
    createdById: string,
    input: CreateExpenseInput,
  ): Promise<TransactionResponse> {
    const occurredAt = parseOccurredAt(input.occurredAt);
    const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }
    const space = await this.findSpaceOrThrow(spaceId);

    const fxRate = (
      await this.currencyService.getRate(
        wallet.currency,
        space.primaryCurrency,
        occurredAt,
      )
    ).toDecimalPlaces(8);
    const amountInPrimary = new Prisma.Decimal(input.amount).times(fxRate);

    const expense = await this.prisma.expense.create({
      data: {
        spaceId,
        walletId: input.walletId,
        categoryId: input.categoryId,
        type: input.type,
        amount: input.amount,
        walletCurrency: wallet.currency,
        amountInPrimary,
        fxRate,
        note: input.note,
        occurredAt,
        createdById,
      },
      include: transactionInclude,
    });
    return toTransactionResponse(expense);
  }

  async listExpenses(
    spaceId: string,
    filter: ListExpensesFilter,
  ): Promise<TransactionResponse[]> {
    // from/to are calendar days in the caller's time zone, both inclusive.
    const timeZone = filter.tz ?? DEFAULT_TIME_ZONE;
    const occurredAtRange =
      filter.from || filter.to
        ? {
            ...(filter.from
              ? {
                  gte: startOfZonedDay(
                    toCalendarDate(filter.from, timeZone),
                    timeZone,
                  ),
                }
              : {}),
            ...(filter.to
              ? {
                  lte: endOfZonedDay(
                    toCalendarDate(filter.to, timeZone),
                    timeZone,
                  ),
                }
              : {}),
          }
        : undefined;

    const expenses = await this.prisma.expense.findMany({
      where: {
        spaceId,
        // A wallet's history includes transfers into it, not only out of it.
        ...(filter.walletId
          ? {
              OR: [
                { walletId: filter.walletId },
                { toWalletId: filter.walletId },
              ],
            }
          : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(occurredAtRange ? { occurredAt: occurredAtRange } : {}),
      },
      include: transactionInclude,
      orderBy: { occurredAt: 'desc' },
    });
    return expenses.map(toTransactionResponse);
  }

  async getExpense(
    spaceId: string,
    expenseId: string,
  ): Promise<TransactionResponse> {
    return toTransactionResponse(
      await this.findExpenseOrThrow(spaceId, expenseId),
    );
  }

  async updateExpense(
    spaceId: string,
    expenseId: string,
    input: UpdateExpenseInput,
  ): Promise<TransactionResponse> {
    const existing = await this.findExpenseOrThrow(spaceId, expenseId);
    if (existing.type === TransactionType.TRANSFER) {
      throw new AppException(
        ERROR_CODES.EXPENSE_IS_TRANSFER,
        HttpStatus.CONFLICT,
        'Transfers are edited via the transfers endpoint',
      );
    }

    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }

    let walletCurrency: string | undefined;
    if (input.walletId) {
      const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
      walletCurrency = wallet.currency;
    }

    const occurredAt = input.occurredAt
      ? parseOccurredAt(input.occurredAt)
      : undefined;

    const needsFxRecompute =
      input.amount !== undefined ||
      occurredAt !== undefined ||
      walletCurrency !== undefined;

    let amountInPrimary: Prisma.Decimal | undefined;
    let fxRate: Prisma.Decimal | undefined;
    if (needsFxRecompute) {
      const space = await this.findSpaceOrThrow(spaceId);
      const effectiveWalletCurrency = walletCurrency ?? existing.walletCurrency;
      const effectiveOccurredAt = occurredAt ?? existing.occurredAt;
      const effectiveAmount = input.amount ?? existing.amount;

      fxRate = (
        await this.currencyService.getRate(
          effectiveWalletCurrency,
          space.primaryCurrency,
          effectiveOccurredAt,
        )
      ).toDecimalPlaces(8);
      amountInPrimary = new Prisma.Decimal(effectiveAmount).times(fxRate);
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        walletId: input.walletId,
        categoryId: input.categoryId,
        amount: input.amount,
        walletCurrency,
        amountInPrimary,
        fxRate,
        note: input.note,
        occurredAt,
      },
      include: transactionInclude,
    });
    return toTransactionResponse(updated);
  }

  async deleteExpense(spaceId: string, expenseId: string): Promise<void> {
    await this.findExpenseOrThrow(spaceId, expenseId);
    await this.prisma.expense.delete({ where: { id: expenseId } });
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

  private async findSpaceOrThrow(
    spaceId: string,
  ): Promise<{ id: string; primaryCurrency: string }> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
    });
    if (!space) {
      throw new AppException(
        ERROR_CODES.SPACE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Space not found',
      );
    }
    return space;
  }

  private async findExpenseOrThrow(
    spaceId: string,
    expenseId: string,
  ): Promise<TransactionWithToWallet> {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: transactionInclude,
    });
    if (!expense || expense.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.EXPENSE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Expense not found',
      );
    }
    return expense;
  }
}
