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
  const service = new AnalyticsService(prisma as never);
  return { service, prisma };
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
      });

      expect(prisma.expense.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            spaceId: 's1',
            occurredAt: {
              gte: new Date(
                new Date('2026-06-01').getTime() -
                  (new Date('2026-06-10T23:59:59.999Z').getTime() -
                    new Date('2026-06-01').getTime()),
              ),
              lt: new Date('2026-06-01'),
            },
          }),
        }),
      );
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
      });

      expect(result.previousPeriodExpense.toNumber()).toBe(80);
      expect(result.previousPeriodIncome.toNumber()).toBe(300);
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
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });
});
