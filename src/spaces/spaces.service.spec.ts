import { HttpStatus } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { SpacesService } from './spaces.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

function buildService(
  overrides: {
    prisma?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
    mail?: Record<string, unknown>;
    config?: Record<string, unknown>;
    currency?: Record<string, unknown>;
  } = {},
) {
  const basePrisma = {
    space: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      delete: vi.fn(),
    },
    membership: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    invitation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    category: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    expense: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const mail = {
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides.mail,
  };
  const config = {
    get: vi.fn().mockReturnValue('http://localhost:3001'),
    ...overrides.config,
  };
  const currency = {
    getRate: vi.fn(),
    getRates: vi.fn(),
    ...overrides.currency,
  };
  // Batch transaction: resolves the queued operations in order.
  const $transaction = vi.fn((ops: Promise<unknown>[]) => Promise.all(ops));
  const $executeRaw = vi.fn().mockResolvedValue(1);
  const $queryRaw = vi.fn();
  const service = new SpacesService(
    Object.assign(prisma, { $transaction, $executeRaw, $queryRaw }) as never,
    mail as never,
    config as never,
    currency as never,
  );
  return {
    service,
    prisma,
    mail,
    config,
    currency,
    $transaction,
    $executeRaw,
    $queryRaw,
  };
}

