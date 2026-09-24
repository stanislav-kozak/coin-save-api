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

    it('throws INVALID_OCCURRED_AT when occurredAt does not parse to a valid date', async () => {
      const { service } = buildService();

      try {
        await service.createExpense('s1', 'u1', {
          walletId: 'w1',
          type: TransactionType.EXPENSE,
          amount: 10,
          occurredAt: 'not-a-date',
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
            lte: new Date('2026-06-30T23:59:59.999Z'),
          },
        },
        orderBy: { occurredAt: 'desc' },
      });
    });

    it('treats a date-only `to` filter as inclusive of the entire day', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findMany.mockResolvedValue([]);

      await service.listExpenses('s1', { to: '2026-06-30' });

      const where = prisma.expense.findMany.mock.calls[0][0].where;
      expect(where.occurredAt.lte).toEqual(
        new Date('2026-06-30T23:59:59.999Z'),
      );
      expect(where.occurredAt.lte).not.toEqual(
        new Date('2026-06-30T00:00:00.000Z'),
      );
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

  describe('updateExpense', () => {
    const baseExpense = {
      id: 'e1',
      spaceId: 's1',
      walletId: 'w1',
      categoryId: 'c1',
      type: TransactionType.EXPENSE,
      amount: new Prisma.Decimal(100),
      walletCurrency: 'USD',
      amountInPrimary: new Prisma.Decimal(110),
      fxRate: new Prisma.Decimal('1.1'),
      note: 'Old note',
      occurredAt: new Date('2026-06-10T00:00:00.000Z'),
    };

    it('updates note without recomputing fxRate/amountInPrimary', async () => {
      const { service, prisma, getRate } = buildService();
      prisma.expense.findUnique.mockResolvedValue(baseExpense);
      prisma.expense.update.mockResolvedValue({
        ...baseExpense,
        note: 'New note',
      });

      await service.updateExpense('s1', 'e1', { note: 'New note' });

      expect(getRate).not.toHaveBeenCalled();
      expect(prisma.expense.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          walletId: undefined,
          categoryId: undefined,
          amount: undefined,
          walletCurrency: undefined,
          amountInPrimary: undefined,
          fxRate: undefined,
          note: 'New note',
          occurredAt: undefined,
        },
      });
    });

    it('recomputes fxRate/amountInPrimary when amount changes', async () => {
      const { service, prisma, getRate } = buildService();
      prisma.expense.findUnique.mockResolvedValue(baseExpense);
      prisma.expense.update.mockResolvedValue(baseExpense);

      await service.updateExpense('s1', 'e1', { amount: 200 });

      expect(getRate).toHaveBeenCalledWith(
        'USD',
        'EUR',
        baseExpense.occurredAt,
      );
      const updateData = prisma.expense.update.mock.calls[0][0].data;
      expect(updateData.amount).toBe(200);
      expect((updateData.amountInPrimary as Prisma.Decimal).toNumber()).toBe(
        220,
      );
      expect((updateData.fxRate as Prisma.Decimal).toNumber()).toBe(1.1);
    });

    it('recomputes fxRate/amountInPrimary when occurredAt changes', async () => {
      const { service, prisma, getRate } = buildService();
      prisma.expense.findUnique.mockResolvedValue(baseExpense);
      prisma.expense.update.mockResolvedValue(baseExpense);

      await service.updateExpense('s1', 'e1', {
        occurredAt: '2026-06-12T00:00:00.000Z',
      });

      expect(getRate).toHaveBeenCalledWith(
        'USD',
        'EUR',
        new Date('2026-06-12T00:00:00.000Z'),
      );
    });

    it('re-snapshots walletCurrency and recomputes when walletId changes', async () => {
      const { service, prisma, getRate } = buildService({
        prisma: {
          wallet: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'w2',
              spaceId: 's1',
              currency: 'PLN',
            }),
          },
        },
      });
      prisma.expense.findUnique.mockResolvedValue(baseExpense);
      prisma.expense.update.mockResolvedValue(baseExpense);

      await service.updateExpense('s1', 'e1', { walletId: 'w2' });

      expect(getRate).toHaveBeenCalledWith(
        'PLN',
        'EUR',
        baseExpense.occurredAt,
      );
      const updateData = prisma.expense.update.mock.calls[0][0].data;
      expect(updateData.walletCurrency).toBe('PLN');
    });

    it('rejects an occurredAt update that is in the future', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue(baseExpense);

      try {
        await service.updateExpense('s1', 'e1', {
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

    it('throws WALLET_NOT_FOUND when the new walletId does not belong to the space', async () => {
      const { service, prisma } = buildService({
        prisma: {
          wallet: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'w2',
              spaceId: 'other',
              currency: 'PLN',
            }),
          },
        },
      });
      prisma.expense.findUnique.mockResolvedValue(baseExpense);

      try {
        await service.updateExpense('s1', 'e1', { walletId: 'w2' });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'WALLET_NOT_FOUND',
        });
      }
    });

    it('throws EXPENSE_NOT_FOUND when the expense belongs to a different space', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue({
        ...baseExpense,
        spaceId: 'other',
      });

      try {
        await service.updateExpense('s1', 'e1', { note: 'x' });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'EXPENSE_NOT_FOUND',
        });
      }
    });
  });

  describe('deleteExpense', () => {
    it('deletes the expense when it belongs to the space', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue({ id: 'e1', spaceId: 's1' });
      prisma.expense.delete.mockResolvedValue({ id: 'e1' });

      await service.deleteExpense('s1', 'e1');

      expect(prisma.expense.delete).toHaveBeenCalledWith({
        where: { id: 'e1' },
      });
    });

    it('throws EXPENSE_NOT_FOUND when the expense belongs to a different space', async () => {
      const { service, prisma } = buildService();
      prisma.expense.findUnique.mockResolvedValue({
        id: 'e1',
        spaceId: 'other',
      });

      try {
        await service.deleteExpense('s1', 'e1');
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'EXPENSE_NOT_FOUND',
        });
      }
    });
  });
});
