import { HttpStatus } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { TransfersService } from './transfers.service';
import { transactionInclude } from '../expenses/transaction-response';
import { AppException } from '../common/exceptions/app.exception';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

const wallets: Record<string, object> = {
  usd: { id: 'usd', spaceId: 's1', currency: 'USD', archived: false },
  usd2: { id: 'usd2', spaceId: 's1', currency: 'USD', archived: false },
  uah: { id: 'uah', spaceId: 's1', currency: 'UAH', archived: false },
  old: { id: 'old', spaceId: 's1', currency: 'USD', archived: true },
  foreign: {
    id: 'foreign',
    spaceId: 'other',
    currency: 'USD',
    archived: false,
  },
};

// Rates to the space currency (EUR) and between wallets: 1 USD = 0.9 EUR,
// 1 USD = 41 UAH.
const RATES: Record<string, string> = {
  'USD>EUR': '0.9',
  'UAH>EUR': '0.022',
  'USD>UAH': '41',
  'UAH>USD': '0.0244',
};

function buildService(
  overrides: {
    prisma?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
  } = {},
) {
  const basePrisma = {
    wallet: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(wallets[where.id] ?? null),
      ),
    },
    space: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
    },
    expense: {
      create: vi.fn().mockResolvedValue({ id: 't1', toWallet: null }),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 't1', toWallet: null }),
      delete: vi.fn(),
    },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const getRate = vi.fn((from: string, to: string) =>
    Promise.resolve(new Prisma.Decimal(RATES[`${from}>${to}`] ?? '1')),
  );
  const service = new TransfersService(prisma as never, { getRate } as never);
  return { service, prisma, getRate };
}

const createInput = {
  fromWalletId: 'usd',
  toWalletId: 'uah',
  amount: 100,
  occurredAt: '2026-06-10T00:00:00.000Z',
};

async function expectCode(
  promise: Promise<unknown>,
  status: HttpStatus,
  code: string,
) {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (error) {
    expect((error as AppException).getStatus()).toBe(status);
    expect((error as AppException).getResponse()).toMatchObject({ code });
  }
}

