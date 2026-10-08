import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDays,
  countDaysInclusive,
  DEFAULT_TIME_ZONE,
  endOfZonedDay,
  startOfZonedDay,
  toCalendarDate,
  toZonedDate,
} from '../common/utils/time-zone';
import { CurrencyService } from '../currencies/currencies.service';
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
  tz?: string;
}

interface Period {
  timeZone: string;
  fromDate: string;
  toDate: string;
  fromStart: Date;
  toEnd: Date;
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
  currency: string;
  spentInCurrency: Prisma.Decimal;
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
  timeZone: string;
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
  constructor(
    protected readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  async getAnalytics(
    spaceId: string,
    filter: GetAnalyticsFilter,
  ): Promise<AnalyticsResponse> {
    const period = this.parsePeriod(filter.from, filter.to, filter.tz);
    const { fromStart, toEnd } = period;
    const space = await this.findSpaceOrThrow(spaceId);
    const walletFilter: Prisma.ExpenseWhereInput = filter.walletIds?.length
      ? { walletId: { in: filter.walletIds } }
      : {};

    const [categories, currentExpenses, previousPeriodSums] = await Promise.all(
      [
        this.prisma.category.findMany({
          where: { spaceId },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.expense.findMany({
          where: {
            spaceId,
            ...walletFilter,
            occurredAt: { gte: fromStart, lte: toEnd },
          },
          include: expenseWithJoinsInclude,
          orderBy: { occurredAt: 'asc' },
        }),
        this.getPreviousPeriodSums(spaceId, walletFilter, period),
      ],
    );

    return {
      currency: space.primaryCurrency,
      period: { from: filter.from, to: filter.to },
      timeZone: period.timeZone,
      totalExpense: this.sumByType(currentExpenses, TransactionType.EXPENSE),
      totalIncome: this.sumByType(currentExpenses, TransactionType.INCOME),
      previousPeriodExpense: previousPeriodSums.expense,
      previousPeriodIncome: previousPeriodSums.income,
      byCategory: this.buildByCategory(
        categories,
        currentExpenses,
        space.primaryCurrency,
        await this.convertForOwnCurrencyCategories(
          categories,
          currentExpenses,
          space.primaryCurrency,
        ),
      ),
      byDay: this.buildByDay(currentExpenses, period),
      expenses: currentExpenses.map((expense) => this.toExpenseItem(expense)),
    };
  }

  async exportExpensesCsv(
    spaceId: string,
    filter: { from: string; to: string; tz?: string },
  ): Promise<string> {
    const { fromStart, toEnd, timeZone } = this.parsePeriod(
      filter.from,
      filter.to,
      filter.tz,
    );
    const space = await this.findSpaceOrThrow(spaceId);

    const expenses = await this.prisma.expense.findMany({
      where: { spaceId, occurredAt: { gte: fromStart, lte: toEnd } },
      include: expenseWithJoinsInclude,
      orderBy: { occurredAt: 'asc' },
    });

    const header = [
      'Date',
      'Type',
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
        toZonedDate(item.occurredAt, timeZone),
        item.type,
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

    return (
      '﻿' +
      [header, ...rows]
        .map((row) => row.map((field) => this.escapeCsvField(field)).join(','))
        .join('\r\n')
    );
  }

  private escapeCsvField(value: string): string {
    const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    if (/[",\n\r]/.test(neutralized)) {
      return `"${neutralized.replace(/"/g, '""')}"`;
    }
    return neutralized;
  }

  // from/to are calendar days in the caller's time zone (default Kyiv):
  // the period runs from the start of `from` to the end of `to` there.
  protected parsePeriod(from: string, to: string, tz?: string): Period {
    const timeZone = tz ?? DEFAULT_TIME_ZONE;
    let fromDate: string;
    let toDate: string;
    try {
      fromDate = toCalendarDate(from, timeZone);
      toDate = toCalendarDate(to, timeZone);
    } catch {
      throw new AppException(
        ERROR_CODES.INVALID_PERIOD,
        HttpStatus.BAD_REQUEST,
        'from/to must be valid dates',
      );
    }
    const fromStart = startOfZonedDay(fromDate, timeZone);
    const toEnd = endOfZonedDay(toDate, timeZone);
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
    return { timeZone, fromDate, toDate, fromStart, toEnd };
  }

  private async getPreviousPeriodSums(
    spaceId: string,
    walletFilter: Prisma.ExpenseWhereInput,
    period: Period,
  ): Promise<{ expense: Prisma.Decimal; income: Prisma.Decimal }> {
    // The same number of calendar days right before the period, counted in
    // the period's time zone (a DST day is 23h or 25h, not 24h).
    const periodDays = countDaysInclusive(period.fromDate, period.toDate);
    const previousFrom = startOfZonedDay(
      addDays(period.fromDate, -periodDays),
      period.timeZone,
    );
    const previousToExclusive = period.fromStart;

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

  /**
   * For categories with their own budget currency: each of their expenses
   * converted from its wallet currency at its own day's rate (one batched
   * lookup). Returns expense id -> amount in the category's currency; empty
   * when every category follows the space (no rate lookups at all).
   */
  private async convertForOwnCurrencyCategories(
    categories: { id: string; currency: string | null }[],
    expenses: ExpenseWithJoins[],
    primaryCurrency: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const ownCurrency = new Map(
      categories
        .filter((c) => c.currency && c.currency !== primaryCurrency)
        .map((c) => [c.id, c.currency!]),
    );
    const toConvert = expenses.filter(
      (e) =>
        e.type === TransactionType.EXPENSE &&
        e.categoryId !== null &&
        ownCurrency.has(e.categoryId),
    );
    if (toConvert.length === 0) {
      return new Map();
    }
    const rates = await this.currencyService.getRates(
      toConvert.map((e) => ({
        from: e.walletCurrency,
        to: ownCurrency.get(e.categoryId!)!,
        date: e.occurredAt,
      })),
    );
    return new Map(
      toConvert.map((e, i) => [
        e.id,
        new Prisma.Decimal(e.amount).times(rates[i]),
      ]),
    );
  }

  private buildByCategory(
    categories: {
      id: string;
      name: string;
      icon: string | null;
      color: string | null;
      monthlyLimit: Prisma.Decimal | null;
      currency: string | null;
    }[],
    expenses: ExpenseWithJoins[],
    primaryCurrency: string,
    convertedAmounts: Map<string, Prisma.Decimal>,
  ): AnalyticsByCategory[] {
    // `spent` is in the space currency (it feeds the split and totals);
    // `spentInCurrency`, `limit` and `pct` are in the category's currency.
    const spentByCategoryId = new Map<string | null, Prisma.Decimal>();
    const spentInOwnCurrency = new Map<string, Prisma.Decimal>();
    for (const expense of expenses) {
      if (expense.type !== TransactionType.EXPENSE) continue;
      const key = expense.categoryId;
      const current = spentByCategoryId.get(key) ?? new Prisma.Decimal(0);
      spentByCategoryId.set(key, current.plus(expense.amountInPrimary));
      const converted = convertedAmounts.get(expense.id);
      if (key !== null && converted) {
        spentInOwnCurrency.set(
          key,
          (spentInOwnCurrency.get(key) ?? new Prisma.Decimal(0)).plus(
            converted,
          ),
        );
      }
    }

    const result: AnalyticsByCategory[] = categories.map((category) => {
      const spent = spentByCategoryId.get(category.id) ?? new Prisma.Decimal(0);
      const currency = category.currency ?? primaryCurrency;
      const spentInCurrency =
        currency === primaryCurrency
          ? spent
          : (spentInOwnCurrency.get(category.id) ?? new Prisma.Decimal(0));
      return {
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        spent,
        currency,
        spentInCurrency: spentInCurrency.toDecimalPlaces(4),
        limit: category.monthlyLimit,
        pct: this.computePct(spentInCurrency, category.monthlyLimit),
      };
    });

    const uncategorized = spentByCategoryId.get(null) ?? new Prisma.Decimal(0);
    result.push({
      categoryId: null,
      name: UNCATEGORIZED_NAME,
      icon: null,
      color: null,
      spent: uncategorized,
      currency: primaryCurrency,
      spentInCurrency: uncategorized,
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
    period: Period,
  ): AnalyticsByDay[] {
    const sumsByDate = new Map<
      string,
      { expense: Prisma.Decimal; income: Prisma.Decimal }
    >();
    for (const expense of expenses) {
      const dateKey = toZonedDate(expense.occurredAt, period.timeZone);
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
    for (
      let dateKey = period.fromDate;
      dateKey <= period.toDate;
      dateKey = addDays(dateKey, 1)
    ) {
      const sums = sumsByDate.get(dateKey) ?? {
        expense: new Prisma.Decimal(0),
        income: new Prisma.Decimal(0),
      };
      days.push({ date: dateKey, expense: sums.expense, income: sums.income });
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
