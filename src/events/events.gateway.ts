import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/token.service';
import { WsJwtGuard } from './ws-jwt.guard';

interface EventsSocketData {
  userId?: string;
}

type EventsSocket = Socket<any, any, any, EventsSocketData>;

@WebSocketGateway({ cors: true })
export class EventsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: EventsSocket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('space.subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: EventsSocket,
    @MessageBody() body: { spaceId: string },
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !body?.spaceId) {
      return;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId: body.spaceId } },
    });
    if (!membership) {
      return;
    }

    await client.join(`space:${body.spaceId}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('space.unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: EventsSocket,
    @MessageBody() body: { spaceId: string },
  ): void {
    if (body?.spaceId) {
      void client.leave(`space:${body.spaceId}`);
    }
  }
}
