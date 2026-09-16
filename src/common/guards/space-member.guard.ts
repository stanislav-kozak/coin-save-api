import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../exceptions/app.exception';
import { ERROR_CODES } from '../constants/error-codes';
import { extractSpaceId } from '../decorators/space.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class SpaceMemberGuard implements CanActivate {
  constructor(protected readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    const spaceId = extractSpaceId(request);

    if (!user || !spaceId) {
      throw new AppException(
        ERROR_CODES.FORBIDDEN_NOT_MEMBER,
        HttpStatus.FORBIDDEN,
        'Not a member of this space',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId: user.id, spaceId } },
    });

    if (!membership) {
      throw new AppException(
        ERROR_CODES.FORBIDDEN_NOT_MEMBER,
        HttpStatus.FORBIDDEN,
        'Not a member of this space',
      );
    }

    request.membership = membership;
    return true;
  }
}
