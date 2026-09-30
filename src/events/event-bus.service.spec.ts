import { EventBus } from './event-bus.service';
import type { EventsGateway } from './events.gateway';

describe('EventBus', () => {
  it('emits to the space room with the exact event contract payload', () => {
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const gateway = { server: { to } } as unknown as EventsGateway;
    const bus = new EventBus(gateway);

    bus.emitToSpace('s1', 'wallet.changed', 'u1');

    expect(to).toHaveBeenCalledWith('space:s1');
    expect(emit).toHaveBeenCalledWith('wallet.changed', {
      spaceId: 's1',
      actorId: 'u1',
    });
  });
});
