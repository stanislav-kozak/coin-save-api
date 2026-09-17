import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { SpaceOwnerGuard } from './space-owner.guard';
import { AppException } from '../exceptions/app.exception';

function createContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SpaceOwnerGuard', () => {
  it('allows access when the membership role is OWNER', async () => {
    const membership = { id: 'm1', userId: 'u1', spaceId: 's1', role: 'OWNER' };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue(membership) },
    };
    const guard = new SpaceOwnerGuard(prisma as never);
    const request = { user: { id: 'u1' }, params: { spaceId: 's1' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
  });

  it('throws FORBIDDEN_NOT_OWNER when the role is MEMBER', async () => {
    const membership = {
      id: 'm1',
      userId: 'u1',
      spaceId: 's1',
      role: 'MEMBER',
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue(membership) },
    };
    const guard = new SpaceOwnerGuard(prisma as never);
    const request = { user: { id: 'u1' }, params: { spaceId: 's1' } };

    try {
      await guard.canActivate(createContext(request));
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });
});
