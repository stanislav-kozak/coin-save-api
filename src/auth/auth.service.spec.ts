import { HttpStatus } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AppException } from '../common/exceptions/app.exception';

function buildService(
  overrides: {
    users?: Record<string, unknown>;
    prisma?: Record<string, unknown>;
    mail?: Record<string, unknown>;
    tokens?: Record<string, unknown>;
    config?: Record<string, unknown>;
  } = {},
) {
  const users = { findByEmail: vi.fn(), createLocal: vi.fn(), ...overrides.users };
  const prisma = {
    emailVerificationToken: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    ...overrides.prisma,
  };
  const mail = { send: vi.fn(), ...overrides.mail };
  const tokens = {
    signAccessToken: vi.fn(),
    issueRefreshToken: vi.fn(),
    rotateRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    ...overrides.tokens,
  };
  const config = { get: vi.fn().mockReturnValue('http://localhost:3001'), ...overrides.config };
  const service = new AuthService(users as never, prisma as never, mail as never, tokens as never, config as never);
  return { service, users, prisma, mail, tokens, config };
}

describe('AuthService', () => {
  it('rejects signup when the email is already registered', async () => {
    const { service, users } = buildService({
      users: { findByEmail: vi.fn().mockResolvedValue({ id: 'u1' }) },
    });

    try {
      await service.signup('a@b.com', 'password123');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
    }
    expect(users.findByEmail).toHaveBeenCalledWith('a@b.com');
  });

  it('creates the user and sends a verification email on signup', async () => {
    const created = { id: 'u1', email: 'a@b.com', locale: 'uk' };
    const { service, users, mail, prisma } = buildService({
      users: { findByEmail: vi.fn().mockResolvedValue(null), createLocal: vi.fn().mockResolvedValue(created) },
    });

    await service.signup('a@b.com', 'password123');

    expect(users.createLocal).toHaveBeenCalledWith('a@b.com', expect.any(String));
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledWith(
      'a@b.com',
      'uk',
      'verify-email',
      expect.any(String),
      expect.objectContaining({ verifyUrl: expect.stringContaining('/verify-email?token=') }),
    );
  });

  it('rejects login with a wrong password', async () => {
    const passwordHash = await argon2.hash('correct-password');
    const { service } = buildService({
      users: {
        findByEmail: vi
          .fn()
          .mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash, emailVerified: new Date() }),
      },
    });

    try {
      await service.validateLocalUser('a@b.com', 'wrong-password');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    }
  });

  it('rejects login when the email is not verified', async () => {
    const passwordHash = await argon2.hash('correct-password');
    const { service } = buildService({
      users: {
        findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash, emailVerified: null }),
      },
    });

    try {
      await service.validateLocalUser('a@b.com', 'correct-password');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });

  it('accepts login with correct credentials for a verified user', async () => {
    const passwordHash = await argon2.hash('correct-password');
    const { service } = buildService({
      users: {
        findByEmail: vi
          .fn()
          .mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash, emailVerified: new Date() }),
      },
    });

    const result = await service.validateLocalUser('a@b.com', 'correct-password');

    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });
});
