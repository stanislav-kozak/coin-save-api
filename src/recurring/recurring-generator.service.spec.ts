import { Logger } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { RecurringGeneratorService } from './recurring-generator.service';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

// The generator opens a `prisma.$transaction(callback)` and does all its
// writes against the `tx` client the callback receives — NOT the outer
// `prisma` client. So this mock needs two separate client objects: the
// outer `prisma` (only used for the pre-transaction `findMany` in
// `generateAll` and for opening `$transaction`/`$executeRaw`), and the
// inner `tx` client (used for everything inside the locked transaction).
// `buildPrismaMock` only covers the per-table method shape (`PrismaMock`),
// so `$transaction`/`$executeRaw` — top-level client methods, not
// per-table ones — are added by hand alongside it.

function buildTxClient(
  overrides: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }> = {},
) {
  const tables = buildPrismaMock(
    {
      recurringTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      space: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
      },
      expense: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: 'w1', archived: false }),
      },
      category: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', archived: false }),
      },
    },
    overrides,
  );
  // `buildPrismaMock` only covers the per-table method shape (`PrismaMock`),
  // so `$executeRaw` — a top-level client method, not a per-table one — is
  // added by hand alongside it.
  return {
    ...tables,
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  };
}

function buildService(
  overrides: {
    findManyResult?: { id: string }[];
    tx?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
    getRate?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const txClient = buildTxClient(overrides.tx);
  const prisma = {
    recurringTransaction: {
      findMany: vi.fn().mockResolvedValue(overrides.findManyResult ?? []),
    },
    $transaction: vi
      .fn()
      .mockImplementation((callback: (tx: typeof txClient) => Promise<void>) =>
        callback(txClient),
      ),
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  };
  const getRate =
    overrides.getRate ?? vi.fn().mockResolvedValue(new Prisma.Decimal('1'));
  const currencyService = { getRate } as never;
  const service = new RecurringGeneratorService(
    prisma as never,
    currencyService,
  );
  return { service, prisma, txClient, getRate };
}

const baseRecurring = {
  id: 'r1',
  spaceId: 's1',
  walletId: 'w1',
  categoryId: 'c1',
  type: TransactionType.EXPENSE,
  amount: new Prisma.Decimal(15.99),
  currency: 'EUR',
  name: 'Netflix',
  note: null,
  dayOfMonth: 5,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: null,
  lastGeneratedAt: new Date('2026-01-05T00:00:00.000Z'),
  active: true,
  createdById: 'u1',
};

describe('RecurringGeneratorService', () => {
  describe('generateForRecurring', () => {
    it('acquires a per-recurring advisory lock before reading the recurring transaction', async () => {
      const { service, prisma, txClient } = buildService();
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
      });

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);

      const lockOrder = txClient.$executeRaw.mock.invocationCallOrder[0];
      const readOrder =
        txClient.recurringTransaction.findUnique.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(readOrder);
    });

    it('creates a new Expense for each candidate due date not already materialized', async () => {
      const { service, txClient, getRate } = buildService();
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
      });
      getRate.mockResolvedValue(new Prisma.Decimal('1.1'));

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(txClient.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          spaceId: 's1',
          walletId: 'w1',
          categoryId: 'c1',
          type: TransactionType.EXPENSE,
          walletCurrency: 'EUR',
          occurredAt: new Date('2026-02-05T00:00:00.000Z'),
          recurringId: 'r1',
          createdById: 'u1',
        }),
      });
      const createdData = txClient.expense.create.mock.calls[0][0].data;
      expect((createdData.fxRate as Prisma.Decimal).toNumber()).toBe(1.1);
      expect(
        (createdData.amountInPrimary as Prisma.Decimal).toNumber(),
      ).toBeCloseTo(15.99 * 1.1, 6);
    });

    it('skips creating an Expense that already exists, but still advances lastGeneratedAt past it', async () => {
      const { service, txClient } = buildService();
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
      });
      txClient.expense.findFirst.mockResolvedValue({ id: 'existing' });

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(txClient.expense.create).not.toHaveBeenCalled();
      expect(txClient.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { lastGeneratedAt: new Date('2026-02-05T00:00:00.000Z') },
      });
    });

    it('updates lastGeneratedAt to the maximum generated date across multiple months', async () => {
      const { service, txClient } = buildService();
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
        dayOfMonth: 1,
      });

      await service.generateForRecurring(
        'r1',
        new Date('2026-05-15T00:00:00.000Z'),
      );

      expect(txClient.recurringTransaction.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { lastGeneratedAt: new Date('2026-05-01T00:00:00.000Z') },
      });
    });

    it('does nothing when the recurring transaction is inactive', async () => {
      const { service, txClient } = buildService();
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
        active: false,
      });

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(txClient.expense.create).not.toHaveBeenCalled();
      expect(txClient.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('does nothing when there are no candidate due dates', async () => {
      const { service, txClient } = buildService();
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
        lastGeneratedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(txClient.expense.create).not.toHaveBeenCalled();
      expect(txClient.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('skips generation when the wallet is archived', async () => {
      const { service, txClient } = buildService({
        tx: {
          wallet: {
            findUnique: vi.fn().mockResolvedValue({ id: 'w1', archived: true }),
          },
        },
      });
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
      });

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(txClient.expense.create).not.toHaveBeenCalled();
      expect(txClient.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('skips generation when the category is archived', async () => {
      const { service, txClient } = buildService({
        tx: {
          category: {
            findUnique: vi.fn().mockResolvedValue({ id: 'c1', archived: true }),
          },
        },
      });
      txClient.recurringTransaction.findUnique.mockResolvedValue({
        ...baseRecurring,
      });

      await service.generateForRecurring(
        'r1',
        new Date('2026-02-10T00:00:00.000Z'),
      );

      expect(txClient.expense.create).not.toHaveBeenCalled();
      expect(txClient.recurringTransaction.update).not.toHaveBeenCalled();
    });
  });

  describe('generateAll', () => {
    it('calls generateForRecurring for each active due recurring transaction', async () => {
      const { service, prisma, txClient } = buildService({
        findManyResult: [{ id: 'r1' }, { id: 'r2' }],
      });
      txClient.recurringTransaction.findUnique.mockResolvedValue(null);

      await service.generateAll();

      expect(prisma.recurringTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('logs and continues when one recurring transaction fails to generate', async () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { service, prisma } = buildService({
        findManyResult: [{ id: 'r1' }, { id: 'r2' }],
      });
      prisma.$transaction
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);

      await expect(service.generateAll()).resolves.toBeUndefined();

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