describe('TransfersService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createTransfer', () => {
    it('stores one TRANSFER row: source side, converted destination side, amountInPrimary', async () => {
      const { service, prisma } = buildService();

      await service.createTransfer('s1', 'u1', { ...createInput, note: 'x' });

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: {
          spaceId: 's1',
          walletId: 'usd',
          type: TransactionType.TRANSFER,
          amount: 100,
          walletCurrency: 'USD',
          amountInPrimary: new Prisma.Decimal(90),
          fxRate: new Prisma.Decimal('0.9'),
          toWalletId: 'uah',
          toAmount: new Prisma.Decimal(4100),
          toWalletCurrency: 'UAH',
          note: 'x',
          occurredAt: new Date('2026-06-10T00:00:00.000Z'),
          createdById: 'u1',
        },
        include: transactionInclude,
      });
    });

    it('keeps a received amount entered by hand for wallets in different currencies', async () => {
      const { service, prisma } = buildService();

      await service.createTransfer('s1', 'u1', {
        ...createInput,
        toAmount: 4000,
      });

      const { data } = prisma.expense.create.mock.calls[0][0];
      expect(data.toAmount).toEqual(new Prisma.Decimal(4000));
    });

    it('receives exactly the amount sent between wallets in the same currency', async () => {
      const { service, prisma, getRate } = buildService();

      await service.createTransfer('s1', 'u1', {
        ...createInput,
        toWalletId: 'usd2',
      });

      const { data } = prisma.expense.create.mock.calls[0][0];
      expect(data.toAmount).toEqual(new Prisma.Decimal(100));
      expect(getRate).not.toHaveBeenCalledWith('USD', 'USD', expect.anything());
    });

    it('rejects a different toAmount between wallets in the same currency', async () => {
      const { service, prisma } = buildService();

      await expectCode(
        service.createTransfer('s1', 'u1', {
          ...createInput,
          toWalletId: 'usd2',
          toAmount: 99,
        }),
        HttpStatus.BAD_REQUEST,
        'TRANSFER_AMOUNT_MISMATCH',
      );
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('rejects a transfer to the same wallet', async () => {
      const { service } = buildService();

      await expectCode(
        service.createTransfer('s1', 'u1', {
          ...createInput,
          toWalletId: 'usd',
        }),
        HttpStatus.BAD_REQUEST,
        'TRANSFER_SAME_WALLET',
      );
    });

    it.each([
      ['an archived wallet', 'old', HttpStatus.CONFLICT, 'WALLET_ARCHIVED'],
      ['another space', 'foreign', HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND'],
      ['a missing wallet', 'missing', HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND'],
    ])('rejects a destination in %s', async (_, toWalletId, status, code) => {
      const { service } = buildService();

      await expectCode(
        service.createTransfer('s1', 'u1', { ...createInput, toWalletId }),
        status,
        code,
      );
    });

    it('rejects an occurredAt in the future', async () => {
      const { service } = buildService();

      await expectCode(
        service.createTransfer('s1', 'u1', {
          ...createInput,
          occurredAt: '2026-06-16T00:00:00.000Z',
        }),
        HttpStatus.BAD_REQUEST,
        'INVALID_OCCURRED_AT',
      );
    });
  });

  describe('updateTransfer', () => {
    const existing = {
      id: 't1',
      spaceId: 's1',
      type: TransactionType.TRANSFER,
      walletId: 'usd',
      walletCurrency: 'USD',
      amount: new Prisma.Decimal(100),
      amountInPrimary: new Prisma.Decimal(90),
      fxRate: new Prisma.Decimal('0.9'),
      toWalletId: 'uah',
      toAmount: new Prisma.Decimal(4000),
      toWalletCurrency: 'UAH',
      occurredAt: new Date('2026-06-10T00:00:00.000Z'),
    };

    function withExisting(row: object = existing) {
      return buildService({
        prisma: { expense: { findUnique: vi.fn().mockResolvedValue(row) } },
      });
    }

    it('keeps a hand-entered toAmount when only the note or date changes', async () => {
      const { service, prisma } = withExisting();

      await service.updateTransfer('s1', 't1', {
        note: 'rent',
        occurredAt: '2026-06-12T00:00:00.000Z',
      });

      const { data } = prisma.expense.update.mock.calls[0][0];
      expect(data.toAmount).toBeUndefined();
      expect(data.note).toBe('rent');
      // The source side follows the new date's rate.
      expect(data.amountInPrimary).toEqual(new Prisma.Decimal(90));
    });

    it('converts the received amount again when the amount changes', async () => {
      const { service, prisma } = withExisting();

      await service.updateTransfer('s1', 't1', { amount: 10 });

      const { data } = prisma.expense.update.mock.calls[0][0];
      expect(data.amount).toBe(10);
      expect(data.amountInPrimary).toEqual(new Prisma.Decimal(9));
      expect(data.toAmount).toEqual(new Prisma.Decimal(410));
    });

    it('re-derives currencies and the received amount when the destination wallet changes', async () => {
      const { service, prisma } = withExisting();

      await service.updateTransfer('s1', 't1', { toWalletId: 'usd2' });

      const { data } = prisma.expense.update.mock.calls[0][0];
      expect(data.toWalletId).toBe('usd2');
      expect(data.toWalletCurrency).toBe('USD');
      expect(data.toAmount).toEqual(new Prisma.Decimal(100));
    });

    it('rejects making both sides the same wallet', async () => {
      const { service } = withExisting();

      await expectCode(
        service.updateTransfer('s1', 't1', { toWalletId: 'usd' }),
        HttpStatus.BAD_REQUEST,
        'TRANSFER_SAME_WALLET',
      );
    });

    it.each([
      ['does not exist', null],
      ['is a regular expense', { ...existing, type: TransactionType.EXPENSE }],
      ['belongs to another space', { ...existing, spaceId: 'other' }],
    ])('throws TRANSFER_NOT_FOUND when it %s', async (_, row) => {
      const { service } = withExisting(row as object);

      await expectCode(
        service.updateTransfer('s1', 't1', { note: 'x' }),
        HttpStatus.NOT_FOUND,
        'TRANSFER_NOT_FOUND',
      );
    });
  });

  describe('deleteTransfer', () => {
    it('deletes a transfer of the space', async () => {
      const { service, prisma } = buildService({
        prisma: {
          expense: {
            findUnique: vi.fn().mockResolvedValue({
              id: 't1',
              spaceId: 's1',
              type: TransactionType.TRANSFER,
            }),
          },
        },
      });

      await service.deleteTransfer('s1', 't1');

      expect(prisma.expense.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
    });
  });
});
