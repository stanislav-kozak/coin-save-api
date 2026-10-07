import { EventsGateway } from './events.gateway';

function buildSocket(
  overrides: {
    authToken?: string;
    cookie?: string;
    origin?: string;
    data?: Record<string, unknown>;
  } = {},
) {
  return {
    handshake: {
      auth: { token: overrides.authToken },
      headers: {
        ...(overrides.cookie ? { cookie: overrides.cookie } : {}),
        ...(overrides.origin ? { origin: overrides.origin } : {}),
      },
    },
    data: overrides.data ?? {},
    disconnect: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
}

function buildGateway(
  overrides: {
    verifyAsync?: ReturnType<typeof vi.fn>;
    membership?: unknown;
  } = {},
) {
  const jwtService = {
    verifyAsync:
      overrides.verifyAsync ??
      vi.fn().mockResolvedValue({ sub: 'u1', email: 'u1@example.com' }),
  };
  const prisma = {
    membership: {
      findUnique: vi.fn().mockResolvedValue(overrides.membership ?? null),
    },
  };
  const config = {
    get: vi.fn().mockReturnValue('https://app.coinsavekeeper.com'),
  };
  const gateway = new EventsGateway(
    jwtService as never,
    prisma as never,
    config as never,
  );
  return { gateway, jwtService, prisma };
}

async function authenticate(
  gateway: EventsGateway,
  socket: ReturnType<typeof buildSocket>,
): Promise<Error | undefined> {
  return new Promise((resolve) => {
    void gateway.authenticateHandshake(socket as never, (err?: Error) =>
      resolve(err),
    );
  });
}

describe('EventsGateway', () => {
  describe('authenticateHandshake (io middleware)', () => {
    it('authenticates from the httpOnly access cookie the browser sends', async () => {
      const { gateway, jwtService } = buildGateway();
      const socket = buildSocket({
        cookie: 'session=1; access=cookie-token; other=x',
        origin: 'https://app.coinsavekeeper.com',
      });

      const err = await authenticate(gateway, socket);

      expect(err).toBeUndefined();
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('cookie-token');
      expect(socket.data.userId).toBe('u1');
    });

    it('falls back to handshake.auth.token for non-browser clients', async () => {
      const { gateway, jwtService } = buildGateway();
      const socket = buildSocket({ authToken: 'auth-token' });

      expect(await authenticate(gateway, socket)).toBeUndefined();
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('auth-token');
    });

    it('rejects with a connect error UNAUTHORIZED (not a server disconnect) when there is no token', async () => {
      const { gateway } = buildGateway();
      const socket = buildSocket();

      const err = await authenticate(gateway, socket);

      expect(err?.message).toBe('UNAUTHORIZED');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('rejects UNAUTHORIZED when the token fails verification (e.g. expired)', async () => {
      const { gateway } = buildGateway({
        verifyAsync: vi.fn().mockRejectedValue(new Error('jwt expired')),
      });

      const err = await authenticate(
        gateway,
        buildSocket({ cookie: 'access=expired' }),
      );

      expect(err?.message).toBe('UNAUTHORIZED');
    });

    it('rejects connections from another site (cross-site WebSocket hijacking)', async () => {
      const { gateway, jwtService } = buildGateway();

      const err = await authenticate(
        gateway,
        buildSocket({ cookie: 'access=t', origin: 'https://evil.example' }),
      );

      expect(err?.message).toBe('FORBIDDEN_ORIGIN');
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscribe', () => {
    it('joins the space room when the client is a member', async () => {
      const { gateway, prisma } = buildGateway({
        membership: { id: 'm1', userId: 'u1', spaceId: 's1' },
      });
      const client = buildSocket({ data: { userId: 'u1' } });

      const ack = await gateway.handleSubscribe(client as never, {
        spaceId: 's1',
      });

      expect(ack).toEqual({ ok: true });
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_spaceId: { userId: 'u1', spaceId: 's1' } },
      });
      expect(client.join).toHaveBeenCalledWith('space:s1');
    });

    it('does not join the room when the client is not a member', async () => {
      const { gateway } = buildGateway({ membership: null });
      const client = buildSocket({ data: { userId: 'u1' } });

      const ack = await gateway.handleSubscribe(client as never, {
        spaceId: 's1',
      });

      expect(ack).toEqual({ ok: false, code: 'FORBIDDEN_NOT_MEMBER' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('does not join the room when the client has no userId', async () => {
      const { gateway } = buildGateway();
      const client = buildSocket({ data: {} });

      const ack = await gateway.handleSubscribe(client as never, {
        spaceId: 's1',
      });

      expect(ack).toEqual({ ok: false, code: 'UNAUTHORIZED' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('answers VALIDATION_ERROR when spaceId is missing', async () => {
      const { gateway } = buildGateway();
      const client = buildSocket({ data: { userId: 'u1' } });

      const ack = await gateway.handleSubscribe(client as never, {} as never);

      expect(ack).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    });
  });

  describe('handleUnsubscribe', () => {
    it('leaves the space room', () => {
      const { gateway } = buildGateway();
      const client = buildSocket({ data: { userId: 'u1' } });

      gateway.handleUnsubscribe(client as never, { spaceId: 's1' });

      expect(client.leave).toHaveBeenCalledWith('space:s1');
    });
  });
});
