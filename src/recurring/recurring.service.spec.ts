import { HttpStatus } from '@nestjs/common';
import { RecurringFrequency, TransactionType } from '@prisma/client';
import { RecurringService } from './recurring.service';
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
    wallet: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'w1', spaceId: 's1', currency: 'USD' }),
    },
    category: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', spaceId: 's1' }),
    },
    recurringTransaction: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const service = new RecurringService(prisma as never);
  return { service, prisma };
}

const baseInput = {
  walletId: 'w1',
  categoryId: 'c1',
  type: TransactionType.EXPENSE,
  amount: 15.99,
  name: 'Netflix',
  frequency: RecurringFrequency.MONTHLY,
  dayOfMonth: 5,
  startDate: '2026-07-01T00:00:00.000Z',
};

describe('RecurringService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a recurring transaction, deriving currency from the wallet', async () => {
    const { service, prisma } = buildService();
    prisma.recurringTransaction.create.mockResolvedValue({ id: 'r1' });

    await service.createRecurringTransaction('s1', 'u1', baseInput);

    expect(prisma.recurringTransaction.create).toHaveBeenCalledWith({
      data: {
        spaceId: 's1',
        walletId: 'w1',
        categoryId: 'c1',
        type: TransactionType.EXPENSE,
        amount: 15.99,
        currency: 'USD',
        name: 'Netflix',
        note: undefined,
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: 5,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: undefined,
        lastGeneratedAt: new Date('2026-08-15T12:00:00.000Z'),
        createdById: 'u1',
      },
    });
  });

  it('creates without a category when categoryId is omitted', async () => {
    const { service, prisma } = buildService();
    prisma.recurringTransaction.create.mockResolvedValue({ id: 'r1' });

    await service.createRecurringTransaction('s1', 'u1', {
      ...baseInput,
      categoryId: undefined,
    });

    const createdData =
      prisma.recurringTransaction.create.mock.calls[0][0].data;
    expect(createdData.categoryId).toBeUndefined();
  });

  it('parses an optional endDate', async () => {
    const { service, prisma } = buildService();
    prisma.recurringTransaction.create.mockResolvedValue({ id: 'r1' });

    await service.createRecurringTransaction('s1', 'u1', {
      ...baseInput,
      endDate: '2027-01-01T00:00:00.000Z',
    });

    const createdData =
      prisma.recurringTransaction.create.mock.calls[0][0].data;
    expect(createdData.endDate).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('throws WALLET_NOT_FOUND when the wallet does not belong to the space', async () => {
    const { service } = buildService({
      prisma: {
        wallet: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'w1', spaceId: 'other', currency: 'USD' }),
        },
      },
    });

    try {
      await service.createRecurringTransaction('s1', 'u1', baseInput);
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
          findUnique: vi.fn().mockResolvedValue({ id: 'c1', spaceId: 'other' }),
        },
      },
    });

    try {
      await service.createRecurringTransaction('s1', 'u1', baseInput);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((error as AppException).getResponse()).toMatchObject({
        code: 'CATEGORY_NOT_FOUND',
      });
    }
  });

  it('throws WALLET_ARCHIVED when the wallet is archived', async () => {
    const { service } = buildService({
      prisma: {
        wallet: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'w1',
            spaceId: 's1',
            currency: 'USD',
            archived: true,
          }),
        },
      },
    });

    try {
      await service.createRecurringTransaction('s1', 'u1', baseInput);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((error as AppException).getResponse()).toMatchObject({
        code: 'WALLET_ARCHIVED',
      });
    }
  });

  it('throws CATEGORY_ARCHIVED when the category is archived', async () => {
    const { service } = buildService({
      prisma: {
        category: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'c1', spaceId: 's1', archived: true }),
        },
      },
    });

    try {
      await service.createRecurringTransaction('s1', 'u1', baseInput);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((error as AppException).getResponse()).toMatchObject({
        code: 'CATEGORY_ARCHIVED',
      });
    }
  });

  it('throws INVALID_RECURRING_DATE_RANGE when endDate is before startDate', async () => {
    const { service, prisma } = buildService();

    try {
      await service.createRecurringTransaction('s1', 'u1', {
        ...baseInput,
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-06-01T00:00:00.000Z',
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as AppException).getResponse()).toMatchObject({
        code: 'INVALID_RECURRING_DATE_RANGE',
      });
    }
    expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  it('throws INVALID_RECURRING_DATE_RANGE when endDate equals startDate', async () => {
    const { service, prisma } = buildService();

    try {
      await service.createRecurringTransaction('s1', 'u1', {
        ...baseInput,
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-01T00:00:00.000Z',
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as AppException).getResponse()).toMatchObject({
        code: 'INVALID_RECURRING_DATE_RANGE',
      });
    }
    expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  describe('createRecurringTransaction backfill avoidance', () => {
    it('seeds lastGeneratedAt to the creation time when startDate is in the past', async () => {
      const { service, prisma } = buildService();
      prisma.recurringTransaction.create.mockResolvedValue({ id: 'r1' });

      await service.createRecurringTransaction('s1', 'u1', {
        ...baseInput,
        startDate: '2026-01-01T00:00:00.000Z',
      });

      const createdData =
        prisma.recurringTransaction.create.mock.calls[0][0].data;
      expect(createdData.lastGeneratedAt).toEqual(
        new Date('2026-08-15T12:00:00.000Z'),
      );
    });

    it('leaves lastGeneratedAt unset when startDate is in the future', async () => {
      const { service, prisma } = buildService();
      prisma.recurringTransaction.create.mockResolvedValue({ id: 'r1' });

      await service.createRecurringTransaction('s1', 'u1', {
        ...baseInput,
        startDate: '2026-12-01T00:00:00.000Z',
      });

      const createdData =
        prisma.recurringTransaction.create.mock.calls[0][0].data;
      expect(createdData.lastGeneratedAt).toBeUndefined();
    });
  });

  describe('listRecurringTransactions', () => {
    it('excludes inactive recurring transactions by default', async () => {
      const { service, prisma } = buildService();
      prisma.recurringTransaction.findMany.mockResolvedValue([]);

      await service.listRecurringTransactions('s1', false);

      expect(prisma.recurringTransaction.findMany).toHaveBeenCalledWith({
        where: { spaceId: 's1', active: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('includes inactive recurring transactions when requested', async () => {
      const { service, prisma } = buildService();
      prisma.recurringTransaction.findMany.mockResolvedValue([]);

      await service.listRecurringTransactions('s1', true);

      expect(prisma.recurringTransaction.findMany).toHaveBeenCalledWith({
        where: { spaceId: 's1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getRecurringTransaction', () => {
    it('returns the recurring transaction when it belongs to the space', async () => {
      const { service } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue({ id: 'r1', spaceId: 's1' }),
          },
        },
      });

      const result = await service.getRecurringTransaction('s1', 'r1');

      expect(result).toEqual({ id: 'r1', spaceId: 's1' });
    });

    it('throws RECURRING_NOT_FOUND when it belongs to a different space', async () => {
      const { service } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 'r1', spaceId: 'other' }),
          },
        },
      });

      try {
        await service.getRecurringTransaction('s1', 'r1');
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((error as AppException).getResponse()).toMatchObject({
          code: 'RECURRING_NOT_FOUND',
        });
      }
    });
  });

  describe('updateRecurringTransaction', () => {
    const existingRecurring = {
      id: 'r1',
      spaceId: 's1',
      walletId: 'w1',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('updates fields without touching currency when walletId is unchanged', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue(existingRecurring),
            update: vi.fn().mockResolvedValue(existingRecurring),
          },
        },
      });

      await service.updateRecurringTransaction('s1', 'r1', { amount: 20 });

      expect(prisma.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: {
          walletId: undefined,
          categoryId: undefined,
          amount: 20,
          currency: undefined,
          name: undefined,
          note: undefined,
          dayOfMonth: undefined,
          endDate: undefined,
        },
      });
    });

    it('re-derives currency from the new wallet when walletId changes', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue(existingRecurring),
            update: vi.fn().mockResolvedValue(existingRecurring),
          },
          wallet: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 'w2', spaceId: 's1', currency: 'PLN' }),
          },
        },
      });

      await service.updateRecurringTransaction('s1', 'r1', {
        walletId: 'w2',
      });

      const updateData =
        prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(updateData.currency).toBe('PLN');
    });

    it('throws RECURRING_NOT_FOUND when the recurring transaction does not exist', async () => {
      const { service } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        },
      });

      try {
        await service.updateRecurringTransaction('s1', 'missing', {
          amount: 20,
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });

    it('throws INVALID_RECURRING_DATE_RANGE when the new endDate is before the existing startDate', async () => {
      const { service } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue(existingRecurring),
            update: vi.fn().mockResolvedValue(existingRecurring),
          },
        },
      });

      try {
        await service.updateRecurringTransaction('s1', 'r1', {
          endDate: '2025-01-01T00:00:00.000Z',
        });
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
      }
    });

    it('clears endDate when null is passed', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue(existingRecurring),
            update: vi.fn().mockResolvedValue(existingRecurring),
          },
        },
      });

      await service.updateRecurringTransaction('s1', 'r1', { endDate: null });

      const updateData =
        prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(updateData.endDate).toBeNull();
    });

    it('clears categoryId when null is passed', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue(existingRecurring),
            update: vi.fn().mockResolvedValue(existingRecurring),
          },
        },
      });

      await service.updateRecurringTransaction('s1', 'r1', {
        categoryId: null,
      });

      const updateData =
        prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(updateData.categoryId).toBeNull();
    });
  });

  describe('pauseRecurringTransaction / resumeRecurringTransaction', () => {
    it('pause sets active to false', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue({ id: 'r1', spaceId: 's1' }),
            update: vi.fn().mockResolvedValue({ id: 'r1', active: false }),
          },
        },
      });

      const result = await service.pauseRecurringTransaction('s1', 'r1');

      expect(prisma.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it('resume sets active to true', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue({ id: 'r1', spaceId: 's1' }),
            update: vi.fn().mockResolvedValue({ id: 'r1', active: true }),
          },
        },
      });

      const result = await service.resumeRecurringTransaction('s1', 'r1');

      expect(prisma.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: {
          active: true,
          lastGeneratedAt: new Date('2026-08-15T12:00:00.000Z'),
        },
      });
      expect(result.active).toBe(true);
    });
  });

  describe('deleteRecurringTransaction', () => {
    it('deletes the recurring transaction when it belongs to the space', async () => {
      const { service, prisma } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi.fn().mockResolvedValue({ id: 'r1', spaceId: 's1' }),
            delete: vi.fn(),
          },
        },
      });

      await service.deleteRecurringTransaction('s1', 'r1');

      expect(prisma.recurringTransaction.delete).toHaveBeenCalledWith({
        where: { id: 'r1' },
      });
    });

    it('throws RECURRING_NOT_FOUND when the recurring transaction belongs to a different space', async () => {
      const { service } = buildService({
        prisma: {
          recurringTransaction: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 'r1', spaceId: 'other' }),
          },
        },
      });

      try {
        await service.deleteRecurringTransaction('s1', 'r1');
        throw new Error('expected rejection');
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });
});
