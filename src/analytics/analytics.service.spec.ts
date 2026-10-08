import { HttpStatus } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

function buildService(
  overrides: {
    prisma?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
    getRates?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const basePrisma = {
    space: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
    },
    category: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    expense: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const getRates = overrides.getRates ?? vi.fn().mockResolvedValue([]);
  const service = new AnalyticsService(prisma as never, { getRates } as never);
  return { service, prisma, getRates };
}

function expenseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    type: TransactionType.EXPENSE,
    amount: new Prisma.Decimal(100),
    walletCurrency: 'EUR',
    amountInPrimary: new Prisma.Decimal(100),
    fxRate: new Prisma.Decimal(1),
    note: null,
    occurredAt: new Date('2026-06-10T00:00:00.000Z'),
    walletId: 'w1',
    categoryId: 'c1',
    createdById: 'u1',
    wallet: { name: 'Cash' },
    category: { name: 'Groceries' },
    createdBy: { name: 'Olena', email: 'olena@example.com' },
    ...overrides,
  };
}

describe('AnalyticsService', () => {
  describe('getAnalytics', () => {
    it('sums totalExpense and totalIncome separately from mixed rows', async () => {
      const { service, prisma } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                type: TransactionType.EXPENSE,
                amountInPrimary: new Prisma.Decimal(100),
              }),
              expenseRow({
                id: 'e2',
                type: TransactionType.INCOME,
                amountInPrimary: new Prisma.Decimal(500),
              }),
              expenseRow({
                id: 'e3',
                type: TransactionType.EXPENSE,
                amountInPrimary: new Prisma.Decimal(50),
              }),
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(result.totalExpense.toNumber()).toBe(150);
      expect(result.totalIncome.toNumber()).toBe(500);
      expect(result.currency).toBe('EUR');
      expect(result.period).toEqual({ from: '2026-06-01', to: '2026-06-30' });
      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            spaceId: 's1',
            occurredAt: {
              gte: new Date('2026-06-01'),
              lte: new Date('2026-06-30T23:59:59.999Z'),
            },
          }),
        }),
      );
    });

    it('computes the previous period as the immediately preceding span of identical duration', async () => {
      const { service, prisma } = buildService();

      await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-10',
        tz: 'UTC',
      });

      expect(prisma.expense.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            spaceId: 's1',
            occurredAt: {
              gte: new Date('2026-05-22T00:00:00.000Z'),
              lt: new Date('2026-06-01T00:00:00.000Z'),
            },
          }),
        }),
      );
    });

    it('includes a midnight-exact transaction on the first day of the previous period (no fencepost drop)', async () => {
      const { service, prisma } = buildService({
        prisma: {
          expense: {
            groupBy: vi.fn().mockResolvedValue([
              {
                type: TransactionType.EXPENSE,
                _sum: { amountInPrimary: new Prisma.Decimal(40) },
              },
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-10',
        tz: 'UTC',
      });

      // The groupBy `gte` bound must be exactly UTC midnight on 2026-05-22 so
      // that a transaction stored at exactly 2026-05-22T00:00:00.000Z (a
      // common value, since date-only input normalizes to midnight) is
      // included rather than excluded by a 1ms-early lower bound.
      expect(prisma.expense.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            occurredAt: expect.objectContaining({
              gte: new Date('2026-05-22T00:00:00.000Z'),
            }),
          }),
        }),
      );
      expect(result.previousPeriodExpense.toNumber()).toBe(40);
    });

    it('returns previousPeriodExpense/Income from the groupBy sums', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            groupBy: vi.fn().mockResolvedValue([
              {
                type: TransactionType.EXPENSE,
                _sum: { amountInPrimary: new Prisma.Decimal(80) },
              },
              {
                type: TransactionType.INCOME,
                _sum: { amountInPrimary: new Prisma.Decimal(300) },
              },
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-10',
        tz: 'UTC',
      });

      expect(result.previousPeriodExpense.toNumber()).toBe(80);
      expect(result.previousPeriodIncome.toNumber()).toBe(300);
    });

    it('requests categories ordered by sortOrder for deterministic byCategory output', async () => {
      const { service, prisma } = buildService();

      await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { sortOrder: 'asc' } }),
      );
    });

    it('preserves the query-returned category order in byCategory (Uncategorized still last)', async () => {
      const { service } = buildService({
        prisma: {
          category: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'c2',
                name: 'Fun',
                icon: null,
                color: null,
                monthlyLimit: null,
              },
              {
                id: 'c1',
                name: 'Groceries',
                icon: '🛒',
                color: '#fff',
                monthlyLimit: new Prisma.Decimal(200),
              },
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(result.byCategory.map((c) => c.categoryId)).toEqual([
        'c2',
        'c1',
        null,
      ]);
    });

    it('includes all space categories plus an Uncategorized bucket, with correct spent/pct', async () => {
      const { service } = buildService({
        prisma: {
          category: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'c1',
                name: 'Groceries',
                icon: '🛒',
                color: '#fff',
                monthlyLimit: new Prisma.Decimal(200),
              },
              {
                id: 'c2',
                name: 'Fun',
                icon: null,
                color: null,
                monthlyLimit: null,
              },
            ]),
          },
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                type: TransactionType.EXPENSE,
                categoryId: 'c1',
                amountInPrimary: new Prisma.Decimal(150),
              }),
              expenseRow({
                id: 'e2',
                type: TransactionType.EXPENSE,
                categoryId: null,
                category: null,
                amountInPrimary: new Prisma.Decimal(20),
              }),
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(result.byCategory).toHaveLength(3);
      const groceries = result.byCategory.find((c) => c.categoryId === 'c1')!;
      expect(groceries.spent.toNumber()).toBe(150);
      expect(groceries.pct).toBe(75); // 150/200 * 100
      const fun = result.byCategory.find((c) => c.categoryId === 'c2')!;
      expect(fun.spent.toNumber()).toBe(0);
      expect(fun.pct).toBe(0); // no limit
      const uncategorized = result.byCategory.find(
        (c) => c.categoryId === null,
      )!;
      expect(uncategorized.name).toBe('Uncategorized');
      expect(uncategorized.spent.toNumber()).toBe(20);
      expect(uncategorized.pct).toBe(0);
    });

    it('buckets byDay across the full period, including days with zero activity', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                type: TransactionType.EXPENSE,
                occurredAt: new Date('2026-06-01T08:00:00.000Z'),
                amountInPrimary: new Prisma.Decimal(10),
              }),
              expenseRow({
                id: 'e2',
                type: TransactionType.INCOME,
                occurredAt: new Date('2026-06-03T08:00:00.000Z'),
                amountInPrimary: new Prisma.Decimal(20),
              }),
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-03',
        tz: 'UTC',
      });

      expect(result.byDay).toEqual([
        {
          date: '2026-06-01',
          expense: expect.any(Prisma.Decimal),
          income: expect.any(Prisma.Decimal),
        },
        {
          date: '2026-06-02',
          expense: expect.any(Prisma.Decimal),
          income: expect.any(Prisma.Decimal),
        },
        {
          date: '2026-06-03',
          expense: expect.any(Prisma.Decimal),
          income: expect.any(Prisma.Decimal),
        },
      ]);
      expect(result.byDay[0].expense.toNumber()).toBe(10);
      expect(result.byDay[0].income.toNumber()).toBe(0);
      expect(result.byDay[1].expense.toNumber()).toBe(0);
      expect(result.byDay[2].income.toNumber()).toBe(20);
    });

    it('enriches the expenses list with walletName/categoryName/createdByName for both types', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                type: TransactionType.INCOME,
                wallet: { name: 'Card' },
                category: null,
                categoryId: null,
                createdBy: { name: null, email: 'anon@example.com' },
              }),
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(result.expenses).toHaveLength(1);
      expect(result.expenses[0]).toMatchObject({
        id: 'e1',
        type: TransactionType.INCOME,
        walletName: 'Card',
        categoryName: 'Uncategorized',
        createdByName: 'anon@example.com',
      });
    });

    it('applies the walletIds filter to both the current and previous period queries', async () => {
      const { service, prisma } = buildService();

      await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-10',
        tz: 'UTC',
        walletIds: ['w1', 'w2'],
      });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ walletId: { in: ['w1', 'w2'] } }),
        }),
      );
      expect(prisma.expense.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ walletId: { in: ['w1', 'w2'] } }),
        }),
      );
    });

    it('throws INVALID_PERIOD when from is after to', async () => {
      const { service } = buildService();

      try {
        await service.getAnalytics('s1', {
          from: '2026-06-10',
          to: '2026-06-01',
          tz: 'UTC',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'INVALID_PERIOD',
        });
      }
    });

    it('throws INVALID_PERIOD when from/to are not parseable dates', async () => {
      const { service } = buildService();

      try {
        await service.getAnalytics('s1', {
          from: 'not-a-date',
          to: '2026-06-10',
          tz: 'UTC',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'INVALID_PERIOD',
        });
      }
    });

    it('throws SPACE_NOT_FOUND when the space does not exist', async () => {
      const { service } = buildService({
        prisma: { space: { findUnique: vi.fn().mockResolvedValue(null) } },
      });

      try {
        await service.getAnalytics('missing', {
          from: '2026-06-01',
          to: '2026-06-10',
          tz: 'UTC',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe('category currency', () => {
    it("reports spentInCurrency/limit/pct in a category's own currency, converted per expense", async () => {
      const getRates = vi.fn().mockResolvedValue([new Prisma.Decimal('3.9')]);
      const { service } = buildService({
        getRates,
        prisma: {
          category: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'trip',
                name: 'Trip',
                icon: null,
                color: null,
                monthlyLimit: new Prisma.Decimal(780),
                currency: 'PLN',
              },
              {
                id: 'food',
                name: 'Food',
                icon: null,
                color: null,
                monthlyLimit: new Prisma.Decimal(100),
                currency: null,
              },
            ]),
          },
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                categoryId: 'trip',
                type: TransactionType.EXPENSE,
                amount: new Prisma.Decimal(100),
                walletCurrency: 'USD',
                amountInPrimary: new Prisma.Decimal(90),
              }),
              expenseRow({
                id: 'e2',
                categoryId: 'food',
                type: TransactionType.EXPENSE,
                amountInPrimary: new Prisma.Decimal(25),
              }),
            ]),
          },
        },
      });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      // Only the own-currency category's expenses need a rate.
      expect(getRates).toHaveBeenCalledTimes(1);
      expect(getRates).toHaveBeenCalledWith([
        { from: 'USD', to: 'PLN', date: expect.any(Date) as Date },
      ]);
      const trip = result.byCategory.find((c) => c.categoryId === 'trip')!;
      expect(trip.currency).toBe('PLN');
      expect(trip.spent.toNumber()).toBe(90); // space currency
      expect(trip.spentInCurrency.toNumber()).toBe(390);
      expect(trip.pct).toBe(50); // 390 / 780
      const food = result.byCategory.find((c) => c.categoryId === 'food')!;
      expect(food.currency).toBe('EUR');
      expect(food.spentInCurrency.toNumber()).toBe(25);
      expect(food.pct).toBe(25);
      const uncategorized = result.byCategory.find(
        (c) => c.categoryId === null,
      )!;
      expect(uncategorized.currency).toBe('EUR');
    });

    it('does no rate lookups when every category follows the space', async () => {
      const { service, getRates } = buildService();

      await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(getRates).not.toHaveBeenCalled();
    });
  });

  describe('time zones', () => {
    it('uses Kyiv day boundaries by default, so 30.09 18:00 Kyiv stays in September', async () => {
      const findMany = vi.fn().mockResolvedValue([
        expenseRow({
          id: 'oct1-0130-kyiv',
          type: TransactionType.EXPENSE,
          occurredAt: new Date('2026-09-30T22:30:00.000Z'), // 01.10 01:30 Kyiv
          amountInPrimary: new Prisma.Decimal(50),
        }),
      ]);
      const { service } = buildService({ prisma: { expense: { findMany } } });

      const result = await service.getAnalytics('s1', {
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(result.timeZone).toBe('Europe/Kyiv');
      const currentQuery = findMany.mock.calls[0][0] as {
        where: { occurredAt: { gte: Date; lte: Date } };
      };
      // 01.10 00:00 Kyiv (UTC+3) .. 31.10 23:59:59.999 Kyiv (UTC+2 after DST ends)
      expect(currentQuery.where.occurredAt.gte.toISOString()).toBe(
        '2026-09-30T21:00:00.000Z',
      );
      expect(currentQuery.where.occurredAt.lte.toISOString()).toBe(
        '2026-10-31T21:59:59.999Z',
      );
      expect(result.byDay).toHaveLength(31);
      expect(result.byDay[0].date).toBe('2026-10-01');
      expect(result.byDay[0].expense.toNumber()).toBe(50);
    });

    it('uses the time zone the client sends', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const { service } = buildService({ prisma: { expense: { findMany } } });

      const result = await service.getAnalytics('s1', {
        from: '2026-06-01',
        to: '2026-06-01',
        tz: 'America/New_York',
      });

      expect(result.timeZone).toBe('America/New_York');
      const currentQuery = findMany.mock.calls[0][0] as {
        where: { occurredAt: { gte: Date; lte: Date } };
      };
      expect(currentQuery.where.occurredAt.gte.toISOString()).toBe(
        '2026-06-01T04:00:00.000Z',
      );
    });

    it('dates CSV rows in the requested time zone', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                occurredAt: new Date('2026-09-30T22:30:00.000Z'),
              }),
            ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(csv.split('\r\n')[1].startsWith('2026-10-01,')).toBe(true);
    });
  });

  describe('exportExpensesCsv', () => {
    it('produces a header row followed by one data row per expense', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                occurredAt: new Date('2026-06-05T00:00:00.000Z'),
                amount: new Prisma.Decimal(42.5),
                walletCurrency: 'USD',
                amountInPrimary: new Prisma.Decimal(39.1),
                note: 'Weekly shop',
              }),
            ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        '﻿Date,Type,Wallet,Category,Amount,Currency,AmountInPrimary,PrimaryCurrency,Note,CreatedBy',
      );
      expect(lines[1]).toBe(
        '2026-06-05,EXPENSE,Cash,Groceries,42.5,USD,39.1,EUR,Weekly shop,Olena',
      );
      expect(lines).toHaveLength(2);
    });

    it('prefixes the CSV with a UTF-8 BOM so Excel renders Cyrillic content correctly', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([expenseRow({ id: 'e1' })]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });

    it('includes a Type column distinguishing EXPENSE from INCOME rows', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                type: TransactionType.EXPENSE,
                amountInPrimary: new Prisma.Decimal(500),
                amount: new Prisma.Decimal(500),
              }),
              expenseRow({
                id: 'e2',
                type: TransactionType.INCOME,
                amountInPrimary: new Prisma.Decimal(500),
                amount: new Prisma.Decimal(500),
              }),
            ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      const lines = csv.replace(/^\ufeff/, '').split('\r\n');
      expect(lines[1]).toContain(',EXPENSE,');
      expect(lines[2]).toContain(',INCOME,');
      expect(lines[1]).not.toBe(lines[2]);
    });

    it('neutralizes formula injection in a Note starting with "="', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi
              .fn()
              .mockResolvedValue([
                expenseRow({ id: 'e1', note: '=HYPERLINK("http://evil")' }),
              ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    });

    it('neutralizes formula injection in a Wallet name starting with "+"', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                wallet: { name: '+1+1' },
              }),
            ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      const lines = csv.replace(/^\ufeff/, '').split('\r\n');
      expect(lines[1]).toContain(",'+1+1,");
    });

    it('uses Uncategorized for expenses with no category', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi
              .fn()
              .mockResolvedValue([
                expenseRow({ id: 'e1', category: null, categoryId: null }),
              ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv.split('\r\n')[1]).toContain(',Uncategorized,');
    });

    it('falls back to email when the creator has no name', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi.fn().mockResolvedValue([
              expenseRow({
                id: 'e1',
                createdBy: { name: null, email: 'anon@example.com' },
              }),
            ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv.split('\r\n')[1]).toContain('anon@example.com');
    });

    it('quotes a note containing a comma', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi
              .fn()
              .mockResolvedValue([
                expenseRow({ id: 'e1', note: 'Milk, eggs, bread' }),
              ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv.split('\r\n')[1]).toContain('"Milk, eggs, bread"');
    });

    it('quotes and escapes a note containing a double quote', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi
              .fn()
              .mockResolvedValue([
                expenseRow({ id: 'e1', note: 'She said "hi"' }),
              ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv.split('\r\n')[1]).toContain('"She said ""hi"""');
    });

    it('quotes a note containing a newline', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi
              .fn()
              .mockResolvedValue([
                expenseRow({ id: 'e1', note: 'Line one\nLine two' }),
              ]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv).toContain('"Line one\nLine two"');
    });

    it('uses an empty field for a missing note', async () => {
      const { service } = buildService({
        prisma: {
          expense: {
            findMany: vi
              .fn()
              .mockResolvedValue([expenseRow({ id: 'e1', note: null })]),
          },
        },
      });

      const csv = await service.exportExpensesCsv('s1', {
        from: '2026-06-01',
        to: '2026-06-30',
        tz: 'UTC',
      });

      expect(csv.split('\r\n')[1]).toContain(',,Olena');
    });

    it('throws INVALID_PERIOD when from is after to', async () => {
      const { service } = buildService();

      try {
        await service.exportExpensesCsv('s1', {
          from: '2026-06-10',
          to: '2026-06-01',
          tz: 'UTC',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'INVALID_PERIOD',
        });
      }
    });
  });
});
