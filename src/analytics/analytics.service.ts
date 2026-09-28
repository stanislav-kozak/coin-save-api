import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

export const UNCATEGORIZED_NAME = 'Uncategorized';

export const expenseWithJoinsInclude = {
  wallet: { select: { name: true } },
  category: { select: { name: true } },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.ExpenseInclude;

export type ExpenseWithJoins = Prisma.ExpenseGetPayload<{
  include: typeof expenseWithJoinsInclude;
}>;

export interface GetAnalyticsFilter {
  from: string;
  to: string;
  walletIds?: string[];
}

export interface AnalyticsExpenseItem {
  id: string;
  type: TransactionType;
  amount: Prisma.Decimal;
  walletCurrency: string;
  amountInPrimary: Prisma.Decimal;
  fxRate: Prisma.Decimal;
  note: string | null;
  occurredAt: Date;
  walletId: string;
  walletName: string;
  categoryId: string | null;
  categoryName: string;
  createdById: string;
  createdByName: string;
}

export interface AnalyticsByCategory {
  categoryId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  spent: Prisma.Decimal;
  limit: Prisma.Decimal | null;
  pct: number;
}

export interface AnalyticsByDay {
  date: string;
  expense: Prisma.Decimal;
  income: Prisma.Decimal;
}

export interface AnalyticsResponse {
  currency: string;
  period: { from: string; to: string };
  totalExpense: Prisma.Decimal;
  totalIncome: Prisma.Decimal;
  previousPeriodExpense: Prisma.Decimal;
  previousPeriodIncome: Prisma.Decimal;
  byCategory: AnalyticsByCategory[];
  byDay: AnalyticsByDay[];
  expenses: AnalyticsExpenseItem[];
}

@Injectable()
export class AnalyticsService {
  constructor(protected readonly prisma: PrismaService) {}

  async getAnalytics(
    spaceId: string,
    filter: GetAnalyticsFilter,
  ): Promise<AnalyticsResponse> {
    const { fromStart, toEnd } = this.parsePeriod(filter.from, filter.to);
    const space = await this.findSpaceOrThrow(spaceId);
    const walletFilter: Prisma.ExpenseWhereInput = filter.walletIds?.length
      ? { walletId: { in: filter.walletIds } }
      : {};

    const [categories, currentExpenses, previousPeriodSums] = await Promise.all(
      [
        this.prisma.category.findMany({ where: { spaceId } }),
        this.prisma.expense.findMany({
          where: {
            spaceId,
            ...walletFilter,
            occurredAt: { gte: fromStart, lte: toEnd },
          },
          include: expenseWithJoinsInclude,
          orderBy: { occurredAt: 'asc' },
        }),
        this.getPreviousPeriodSums(spaceId, walletFilter, fromStart, toEnd),
      ],
    );

    return {
      currency: space.primaryCurrency,
      period: { from: filter.from, to: filter.to },
      totalExpense: this.sumByType(currentExpenses, TransactionType.EXPENSE),
      totalIncome: this.sumByType(currentExpenses, TransactionType.INCOME),
      previousPeriodExpense: previousPeriodSums.expense,
      previousPeriodIncome: previousPeriodSums.income,
      byCategory: this.buildByCategory(categories, currentExpenses),
      byDay: this.buildByDay(currentExpenses, fromStart, toEnd),
      expenses: currentExpenses.map((expense) => this.toExpenseItem(expense)),
    };
  }

  async exportExpensesCsv(
    spaceId: string,
    filter: { from: string; to: string },
  ): Promise<string> {
    const { fromStart, toEnd } = this.parsePeriod(filter.from, filter.to);
    const space = await this.findSpaceOrThrow(spaceId);

    const expenses = await this.prisma.expense.findMany({
      where: { spaceId, occurredAt: { gte: fromStart, lte: toEnd } },
      include: expenseWithJoinsInclude,
      orderBy: { occurredAt: 'asc' },
    });

    const header = [
      'Date',
      'Wallet',
      'Category',
      'Amount',
      'Currency',
      'AmountInPrimary',
      'PrimaryCurrency',
      'Note',
      'CreatedBy',
    ];
    const rows = expenses.map((expense) => {
      const item = this.toExpenseItem(expense);
      return [
        item.occurredAt.toISOString().slice(0, 10),
        item.walletName,
        item.categoryName,
        item.amount.toString(),
        item.walletCurrency,
        item.amountInPrimary.toString(),
        space.primaryCurrency,
        item.note ?? '',
        item.createdByName,
      ];
    });

    return [header, ...rows]
      .map((row) => row.map((field) => this.escapeCsvField(field)).join(','))
      .join('\r\n');
  }

  private escapeCsvField(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  protected parsePeriod(
    from: string,
    to: string,
  ): { fromStart: Date; toEnd: Date } {
    const fromStart = new Date(from);
    const toEnd = this.endOfUtcDay(to);
    if (Number.isNaN(fromStart.getTime()) || Number.isNaN(toEnd.getTime())) {
      throw new AppException(
        ERROR_CODES.INVALID_PERIOD,
        HttpStatus.BAD_REQUEST,
        'from/to must be valid dates',
      );
    }
    if (fromStart.getTime() > toEnd.getTime()) {
      throw new AppException(
        ERROR_CODES.INVALID_PERIOD,
        HttpStatus.BAD_REQUEST,
        'from must not be after to',
      );
    }
    return { fromStart, toEnd };
  }

  private async getPreviousPeriodSums(
    spaceId: string,
    walletFilter: Prisma.ExpenseWhereInput,
    fromStart: Date,
    toEnd: Date,
  ): Promise<{ expense: Prisma.Decimal; income: Prisma.Decimal }> {
    const durationMs = toEnd.getTime() - fromStart.getTime();
    const previousFrom = new Date(fromStart.getTime() - durationMs);
    const previousToExclusive = fromStart;

    const grouped = await this.prisma.expense.groupBy({
      by: ['type'],
      where: {
        spaceId,
        ...walletFilter,
        occurredAt: { gte: previousFrom, lt: previousToExclusive },
      },
      _sum: { amountInPrimary: true },
    });

    let expense = new Prisma.Decimal(0);
    let income = new Prisma.Decimal(0);
    for (const row of grouped) {
      const sum = row._sum.amountInPrimary ?? new Prisma.Decimal(0);
      if (row.type === TransactionType.EXPENSE) {
        expense = sum;
      } else {
        income = sum;
      }
    }
    return { expense, income };
  }

  private buildByCategory(
    categories: {
      id: string;
      name: string;
      icon: string | null;
      color: string | null;
      monthlyLimit: Prisma.Decimal | null;
    }[],
    expenses: ExpenseWithJoins[],
  ): AnalyticsByCategory[] {
    const spentByCategoryId = new Map<string | null, Prisma.Decimal>();
    for (const expense of expenses) {
      if (expense.type !== TransactionType.EXPENSE) continue;
      const key = expense.categoryId;
      const current = spentByCategoryId.get(key) ?? new Prisma.Decimal(0);
      spentByCategoryId.set(key, current.plus(expense.amountInPrimary));
    }

    const result: AnalyticsByCategory[] = categories.map((category) => {
      const spent = spentByCategoryId.get(category.id) ?? new Prisma.Decimal(0);
      return {
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        spent,
        limit: category.monthlyLimit,
        pct: this.computePct(spent, category.monthlyLimit),
      };
    });

    result.push({
      categoryId: null,
      name: UNCATEGORIZED_NAME,
      icon: null,
      color: null,
      spent: spentByCategoryId.get(null) ?? new Prisma.Decimal(0),
      limit: null,
      pct: 0,
    });

    return result;
  }

  private computePct(
    spent: Prisma.Decimal,
    limit: Prisma.Decimal | null,
  ): number {
    if (!limit || limit.lessThanOrEqualTo(0)) {
      return 0;
    }
    return Math.round(spent.dividedBy(limit).times(100).toNumber());
  }

  private buildByDay(
    expenses: ExpenseWithJoins[],
    fromStart: Date,
    toEnd: Date,
  ): AnalyticsByDay[] {
    const sumsByDate = new Map<
      string,
      { expense: Prisma.Decimal; income: Prisma.Decimal }
    >();
    for (const expense of expenses) {
      const dateKey = expense.occurredAt.toISOString().slice(0, 10);
      const current = sumsByDate.get(dateKey) ?? {
        expense: new Prisma.Decimal(0),
        income: new Prisma.Decimal(0),
      };
      if (expense.type === TransactionType.EXPENSE) {
        current.expense = current.expense.plus(expense.amountInPrimary);
      } else {
        current.income = current.income.plus(expense.amountInPrimary);
      }
      sumsByDate.set(dateKey, current);
    }

    const days: AnalyticsByDay[] = [];
    const cursor = new Date(
      Date.UTC(
        fromStart.getUTCFullYear(),
        fromStart.getUTCMonth(),
        fromStart.getUTCDate(),
      ),
    );
    const lastDay = new Date(
      Date.UTC(toEnd.getUTCFullYear(), toEnd.getUTCMonth(), toEnd.getUTCDate()),
    );
    while (cursor.getTime() <= lastDay.getTime()) {
      const dateKey = cursor.toISOString().slice(0, 10);
      const sums = sumsByDate.get(dateKey) ?? {
        expense: new Prisma.Decimal(0),
        income: new Prisma.Decimal(0),
      };
      days.push({ date: dateKey, expense: sums.expense, income: sums.income });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  private sumByType(
    expenses: ExpenseWithJoins[],
    type: TransactionType,
  ): Prisma.Decimal {
    return expenses
      .filter((expense) => expense.type === type)
      .reduce(
        (sum, expense) => sum.plus(expense.amountInPrimary),
        new Prisma.Decimal(0),
      );
  }

  protected toExpenseItem(expense: ExpenseWithJoins): AnalyticsExpenseItem {
    return {
      id: expense.id,
      type: expense.type,
      amount: expense.amount,
      walletCurrency: expense.walletCurrency,
      amountInPrimary: expense.amountInPrimary,
      fxRate: expense.fxRate,
      note: expense.note,
      occurredAt: expense.occurredAt,
      walletId: expense.walletId,
      walletName: expense.wallet.name,
      categoryId: expense.categoryId,
      categoryName: expense.category?.name ?? UNCATEGORIZED_NAME,
      createdById: expense.createdById,
      createdByName: expense.createdBy.name ?? expense.createdBy.email,
    };
  }

  protected endOfUtcDay(isoString: string): Date {
    const date = new Date(isoString);
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
  }

  protected async findSpaceOrThrow(
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
}
