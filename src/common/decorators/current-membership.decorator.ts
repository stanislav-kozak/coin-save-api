import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Membership } from '@prisma/client';
import type { SpaceGuardRequest } from '../guards/space-member.guard';

export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Membership => {
    const request = ctx.switchToHttp().getRequest<SpaceGuardRequest>();
    return request.membership!;
  },
);
