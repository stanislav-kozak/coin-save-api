import * as argon2 from 'argon2';
import { TokenService } from './token.service';
import { AppException } from '../common/exceptions/app.exception';

describe('TokenService', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function buildService(refreshToken: Record<string, unknown>) {
    const prisma = { refreshToken };
    const service = new TokenService(
      { sign: vi.fn() } as never,
      prisma as never,
    );
    return { service, prisma };
  }

  async function storedToken(
    secret: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: 'rt1',
      userId: 'u1',
      tokenHash: await argon2.hash(secret),
      expiresAt: new Date(Date.now() + DAY_MS),
      revokedAt: null,
      replacedById: null,
      ...overrides,
    };
  }

  async function expectCode(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getResponse()).toMatchObject({ code });
    }
  }

  it('issues "<id>.<secret>" and stores the argon2 hash of the secret under that id', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const { service } = buildService({ create });

    const token = await service.issueRefreshToken('u1', {
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    expect(token).toMatch(/^[0-9a-f]{24}\.[0-9a-f]{64}$/);
    const [id, secret] = token.split('.');
    const { data } = create.mock.calls[0][0] as {
      data: { id: string; userId: string; tokenHash: string; expiresAt: Date };
    };
    expect(data.id).toBe(id);
    expect(data.userId).toBe('u1');
    expect(await argon2.verify(data.tokenHash, secret)).toBe(true);
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY_MS);
  });

  it('rotates a valid token found by id, without scanning other tokens', async () => {
    const stored = await storedToken('a'.repeat(64));
    const findUnique = vi.fn().mockResolvedValue(stored);
    const findMany = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const { service } = buildService({ findUnique, findMany, update, create });

    const result = await service.rotateRefreshToken(
      `rt1.${'a'.repeat(64)}`,
      {},
    );

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'rt1' } });
    expect(findMany).not.toHaveBeenCalled();
    expect(result.userId).toBe('u1');
    const newId = result.refreshToken.split('.')[0];
    expect(update).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: { revokedAt: expect.any(Date), replacedById: newId },
    });
  });

  it('rejects a token whose secret does not match the row', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue(await storedToken('a'.repeat(64)));
    const { service } = buildService({ findUnique });

    await expectCode(
      service.rotateRefreshToken(`rt1.${'b'.repeat(64)}`, {}),
      'INVALID_REFRESH_TOKEN',
    );
  });

  it('rejects an expired token', async () => {
    const findUnique = vi.fn().mockResolvedValue(
      await storedToken('a'.repeat(64), {
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    const { service } = buildService({ findUnique });

    await expectCode(
      service.rotateRefreshToken(`rt1.${'a'.repeat(64)}`, {}),
      'INVALID_REFRESH_TOKEN',
    );
  });

  it('still accepts a legacy token without an id by scanning', async () => {
    const legacy = 'c'.repeat(64);
    const stored = {
      ...(await storedToken('x')),
      tokenHash: await argon2.hash(legacy),
    };
    const findMany = vi.fn().mockResolvedValue([stored]);
    const update = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const { service } = buildService({ findMany, update, create });

    const result = await service.rotateRefreshToken(legacy, {});

    expect(result.userId).toBe('u1');
    expect(result.refreshToken).toContain('.');
  });

  it('issues a new token, without revoking anything, when a just-rotated token comes back within the grace window', async () => {
    const stored = await storedToken('a'.repeat(64), {
      revokedAt: new Date(Date.now() - 30_000),
      replacedById: 'rt2',
    });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ id: 'rt2', revokedAt: null });
    const create = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn();
    const { service } = buildService({ findUnique, create, updateMany });

    const result = await service.rotateRefreshToken(
      `rt1.${'a'.repeat(64)}`,
      {},
    );

    expect(result.userId).toBe('u1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a just-rotated token whose replacement was revoked since (logout, password reset)', async () => {
    const stored = await storedToken('a'.repeat(64), {
      revokedAt: new Date(Date.now() - 30_000),
      replacedById: 'rt2',
    });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ id: 'rt2', revokedAt: new Date() });
    const create = vi.fn();
    const { service } = buildService({ findUnique, create });

    await expectCode(
      service.rotateRefreshToken(`rt1.${'a'.repeat(64)}`, {}),
      'INVALID_REFRESH_TOKEN',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['rotated longer ago than the grace window', 2 * 60_000, 'rt2'],
    ['revoked by logout', 1000, null],
  ])(
    'revokes all sessions when a token %s is presented again',
    async (_, revokedAgoMs, replacedById) => {
      const stored = await storedToken('b'.repeat(64), {
        revokedAt: new Date(Date.now() - revokedAgoMs),
        replacedById,
      });
      const findUnique = vi.fn().mockResolvedValue(stored);
      const updateMany = vi.fn().mockResolvedValue(undefined);
      const { service } = buildService({ findUnique, updateMany });

      await expectCode(
        service.rotateRefreshToken(`rt1.${'b'.repeat(64)}`, {}),
        'REFRESH_TOKEN_REUSE_DETECTED',
      );
      expect(updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    },
  );

  it('revokes the presented token on logout', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue(await storedToken('a'.repeat(64)));
    const update = vi.fn().mockResolvedValue(undefined);
    const { service } = buildService({ findUnique, update });

    await service.revokeRefreshToken(`rt1.${'a'.repeat(64)}`);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes every active refresh token of a user', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = { refreshToken: { updateMany } };
    const service = new TokenService(
      { sign: vi.fn() } as never,
      prisma as never,
    );

    await service.revokeAllForUser('u1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
