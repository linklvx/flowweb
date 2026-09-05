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
    status: 'loading' | 'done' | 'error' | 'edit-result' | 'edit-failed';
    resultUrl?: string;
    fileId?: string;
    error?: string;
    credits?: { credits: number; subscriptionCredits: number; total: number };
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

  emitSeparateStatus(workflowId: string, data: {
    nodeId: string;
    taskId: string;
    status: 'processing' | 'done' | 'error';
    videoFileId?: string;
    audioFileId?: string;
    error?: string;
  }) {
    this.server.to(`project:${workflowId}`).emit('video-separate:status', data);
  }

  emitStitchStatus(projectId: string, data: {
    taskId: string;
    status: 'COMPLETED' | 'FAILED';
    fileId?: string;
    url?: string;
    width?: number;
    height?: number;
    cellCount?: number;
    failedCount?: number;
    error?: string;
  }) {
    this.server.to(`project:${projectId}`).emit('storyboard:stitch:completed', data);
  }
}
