import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import type { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { TokenService, type RequestMeta } from './token.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface GoogleProfileInput {
  email: string;
  name?: string;
  avatarUrl?: string;
  providerAccountId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  async signup(email: string, password: string): Promise<void> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new AppException(ERROR_CODES.EMAIL_ALREADY_EXISTS, HttpStatus.CONFLICT, 'Email already registered');
    }

    const passwordHash = await argon2.hash(password);
    const user = await this.users.createLocal(email, passwordHash);
    await this.sendVerificationEmail(user);
  }

  async sendVerificationEmail(user: User): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(token);

    await this.prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS) },
    });

    const locale = user.locale === 'en' ? 'en' : 'uk';
    await this.mail.send(
      user.email,
      locale,
      'verify-email',
      locale === 'en' ? 'Verify your email' : 'Підтвердіть вашу пошту',
      { verifyUrl: `${this.config.get<string>('FRONTEND_URL')}/verify-email?token=${token}` },
    );
  }

  async verifyEmail(token: string): Promise<void> {
    const candidates = await this.prisma.emailVerificationToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
    });

    const matched = await this.findMatchingToken(candidates, token);
    if (!matched) {
      throw new AppException(
        ERROR_CODES.INVALID_VERIFICATION_TOKEN,
        HttpStatus.BAD_REQUEST,
        'Invalid or expired verification token',
      );
    }

    await this.prisma.emailVerificationToken.update({ where: { id: matched.id }, data: { usedAt: new Date() } });
    await this.users.markEmailVerified(matched.userId);
  }

  async validateLocalUser(email: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, 'Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, 'Invalid email or password');
    }

    if (!user.emailVerified) {
      throw new AppException(ERROR_CODES.EMAIL_NOT_VERIFIED, HttpStatus.FORBIDDEN, 'Email not verified');
    }

    return { id: user.id, email: user.email };
  }

  async validateGoogleUser(profile: GoogleProfileInput): Promise<AuthenticatedUser> {
    const existingAccount = await this.prisma.authAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.providerAccountId } },
      include: { user: true },
    });

    if (existingAccount) {
      return { id: existingAccount.user.id, email: existingAccount.user.email };
    }

    let user = await this.users.findByEmail(profile.email);
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl, emailVerified: new Date() },
      });
    }

    await this.prisma.authAccount.create({
      data: { userId: user.id, provider: 'google', providerAccountId: profile.providerAccountId },
    });

    return { id: user.id, email: user.email };
  }

  async login(user: AuthenticatedUser, meta: RequestMeta) {
    const accessToken = this.tokens.signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = await this.tokens.issueRefreshToken(user.id, meta);
    return { accessToken, refreshToken };
  }

  async refresh(presentedToken: string, meta: RequestMeta) {
    const { userId, refreshToken } = await this.tokens.rotateRefreshToken(presentedToken, meta);
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppException(ERROR_CODES.INVALID_REFRESH_TOKEN, HttpStatus.UNAUTHORIZED, 'Invalid refresh token');
    }

    const accessToken = this.tokens.signAccessToken({ sub: user.id, email: user.email });
    return { accessToken, refreshToken };
  }

  async logout(presentedToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(presentedToken);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(token);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });

    const locale = user.locale === 'en' ? 'en' : 'uk';
    await this.mail.send(
      user.email,
      locale,
      'password-reset',
      locale === 'en' ? 'Reset your password' : 'Скидання пароля',
      { resetUrl: `${this.config.get<string>('FRONTEND_URL')}/reset-password?token=${token}` },
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
    });

    const matched = await this.findMatchingToken(candidates, token);
    if (!matched) {
      throw new AppException(ERROR_CODES.INVALID_RESET_TOKEN, HttpStatus.BAD_REQUEST, 'Invalid or expired reset token');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.passwordResetToken.update({ where: { id: matched.id }, data: { usedAt: new Date() } });
    await this.users.updatePassword(matched.userId, passwordHash);
  }

  private async findMatchingToken<T extends { tokenHash: string }>(
    candidates: T[],
    presentedToken: string,
  ): Promise<T | undefined> {
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, presentedToken)) {
        return candidate;
      }
    }
    return undefined;
  }
}
