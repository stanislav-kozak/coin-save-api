import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Expense, type TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currencies/currencies.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

const MAX_PAST_YEARS = 5;

export interface CreateExpenseInput {
  walletId: string;
  categoryId?: string;
  type: TransactionType;
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
}

export interface UpdateExpenseInput {
  walletId?: string;
  categoryId?: string;
  amount?: number;
  occurredAt?: string;
  note?: string;
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
  ): Promise<Expense> {
    const occurredAt = this.parseAndValidateOccurredAt(input.occurredAt);
    const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }
    const space = await this.findSpaceOrThrow(spaceId);

    const fxRate = await this.currencyService.getRate(
      wallet.currency,
      space.primaryCurrency,
      occurredAt,
    );
    const amountInPrimary = new Prisma.Decimal(input.amount).times(fxRate);

    return this.prisma.expense.create({
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
    });
  }

  listExpenses(
    spaceId: string,
    filter: ListExpensesFilter,
  ): Promise<Expense[]> {
    const occurredAtRange =
      filter.from || filter.to
        ? {
            ...(filter.from ? { gte: new Date(filter.from) } : {}),
            ...(filter.to ? { lte: new Date(filter.to) } : {}),
          }
        : undefined;

    return this.prisma.expense.findMany({
      where: {
        spaceId,
        ...(filter.walletId ? { walletId: filter.walletId } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(occurredAtRange ? { occurredAt: occurredAtRange } : {}),
      },
      orderBy: { occurredAt: 'desc' },
    });
  }

  getExpense(spaceId: string, expenseId: string): Promise<Expense> {
    return this.findExpenseOrThrow(spaceId, expenseId);
  }

  async updateExpense(
    spaceId: string,
    expenseId: string,
    input: UpdateExpenseInput,
  ): Promise<Expense> {
    const existing = await this.findExpenseOrThrow(spaceId, expenseId);

    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }

    let walletCurrency: string | undefined;
    if (input.walletId) {
      const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
      walletCurrency = wallet.currency;
    }

    const occurredAt = input.occurredAt
      ? this.parseAndValidateOccurredAt(input.occurredAt)
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

      fxRate = await this.currencyService.getRate(
        effectiveWalletCurrency,
        space.primaryCurrency,
        effectiveOccurredAt,
      );
      amountInPrimary = new Prisma.Decimal(effectiveAmount).times(fxRate);
    }

    return this.prisma.expense.update({
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
    });
  }

  async deleteExpense(spaceId: string, expenseId: string): Promise<void> {
    await this.findExpenseOrThrow(spaceId, expenseId);
    await this.prisma.expense.delete({ where: { id: expenseId } });
  }

  private parseAndValidateOccurredAt(occurredAt: string): Date {
    const date = new Date(occurredAt);
    const now = new Date();
    if (date.getTime() > now.getTime()) {
      throw new AppException(
        ERROR_CODES.INVALID_OCCURRED_AT,
        HttpStatus.BAD_REQUEST,
        'occurredAt cannot be in the future',
      );
    }
    const earliestAllowed = new Date(now);
    earliestAllowed.setFullYear(earliestAllowed.getFullYear() - MAX_PAST_YEARS);
    if (date.getTime() < earliestAllowed.getTime()) {
      throw new AppException(
        ERROR_CODES.INVALID_OCCURRED_AT,
        HttpStatus.BAD_REQUEST,
        `occurredAt cannot be more than ${MAX_PAST_YEARS} years in the past`,
      );
    }
    return date;
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
  ): Promise<Expense> {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
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
