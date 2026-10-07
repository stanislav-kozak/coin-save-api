import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/token.service';
import { WsJwtGuard } from './ws-jwt.guard';

interface EventsSocketData {
  userId?: string;
}

type EventsSocket = Socket<any, any, any, EventsSocketData>;

export type SubscribeAck =
  | { ok: true }
  | {
      ok: false;
      code: 'UNAUTHORIZED' | 'FORBIDDEN_NOT_MEMBER' | 'VALIDATION_ERROR';
    };

// Same name as the auth cookie set by AuthController.
const ACCESS_COOKIE = 'access';

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

// Browsers always send Origin on cross-site requests; only the app's own
// origin (FRONTEND_URL) may open a socket, since auth rides on cookies.
// Non-browser clients send no Origin and authenticate with auth.token.
function isAllowedOrigin(
  origin: string | undefined,
  frontendUrl: string | undefined,
): boolean {
  return !origin || !frontendUrl || origin === new URL(frontendUrl).origin;
}

@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => callback(null, isAllowedOrigin(origin, process.env.FRONTEND_URL)),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayInit {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticateHandshake(socket as EventsSocket, next);
    });
  }

  // Runs before the connection is accepted. Rejecting via next(err) gives
  // the client a `connect_error` (err.message = code) it can recover from —
  // e.g. on UNAUTHORIZED: POST /api/auth/refresh, then reconnect — whereas a
  // server-side disconnect stops Socket.IO from reconnecting at all.
  async authenticateHandshake(
    socket: EventsSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    const origin = socket.handshake.headers?.origin;
    if (!isAllowedOrigin(origin, this.config.get<string>('FRONTEND_URL'))) {
      next(new Error('FORBIDDEN_ORIGIN'));
      return;
    }

    // Browsers: the httpOnly access cookie (same-origin /socket.io request).
    // Other clients: handshake.auth.token.
    const token =
      readCookie(socket.handshake.headers?.cookie, ACCESS_COOKIE) ??
      (socket.handshake.auth?.token as string | undefined);
    if (!token) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('space.subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: EventsSocket,
    @MessageBody() body: { spaceId: string },
  ): Promise<SubscribeAck> {
    // The return value is the Socket.IO acknowledgement:
    // socket.emit('space.subscribe', { spaceId }, (ack) => ...).
    const userId = client.data.userId;
    if (!userId) {
      return { ok: false, code: 'UNAUTHORIZED' };
    }
    if (!body?.spaceId) {
      return { ok: false, code: 'VALIDATION_ERROR' };
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId: body.spaceId } },
    });
    if (!membership) {
      return { ok: false, code: 'FORBIDDEN_NOT_MEMBER' };
    }

    await client.join(`space:${body.spaceId}`);
    return { ok: true };
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
