import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({ namespace: '/execution', cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:5173'] } })
export class ExecutionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(_client: Socket) {}

  handleDisconnect(_client: Socket) {}

  /** 鉴权：镜像 collab.gateway.authenticate 的 session 直查（cookie 名 flowweb.session_token）。
   *  只校验团队成员身份（读面——VIEWER 也应可见状态）；批5 socket.io 退役评估后本通道可能整体消失。 */
  private async authorize(client: Socket, projectId: string): Promise<boolean> {
    const token = (client.handshake.headers?.cookie || '').match(/flowweb\.session_token=([^;]+)/)?.[1];
    if (!token) return false;
    const session = await this.prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) return false;
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } });
    if (!project) return false;
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: session.user.id } },
    });
    return !!member;
  }

  @SubscribeMessage('join')
  async handleJoin(client: Socket, projectId: string) {
    if (!(await this.authorize(client, projectId))) {
      client.emit('join:error', 'unauthorized');
      return;
    }
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
