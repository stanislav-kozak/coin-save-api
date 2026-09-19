import { HttpStatus } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import type { Mock } from 'vitest';
import { SpacesService } from './spaces.service';
import { AppException } from '../common/exceptions/app.exception';

type PrismaMock = Record<string, Record<string, Mock>>;

function buildService(
  overrides: {
    prisma?: Record<string, unknown>;
    mail?: Record<string, unknown>;
    config?: Record<string, unknown>;
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
    category: { createMany: vi.fn() },
    user: { findUnique: vi.fn() },
  } as PrismaMock;
  const overridesPrisma = (overrides.prisma ?? {}) as PrismaMock;
  // Merge per-table so an override like `{ membership: { count } }` only replaces the
  // named methods on that table instead of wiping out the rest of its default mocks
  // (e.g. `delete`), which a plain top-level `...overrides.prisma` spread would do.
  const prisma: PrismaMock = Object.fromEntries(
    Object.keys(basePrisma).map((table) => [
      table,
      { ...basePrisma[table], ...(overridesPrisma[table] ?? {}) },
    ]),
  );
  const mail = {
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides.mail,
  };
  const config = {
    get: vi.fn().mockReturnValue('http://localhost:3001'),
    ...overrides.config,
  };
  const service = new SpacesService(
    prisma as never,
    mail as never,
    config as never,
  );
  return { service, prisma, mail, config };
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
          findUnique: vi
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
      await service.inviteMember('s1', 'u1', 'existing@b.com');
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
});
