import { EventsGateway } from './events.gateway';

function buildSocket(
  overrides: {
    authToken?: string;
    data?: Record<string, unknown>;
  } = {},
) {
  return {
    handshake: { auth: { token: overrides.authToken } },
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
  const gateway = new EventsGateway(jwtService as never, prisma as never);
  return { gateway, jwtService, prisma };
}

describe('EventsGateway', () => {
  describe('handleConnection', () => {
    it('verifies the handshake token and sets client.data.userId on success', async () => {
      const { gateway, jwtService } = buildGateway();
      const client = buildSocket({ authToken: 'valid-token' });

      await gateway.handleConnection(client as never);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(client.data.userId).toBe('u1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects a client with no token', async () => {
      const { gateway } = buildGateway();
      const client = buildSocket({ authToken: undefined });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.data.userId).toBeUndefined();
    });

    it('disconnects a client whose token fails verification', async () => {
      const { gateway } = buildGateway({
        verifyAsync: vi.fn().mockRejectedValue(new Error('invalid token')),
      });
      const client = buildSocket({ authToken: 'bad-token' });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.data.userId).toBeUndefined();
    });
  });

  describe('handleSubscribe', () => {
    it('joins the space room when the client is a member', async () => {
      const { gateway, prisma } = buildGateway({
        membership: { id: 'm1', userId: 'u1', spaceId: 's1' },
      });
      const client = buildSocket({ data: { userId: 'u1' } });

      await gateway.handleSubscribe(client as never, { spaceId: 's1' });

      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_spaceId: { userId: 'u1', spaceId: 's1' } },
      });
      expect(client.join).toHaveBeenCalledWith('space:s1');
    });

    it('does not join the room when the client is not a member', async () => {
      const { gateway } = buildGateway({ membership: null });
      const client = buildSocket({ data: { userId: 'u1' } });

      await gateway.handleSubscribe(client as never, { spaceId: 's1' });

      expect(client.join).not.toHaveBeenCalled();
    });

    it('does not join the room when the client has no userId', async () => {
      const { gateway } = buildGateway();
      const client = buildSocket({ data: {} });

      await gateway.handleSubscribe(client as never, { spaceId: 's1' });

      expect(client.join).not.toHaveBeenCalled();
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
