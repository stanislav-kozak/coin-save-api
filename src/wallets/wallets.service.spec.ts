import { HttpStatus } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { WalletsService } from './wallets.service';
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
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    expense: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const $queryRaw = vi.fn().mockResolvedValue([{ id: 'w1' }]);
  const getRate = overrides.getRate ?? vi.fn();
  const service = new WalletsService(
    Object.assign(prisma, { $queryRaw }) as never,
    { getRate } as never,
  );
  return { service, prisma, $queryRaw, getRate };
}

const baseWallet = {
  id: 'w1',
  spaceId: 's1',
  name: 'Cash',
  currency: 'UAH',
  icon: null,
  color: null,
  initialBalance: new Prisma.Decimal(1000),
  archived: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('WalletsService', () => {
  it('creates a wallet with balance equal to initialBalance when there are no expenses yet', async () => {
    const { service, prisma } = buildService({
      prisma: { wallet: { create: vi.fn().mockResolvedValue(baseWallet) } },
    });

    const result = await service.createWallet('s1', {
      name: 'Cash',
      currency: 'UAH',
      initialBalance: 1000,
    });

    expect(prisma.wallet.create).toHaveBeenCalledWith({
      data: {
        spaceId: 's1',
        name: 'Cash',
        currency: 'UAH',
        icon: undefined,
        color: undefined,
        initialBalance: 1000,
      },
    });
    expect(result.balance.toNumber()).toBe(1000);
  });

  it('computes balance as initialBalance + income - expense', async () => {
    const { service } = buildService({
      prisma: {
        wallet: { findUnique: vi.fn().mockResolvedValue(baseWallet) },
        expense: {
          groupBy: vi.fn().mockResolvedValue([
            {
              walletId: 'w1',
              type: TransactionType.INCOME,
              _sum: { amount: new Prisma.Decimal(200) },
            },
            {
              walletId: 'w1',
              type: TransactionType.EXPENSE,
              _sum: { amount: new Prisma.Decimal(150) },
            },
          ]),
        },
      },
    });

    const result = await service.getWallet('s1', 'w1');

    expect(result.balance.toNumber()).toBe(1050);
  });

  it('rejects getWallet when the wallet belongs to a different space', async () => {
    const { service } = buildService({
      prisma: {
        wallet: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ ...baseWallet, spaceId: 'other-space' }),
        },
      },
    });

    try {
      await service.getWallet('s1', 'w1');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('rejects getWallet when the wallet does not exist', async () => {
    const { service } = buildService({
      prisma: { wallet: { findUnique: vi.fn().mockResolvedValue(null) } },
    });

    try {
      await service.getWallet('s1', 'missing');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('listWallets excludes archived wallets by default', async () => {
    const { service, prisma } = buildService({
      prisma: { wallet: { findMany: vi.fn().mockResolvedValue([baseWallet]) } },
    });

    await service.listWallets('s1', false);

    expect(prisma.wallet.findMany).toHaveBeenCalledWith({
      where: { spaceId: 's1', archived: false },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('archiveWallet sets archived to true', async () => {
    const { service, prisma } = buildService({
      prisma: {
        wallet: {
          findUnique: vi.fn().mockResolvedValue(baseWallet),
          update: vi.fn().mockResolvedValue({ ...baseWallet, archived: true }),
        },
      },
    });

    const result = await service.archiveWallet('s1', 'w1');

    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { archived: true },
    });
    expect(result.archived).toBe(true);
  });

  describe('updateWallet currency change', () => {
    const usdWallet = {
      id: 'w1',
      spaceId: 's1',
      currency: 'USD',
      archived: false,
    };

    it('rejects currency together with initialBalance before touching rates', async () => {
      const { service, getRate, $queryRaw } = buildService({
        prisma: {
          wallet: { findUnique: vi.fn().mockResolvedValue(usdWallet) },
        },
      });

      await expect(
        service.updateWallet('s1', 'w1', {
          currency: 'PLN',
          initialBalance: 5,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(getRate).not.toHaveBeenCalled();
      expect($queryRaw).not.toHaveBeenCalled();
    });

    it('rejects a currency change on an archived wallet', async () => {
      const { service, $queryRaw } = buildService({
        prisma: {
          wallet: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ ...usdWallet, archived: true }),
          },
        },
      });

      await expect(
        service.updateWallet('s1', 'w1', { currency: 'PLN' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'WALLET_ARCHIVED',
        }) as unknown,
      });
      expect($queryRaw).not.toHaveBeenCalled();
    });

    it('changes nothing when the rate cannot be obtained', async () => {
      const unavailable = new Error('rate unavailable');
      const { service, $queryRaw } = buildService({
        getRate: vi.fn().mockRejectedValue(unavailable),
        prisma: {
          wallet: { findUnique: vi.fn().mockResolvedValue(usdWallet) },
        },
      });

      await expect(
        service.updateWallet('s1', 'w1', { currency: 'PLN' }),
      ).rejects.toBe(unavailable);
      expect($queryRaw).not.toHaveBeenCalled();
    });

    it('uses one rate for today and a single statement, then returns the wallet', async () => {
      const getRate = vi.fn().mockResolvedValue(new Prisma.Decimal('3.9'));
      const { service, $queryRaw } = buildService({
        getRate,
        prisma: {
          wallet: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ ...baseWallet, currency: 'USD' })
              .mockResolvedValueOnce({ ...baseWallet, currency: 'PLN' }),
          },
        },
      });

      const result = await service.updateWallet('s1', 'w1', {
        currency: 'PLN',
      });

      expect(getRate).toHaveBeenCalledTimes(1);
      expect(getRate).toHaveBeenCalledWith('USD', 'PLN', expect.any(Date));
      expect($queryRaw).toHaveBeenCalledTimes(1);
      expect(result.currency).toBe('PLN');
    });
  });
});
