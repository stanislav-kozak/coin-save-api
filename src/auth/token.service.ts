import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(payload);
  }

  async issueRefreshToken(userId: string, meta: RequestMeta): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return token;
  }

  async rotateRefreshToken(
    presentedToken: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; refreshToken: string }> {
    const candidates = await this.prisma.refreshToken.findMany({
      where: { expiresAt: { gt: new Date() } },
    });

    let matched: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, presentedToken)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      throw new AppException(
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
        'Invalid refresh token',
      );
    }

    if (matched.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: matched.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppException(
        ERROR_CODES.REFRESH_TOKEN_REUSE_DETECTED,
        HttpStatus.UNAUTHORIZED,
        'Refresh token reuse detected; all sessions revoked',
      );
    }

    await this.prisma.refreshToken.update({
      where: { id: matched.id },
      data: { revokedAt: new Date() },
    });

    const refreshToken = await this.issueRefreshToken(matched.userId, meta);
    return { userId: matched.userId, refreshToken };
  }

  async revokeRefreshToken(presentedToken: string): Promise<void> {
    const candidates = await this.prisma.refreshToken.findMany({
      where: { revokedAt: null },
    });

    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, presentedToken)) {
        await this.prisma.refreshToken.update({
          where: { id: candidate.id },
          data: { revokedAt: new Date() },
        });
        return;
      }
    }
  }
}