describe('SpacesService', () => {
  it('creates a space with an OWNER membership and seeds six default categories', async () => {
    const { service, prisma } = buildService({
      prisma: {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'u1', locale: 'uk' }),
        },
        space: {
          create: vi.fn().mockResolvedValue({
            id: 's1',
            name: 'Family',
            slug: 'family-abc123',
            primaryCurrency: 'UAH',
          }),
          findUnique: vi.fn().mockResolvedValue(null),
        },
        category: { createMany: vi.fn().mockResolvedValue({ count: 6 }) },
      },
    });

    const space = await service.createSpace('u1', 'Family');

    expect(space.id).toBe('s1');
    expect(prisma.space.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Family',
          ownerId: 'u1',
          memberships: { create: { userId: 'u1', role: Role.OWNER } },
        }),
      }),
    );
    const createManyCall = prisma.category.createMany.mock.calls[0][0] as {
      data: { spaceId: string }[];
    };
    expect(createManyCall.data).toHaveLength(6);
    expect(createManyCall.data[0].spaceId).toBe('s1');
  });

  it('rejects inviting an email that already belongs to a member', async () => {
    const { service } = buildService({
      prisma: {
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'u2', email: 'existing@b.com' }),
        },
        membership: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'm1',
            userId: 'u2',
            spaceId: 's1',
            role: Role.MEMBER,
          }),
        },
      },
    });

    try {
      await service.inviteMember('s1', 'u1', 'Existing@B.com');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
    }
  });

  it('rejects removing the last owner of a space', async () => {
    const { service, prisma } = buildService({
      prisma: {
        membership: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'm1',
            spaceId: 's1',
            userId: 'u1',
            role: Role.OWNER,
          }),
          count: vi.fn().mockResolvedValue(1),
        },
      },
    });

    try {
      await service.removeMember('s1', 'm1');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });

  it('rejects the last owner leaving the space', async () => {
    const { service, prisma } = buildService({
      prisma: { membership: { count: vi.fn().mockResolvedValue(1) } },
    });
    const ownerMembership = {
      id: 'm1',
      spaceId: 's1',
      userId: 'u1',
      role: Role.OWNER,
    } as never;

    try {
      await service.leaveSpace('s1', ownerMembership);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });

  it('stores the invitee email lowercased and replaces pending invites case-insensitively', async () => {
    const { service, prisma } = buildService({
      prisma: {
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        space: {
          findUnique: vi.fn().mockResolvedValue({ id: 's1', name: 'Family' }),
        },
      },
    });

    await service.inviteMember('s1', 'u1', ' New.Member@B.com ');

    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
      where: {
        spaceId: 's1',
        email: { equals: 'new.member@b.com', mode: 'insensitive' },
        acceptedAt: null,
      },
    });
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'new.member@b.com' }) as unknown,
    });
  });

  it('rejects accepting an invitation with an invalid token', async () => {
    const { service } = buildService({
      prisma: { invitation: { findMany: vi.fn().mockResolvedValue([]) } },
    });

    try {
      await service.acceptInvitation('u1', 'a@b.com', 'bogus-token');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }
  });

  it('accepts a valid invitation and creates a membership', async () => {
    const rawToken = 'c'.repeat(64);
    const tokenHash = await argon2.hash(rawToken);
    const invitation = {
      id: 'inv1',
      spaceId: 's1',
      email: 'a@b.com',
      tokenHash,
      role: Role.MEMBER,
      acceptedAt: null,
    };
    const createdMembership = {
      id: 'm2',
      userId: 'u1',
      spaceId: 's1',
      role: Role.MEMBER,
    };

    const { service, prisma } = buildService({
      prisma: {
        invitation: {
          findMany: vi.fn().mockResolvedValue([invitation]),
          update: vi
            .fn()
            .mockResolvedValue({ ...invitation, acceptedAt: new Date() }),
        },
        membership: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(createdMembership),
        },
      },
    });

    const result = await service.acceptInvitation('u1', 'a@b.com', rawToken);

    expect(result).toBe(createdMembership);
    expect(prisma.membership.create).toHaveBeenCalledWith({
      data: { userId: 'u1', spaceId: 's1', role: Role.MEMBER },
    });
    expect(prisma.invitation.update).toHaveBeenCalledWith({
      where: { id: 'inv1' },
      data: { acceptedAt: expect.any(Date) },
    });
  });

  describe('updateSpace primary currency', () => {
    const D = (n: number | string) => new Prisma.Decimal(n);

    it('recomputes every transaction at its historical rate and converts limits', async () => {
      const expenses = [
        {
          id: 'e1',
          amount: D(100),
          walletCurrency: 'USD',
          occurredAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: 'e2',
          amount: D(50),
          walletCurrency: 'UAH',
          occurredAt: new Date('2026-06-01T12:00:00Z'),
        },
      ];
      const getRates = vi.fn().mockResolvedValue([D(41.5), D(1), D('48.7341')]);
      const { service, $transaction, $queryRaw } = buildService({
        currency: { getRates },
        prisma: {
          space: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
          },
          expense: { findMany: vi.fn().mockResolvedValue(expenses) },
          category: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'c1', monthlyLimit: D(100) },
              { id: 'c2', monthlyLimit: D('0.01') },
            ]),
          },
        },
      });
      $queryRaw.mockResolvedValue([{ id: 's1', primaryCurrency: 'UAH' }]);

      const result = await service.updateSpace('s1', {
        primaryCurrency: 'UAH',
      });

      expect(result).toEqual({ id: 's1', primaryCurrency: 'UAH' });
      // One batched lookup: each transaction at its own date, limits today.
      expect(getRates).toHaveBeenCalledTimes(1);
      expect(getRates).toHaveBeenCalledWith([
        { from: 'USD', to: 'UAH', date: expenses[0].occurredAt },
        { from: 'UAH', to: 'UAH', date: expenses[1].occurredAt },
        { from: 'EUR', to: 'UAH', date: expect.any(Date) as Date },
      ]);

      // Everything is written by a single statement (atomic, one round
      // trip): (id, rate) pairs for expenses, then limits — 100 EUR *
      // 48.7341 = 4873.41 -> 4873; a tiny limit never becomes 0 — then the
      // space itself (new currency, unchanged name, id).
      expect($queryRaw).toHaveBeenCalledTimes(1);
      const statement = $queryRaw.mock.calls[0] as unknown[];
      const values = statement
        .slice(1)
        .flatMap((part) =>
          part && typeof part === 'object' && 'values' in part
            ? (part as { values: unknown[] }).values
            : [part],
        );
      expect(values).toEqual([
        'e1',
        '41.5',
        'e2',
        '1',
        'c1',
        '4873',
        'c2',
        '1',
        'UAH',
        null,
        's1',
      ]);
      expect($transaction).not.toHaveBeenCalled();
    });

    it('falls back to chunked updates in a transaction for huge spaces', async () => {
      const many = Array.from({ length: 30_001 }, (_, i) => ({
        id: `e${i}`,
        amount: D(1),
        walletCurrency: 'USD',
        occurredAt: new Date('2026-06-01T10:00:00Z'),
      }));
      const { service, prisma, $transaction, $executeRaw, $queryRaw } =
        buildService({
          currency: {
            getRates: vi.fn().mockResolvedValue(many.map(() => D(2))),
          },
          prisma: {
            space: {
              findUnique: vi
                .fn()
                .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
              update: vi
                .fn()
                .mockResolvedValue({ id: 's1', primaryCurrency: 'UAH' }),
            },
            expense: { findMany: vi.fn().mockResolvedValue(many) },
            category: { findMany: vi.fn().mockResolvedValue([]) },
          },
        });

      const result = await service.updateSpace('s1', {
        primaryCurrency: 'UAH',
      });

      expect(result).toEqual({ id: 's1', primaryCurrency: 'UAH' });
      expect($queryRaw).not.toHaveBeenCalled();
      expect($executeRaw).toHaveBeenCalledTimes(4); // 10k-row chunks
      expect($transaction).toHaveBeenCalledTimes(1);
      expect(prisma.space.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { primaryCurrency: 'UAH' },
      });
    });

    it('just updates the space when the currency is not changing', async () => {
      const { service, prisma, currency, $transaction } = buildService({
        prisma: {
          space: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
            update: vi.fn().mockResolvedValue({ id: 's1', name: 'Home' }),
          },
        },
      });

      await service.updateSpace('s1', { name: 'Home', primaryCurrency: 'EUR' });

      expect(currency.getRates).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
      expect(prisma.space.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { name: 'Home', primaryCurrency: 'EUR' },
      });
    });

    it('changes nothing when a rate cannot be obtained', async () => {
      const unavailable = new AppException(
        ERROR_CODES.CURRENCY_API_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Exchange rate unavailable',
      );
      const { service, prisma, $transaction, $executeRaw, $queryRaw } =
        buildService({
          currency: { getRates: vi.fn().mockRejectedValue(unavailable) },
          prisma: {
            space: {
              findUnique: vi
                .fn()
                .mockResolvedValue({ id: 's1', primaryCurrency: 'EUR' }),
            },
            expense: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: 'e1',
                  amount: D(100),
                  walletCurrency: 'USD',
                  occurredAt: new Date('2026-06-01T10:00:00Z'),
                },
              ]),
            },
            category: { findMany: vi.fn().mockResolvedValue([]) },
          },
        });

      await expect(
        service.updateSpace('s1', { primaryCurrency: 'UAH' }),
      ).rejects.toBe(unavailable);
      expect($transaction).not.toHaveBeenCalled();
      expect($executeRaw).not.toHaveBeenCalled();
      expect($queryRaw).not.toHaveBeenCalled();
      expect(prisma.space.update).not.toHaveBeenCalled();
    });
  });
});
