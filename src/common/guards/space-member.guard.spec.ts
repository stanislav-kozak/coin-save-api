import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { SpaceMemberGuard } from './space-member.guard';
import { AppException } from '../exceptions/app.exception';

function createContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SpaceMemberGuard', () => {
  it('allows access and attaches the membership when the user belongs to the space', async () => {
    const membership = { id: 'm1', userId: 'u1', spaceId: 's1', role: 'MEMBER' };
    const prisma = { membership: { findUnique: vi.fn().mockResolvedValue(membership) } };
    const guard = new SpaceMemberGuard(prisma as never);
    const request: Record<string, unknown> = { user: { id: 'u1' }, params: { spaceId: 's1' } };

    const result = await guard.canActivate(createContext(request));

    expect(result).toBe(true);
    expect(request.membership).toBe(membership);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_spaceId: { userId: 'u1', spaceId: 's1' } },
    });
  });

  it('throws FORBIDDEN_NOT_MEMBER when there is no membership row', async () => {
    const prisma = { membership: { findUnique: vi.fn().mockResolvedValue(null) } };
    const guard = new SpaceMemberGuard(prisma as never);
    const request = { user: { id: 'u1' }, params: { spaceId: 's1' } };

    try {
      await guard.canActivate(createContext(request));
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });
});
