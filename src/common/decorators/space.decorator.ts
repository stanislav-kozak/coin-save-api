import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface RequestWithSpaceId {
  params: Record<string, string | undefined>;
  body?: { spaceId?: string };
}

export function extractSpaceId(
  request: RequestWithSpaceId,
): string | undefined {
  return request.params.spaceId ?? request.body?.spaceId;
}

export const Space = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithSpaceId>();
    return extractSpaceId(request);
  },
);
