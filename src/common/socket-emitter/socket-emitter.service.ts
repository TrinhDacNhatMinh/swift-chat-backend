import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SocketEmitterService {
  private server: Server;
  private readonly logger = new Logger(SocketEmitterService.name);

  setServer(server: Server): void {
    if (this.server) {
      this.logger.warn(
        'WebSocket Server instance is already set, overriding it',
      );
    }
    this.server = server;
    this.logger.log('WebSocket Server instance registered');
  }

  getServer(): Server | undefined {
    return this.server;
  }

  emitToRoom(room: string, event: string, data?: any): void {
    if (!this.server) {
      this.logger.warn(
        `Failed to emit event ${event} to room ${room}: Server not set`,
      );
      return;
    }
    this.server.to(room).emit(event, data);
  }

  emitToUser(userId: string, event: string, data?: any): void {
    if (!this.server) {
      this.logger.warn(
        `Failed to emit event ${event} to user ${userId}: Server not set`,
      );
      return;
    }
    this.server.to(`account:${userId}`).emit(event, data);
  }
}
