import type { ExecutionContext } from '@nestjs/common';
import { WsJwtGuard } from './ws-jwt.guard';

function buildContext(data: Record<string, unknown>): ExecutionContext {
  return {
    switchToWs: () => ({
      getClient: () => ({ data }),
    }),
  } as unknown as ExecutionContext;
}

describe('WsJwtGuard', () => {
  it('allows a client whose handleConnection already set data.userId', () => {
    const guard = new WsJwtGuard();
    expect(guard.canActivate(buildContext({ userId: 'u1' }))).toBe(true);
  });

  it('rejects a client with no userId on socket.data', () => {
    const guard = new WsJwtGuard();
    expect(guard.canActivate(buildContext({}))).toBe(false);
  });

  it('rejects a client whose userId is not a string', () => {
    const guard = new WsJwtGuard();
    expect(guard.canActivate(buildContext({ userId: 123 }))).toBe(false);
  });
});
