import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/execution', cors: { origin: '*' } })
export class ExecutionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(_client: Socket) {}

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join')
  handleJoin(client: Socket, projectId: string) {
    client.join(`project:${projectId}`);
  }

  emitNodeStatus(projectId: string, data: {
    nodeId: string;
    status: 'loading' | 'done' | 'error';
    resultUrl?: string;
    error?: string;
    credits?: number;
  }) {
    this.server.to(`project:${projectId}`).emit('node:status', data);
  }

  emitExecutionComplete(projectId: string, data: { totalCost: number }) {
    this.server.to(`project:${projectId}`).emit('execution:complete', data);
  }
}
