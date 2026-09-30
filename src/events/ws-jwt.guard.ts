import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';

interface AuthenticatedSocketData {
  userId?: unknown;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context
      .switchToWs()
      .getClient<Socket<any, any, any, AuthenticatedSocketData>>();
    return typeof client.data.userId === 'string';
  }
}
