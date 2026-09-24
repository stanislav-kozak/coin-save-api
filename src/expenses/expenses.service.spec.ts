import { HttpStatus } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

function buildService(
  overrides: {
    prisma?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
    getRate?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const basePrisma = {
    wallet: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'w1',
        spaceId: 's1',
        currency: 'USD',
      }),
    },
    category: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', spaceId: 's1' }),
    },
    space: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
    },
    expense: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const getRate =
    overrides.getRate ?? vi.fn().mockResolvedValue(new Prisma.Decimal('1.1'));
  const currencyService = { getRate } as never;
  const service = new ExpensesService(prisma as never, currencyService);
  return { service, prisma, getRate };
}

const now = new Date('2026-06-15T12:00:00.000Z');

describe('ExpensesService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createExpense', () => {
    it('snapshots walletCurrency, computes fxRate/amountInPrimary, and sets createdById', async () => {
      const { service, prisma, getRate } = buildService();
      prisma.expense.create.mockResolvedValue({ id: 'e1' });

      await service.createExpense('s1', 'u1', {
        walletId: 'w1',
        categoryId: 'c1',
        type: TransactionType.EXPENSE,
        amount: 100,
        occurredAt: '2026-06-10T00:00:00.000Z',
        note: 'Groceries',
      });

      expect(getRate).toHaveBeenCalledWith(
        'USD',
        'EUR',
        new Date('2026-06-10T00:00:00.000Z'),
      );
      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: {
          spaceId: 's1',
          walletId: 'w1',
          categoryId: 'c1',
          type: TransactionType.EXPENSE,
          amount: 100,
          walletCurrency: 'USD',
          amountInPrimary: expect.any(Prisma.Decimal),
          fxRate: expect.any(Prisma.Decimal),
          note: 'Groceries',
          occurredAt: new Date('2026-06-10T00:00:00.000Z'),
          createdById: 'u1',
        },
      });
      const createdData = prisma.expense.create.mock.calls[0][0].data;
      expect((createdData.amountInPrimary as Prisma.Decimal).toNumber()).toBe(
        110,
      );
      expect((createdData.fxRate as Prisma.Decimal).toNumber()).toBe(1.1);
    });

    it('creates without a category when categoryId is omitted', async () => {
      const { service, prisma } = buildService();
      prisma.expense.create.mockResolvedValue({ id: 'e1' });

      await service.createExpense('s1', 'u1', {
        walletId: 'w1',
        type: TransactionType.INCOME,
        amount: 500,
        occurredAt: '2026-06-10T00:00:00.000Z',
      });

      const createdData = prisma.expense.create.mock.calls[0][0].data;
      expect(createdData.categoryId).toBeUndefined();
    });

    it('throws WALLET_NOT_FOUND when the wallet does not belong to the space', async () => {
      const { service } = buildService({
        prisma: {
          wallet: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'w1',
              spaceId: 'other',
              currency: 'USD',
            }),
          },
        },
      });

      try {
        await service.createExpense('s1', 'u1', {
          walletId: 'w1',
          type: TransactionType.EXPENSE,
          amount: 10,
          occurredAt: '2026-06-10T00:00:00.000Z',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'WALLET_NOT_FOUND',
        });
      }
    });

    it('throws CATEGORY_NOT_FOUND when the category does not belong to the space', async () => {
      const { service } = buildService({
        prisma: {
          category: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 'c1', spaceId: 'other' }),
          },
        },
      });

      try {
        await service.createExpense('s1', 'u1', {
          walletId: 'w1',
          categoryId: 'c1',
          type: TransactionType.EXPENSE,
          amount: 10,
          occurredAt: '2026-06-10T00:00:00.000Z',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'CATEGORY_NOT_FOUND',
        });
      }
    });

    it('throws INVALID_OCCURRED_AT when occurredAt is in the future', async () => {
      const { service } = buildService();

      try {
        await service.createExpense('s1', 'u1', {
          walletId: 'w1',
          type: TransactionType.EXPENSE,
          amount: 10,
          occurredAt: '2026-06-16T00:00:00.000Z',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'INVALID_OCCURRED_AT',
        });
      }
    });

    it('throws INVALID_OCCURRED_AT when occurredAt is more than 5 years in the past', async () => {
      const { service } = buildService();

      try {
        await service.createExpense('s1', 'u1', {
          walletId: 'w1',
          type: TransactionType.EXPENSE,
          amount: 10,
          occurredAt: '2021-06-14T00:00:00.000Z',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'INVALID_OCCURRED_AT',
        });
      }
    });
  });

  describe('listExpenses', () => {
    it('applies walletId/categoryId/type/from/to filters and sorts by occurredAt desc', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findMany.mockResolvedValue([]);

      await service.listExpenses('s1', {
        walletId: 'w1',
        categoryId: 'c1',
        type: TransactionType.EXPENSE,
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
      });

      expect(prisma.expense.findMany).toHaveBeenCalledWith({
        where: {
          spaceId: 's1',
          walletId: 'w1',
          categoryId: 'c1',
          type: TransactionType.EXPENSE,
          occurredAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-30T00:00:00.000Z'),
          },
        },
        orderBy: { occurredAt: 'desc' },
      });
    });

    it('omits absent filters from the where clause', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findMany.mockResolvedValue([]);

      await service.listExpenses('s1', {});

      expect(prisma.expense.findMany).toHaveBeenCalledWith({
        where: { spaceId: 's1' },
        orderBy: { occurredAt: 'desc' },
      });
    });
  });

  describe('getExpense', () => {
    it('returns the expense when it belongs to the space', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue({ id: 'e1', spaceId: 's1' });

      const result = await service.getExpense('s1', 'e1');

      expect(result).toEqual({ id: 'e1', spaceId: 's1' });
    });

    it('throws EXPENSE_NOT_FOUND when the expense belongs to a different space', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue({
        id: 'e1',
        spaceId: 'other',
      });

      try {
        await service.getExpense('s1', 'e1');
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'EXPENSE_NOT_FOUND',
        });
      }
    });

    it('throws EXPENSE_NOT_FOUND when the expense does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue(null);

      try {
        await service.getExpense('s1', 'missing');
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });
});
