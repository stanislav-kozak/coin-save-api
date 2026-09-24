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
});
