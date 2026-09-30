import { Injectable } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

export type EventName =
  | 'wallet.changed'
  | 'category.changed'
  | 'expense.changed'
  | 'recurring.changed'
  | 'space.changed'
  | 'member.joined';

export interface EventPayload {
  spaceId: string;
  actorId: string;
}

@Injectable()
export class EventBus {
  constructor(private readonly gateway: EventsGateway) {}

  emitToSpace(spaceId: string, event: EventName, actorId: string): void {
    const payload: EventPayload = { spaceId, actorId };
    this.gateway.server.to(`space:${spaceId}`).emit(event, payload);
  }
}
