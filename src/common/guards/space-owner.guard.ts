import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { SpaceMemberGuard, type SpaceGuardRequest } from './space-member.guard';
import { AppException } from '../exceptions/app.exception';
import { ERROR_CODES } from '../constants/error-codes';

@Injectable()
export class SpaceOwnerGuard extends SpaceMemberGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<SpaceGuardRequest>();
    const membership = request.membership!;

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
