import * as argon2 from 'argon2';
import { TokenService } from './token.service';
import { AppException } from '../common/exceptions/app.exception';

describe('TokenService', () => {
  it('issues a refresh token and stores its argon2 hash', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const prisma = { refreshToken: { create } };
    const jwtService = { sign: vi.fn() };
    const service = new TokenService(jwtService as never, prisma as never);

    const token = await service.issueRefreshToken('u1', {
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const createCall = create.mock.calls[0][0] as {
      data: { userId: string; tokenHash: string };
    };
    expect(createCall.data.userId).toBe('u1');
    expect(await argon2.verify(createCall.data.tokenHash, token)).toBe(true);
  });

  it('rotates a valid refresh token: revokes the old one and issues a new one', async () => {
    const rawToken = 'a'.repeat(64);
    const tokenHash = await argon2.hash(rawToken);
    const stored = { id: 'rt1', userId: 'u1', tokenHash, revokedAt: null };

    const findMany = vi.fn().mockResolvedValue([stored]);
    const update = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const prisma = { refreshToken: { findMany, update, create } };
    const jwtService = { sign: vi.fn() };
    const service = new TokenService(jwtService as never, prisma as never);

    const result = await service.rotateRefreshToken(rawToken, {});

    expect(result.userId).toBe('u1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('revokes all sessions when a revoked refresh token is presented again', async () => {
    const rawToken = 'b'.repeat(64);
    const tokenHash = await argon2.hash(rawToken);
    const stored = {
      id: 'rt1',
      userId: 'u1',
      tokenHash,
      revokedAt: new Date(),
    };

    const findMany = vi.fn().mockResolvedValue([stored]);
    const updateMany = vi.fn().mockResolvedValue(undefined);
    const prisma = { refreshToken: { findMany, updateMany } };
    const jwtService = { sign: vi.fn() };
    const service = new TokenService(jwtService as never, prisma as never);

    await expect(service.rotateRefreshToken(rawToken, {})).rejects.toThrow(
      AppException,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
