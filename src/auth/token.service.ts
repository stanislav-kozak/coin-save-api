import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RefreshToken } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// How long a just-rotated token is still accepted (see rotateRefreshToken).
// Well above the frontend's 10 s refresh timeout plus mobile network delays.
const ROTATION_GRACE_MS = 60 * 1000;

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
    return (await this.createRefreshToken(userId, meta)).token;
  }

  async rotateRefreshToken(
    presentedToken: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; refreshToken: string }> {
    const now = new Date();
    const matched = await this.findPresentedToken(presentedToken);

    if (!matched || matched.expiresAt.getTime() <= now.getTime()) {
      throw new AppException(
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
        'Invalid refresh token',
      );
    }

    if (matched.revokedAt) {
      // Presented again shortly after its own rotation: the response that
      // carried the new cookie most likely never reached the browser (the
      // client gave up waiting, or the tab was closed mid-request). Keep the
      // session going instead of treating it as theft.
      if (
        matched.replacedById &&
        now.getTime() - matched.revokedAt.getTime() <= ROTATION_GRACE_MS
      ) {
        const replacement = await this.prisma.refreshToken.findUnique({
          where: { id: matched.replacedById },
        });
        if (!replacement || replacement.revokedAt) {
          // The session was ended since (logout, password reset).
          throw new AppException(
            ERROR_CODES.INVALID_REFRESH_TOKEN,
            HttpStatus.UNAUTHORIZED,
            'Invalid refresh token',
          );
        }
        const { token } = await this.createRefreshToken(matched.userId, meta);
        return { userId: matched.userId, refreshToken: token };
      }

      await this.prisma.refreshToken.updateMany({
        where: { userId: matched.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new AppException(
        ERROR_CODES.REFRESH_TOKEN_REUSE_DETECTED,
        HttpStatus.UNAUTHORIZED,
        'Refresh token reuse detected; all sessions revoked',
      );
    }

    const { id, token } = await this.createRefreshToken(matched.userId, meta);
    await this.prisma.refreshToken.update({
      where: { id: matched.id },
      data: { revokedAt: now, replacedById: id },
    });
    return { userId: matched.userId, refreshToken: token };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeRefreshToken(presentedToken: string): Promise<void> {
    const matched = await this.findPresentedToken(presentedToken);
    if (matched && !matched.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: matched.id },
        data: { revokedAt: new Date() },
      });
    }
  }

  private async createRefreshToken(
    userId: string,
    meta: RequestMeta,
  ): Promise<{ id: string; token: string }> {
    const id = randomBytes(12).toString('hex');
    const secret = randomBytes(32).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        id,
        userId,
        tokenHash: await argon2.hash(secret),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return { id, token: `${id}.${secret}` };
  }

  // Tokens are "<row id>.<secret>", so the row is looked up directly and
  // only its hash is verified. Checking every stored hash instead made each
  // refresh slower as tokens piled up (one more per refresh).
  private async findPresentedToken(
    presentedToken: string,
  ): Promise<RefreshToken | null> {
    const dot = presentedToken.indexOf('.');
    if (dot > 0) {
      const row = await this.prisma.refreshToken.findUnique({
        where: { id: presentedToken.slice(0, dot) },
      });
      return row &&
        (await argon2.verify(row.tokenHash, presentedToken.slice(dot + 1)))
        ? row
        : null;
    }

    // Tokens issued before the id was embedded (no "."): only these still
    // need the scan. Each is replaced by a new-format one on its next
    // refresh, and all of them expire within REFRESH_TOKEN_TTL_MS.
    const candidates = await this.prisma.refreshToken.findMany({
      where: { expiresAt: { gt: new Date() } },
    });
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, presentedToken)) {
        return candidate;
      }
    }
    return null;
  }
}
