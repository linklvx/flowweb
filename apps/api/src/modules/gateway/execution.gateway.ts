import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { auth } from '../../auth/auth';

@WebSocketGateway({ namespace: '/execution', cors: { origin: '*' } })
export class ExecutionGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(async (socket: any, next: any) => {
      const token = socket.handshake.auth?.token;
      if (!token) {
        socket.data.userId = 'default-user';
        return next();
      }
      try {
        const session = await auth.api.getSession({
          headers: new Headers({ cookie: `flowweb.session_token=${token}` }),
        });
        if (!session) throw new Error('Invalid');
        socket.data.userId = session.user.id;
        next();
      } catch {
        socket.data.userId = 'default-user';
        next();
      }
    });
  }

  handleConnection(_client: Socket) {}

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join')
  handleJoin(client: Socket, projectId: string) {
    client.join(`project:${projectId}`);
  }

  emitNodeStatus(projectId: string, data: {
    nodeId: string;
    status: 'loading' | 'done' | 'error' | 'edit-result' | 'edit-failed';
    resultUrl?: string;
    fileId?: string;
    error?: string;
    credits?: number;
  }) {
    this.server.to(`project:${projectId}`).emit('node:status', data);
  }

  emitExecutionComplete(projectId: string, data: { totalCost: number }) {
    this.server.to(`project:${projectId}`).emit('execution:complete', data);
  }

  emitTrimStatus(workflowId: string, data: {
    nodeId: string;
    taskId: string;
    status: string;
    outputFileId?: string;
    error?: string;
  }) {
    this.server.to(`project:${workflowId}`).emit('video-trim:status', data);
  }
}
