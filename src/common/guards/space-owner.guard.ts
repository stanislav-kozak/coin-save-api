import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { SpaceMemberGuard } from './space-member.guard';
import { AppException } from '../exceptions/app.exception';
import { ERROR_CODES } from '../constants/error-codes';

interface MembershipWithRole {
  role: 'OWNER' | 'MEMBER';
}

@Injectable()
export class SpaceOwnerGuard extends SpaceMemberGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest();
    const membership = request.membership as MembershipWithRole;

    if (membership.role !== 'OWNER') {
      throw new AppException(
        ERROR_CODES.FORBIDDEN_NOT_OWNER,
        HttpStatus.FORBIDDEN,
        'Owner role required',
      );
    }

    return true;
  }
}
