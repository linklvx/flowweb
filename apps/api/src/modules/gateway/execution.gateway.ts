import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SkipThrottle } from '@nestjs/throttler';
import { Inject, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { SessionService } from '../../auth/session.service';

/** 批0c-8 豁免全局 ThrottlerGuard，两个部署前提：
 *  ① APP_GUARD 会触达 socket.io WS context——throttler 在 WS 上的 IP 解析行为未验证，先豁免；
 *  ② 反代（nginx）后 req.ip 全是代理 IP——300/min 会变全站共享单桶，生产部署前需 trust proxy
 *    或自定义 tracker（已登记 tech-debt）。 */
@SkipThrottle()
@WebSocketGateway({ namespace: '/execution', cors: { origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()) } })
export class ExecutionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ExecutionGateway.name);

  @WebSocketServer()
  server!: Server;

  /** 批3-3：session 查询统一走 SessionService.touch（鉴权读面——touch 对近过期连接顺带续期，语义一致）；
   *  直构测试不传时以注入的 prisma 兜底自建 */
  private readonly sessions: SessionService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(SessionService) sessions?: SessionService,
  ) {
    this.sessions = sessions ?? new SessionService(prisma);
  }

  handleConnection(_client: Socket) {}

  handleDisconnect(_client: Socket) {}

  /** 鉴权：镜像 collab.gateway.authenticate 的 session 直查（cookie 名 flowweb.session_token）。
   *  只校验团队成员身份（读面——VIEWER 也应可见状态）；批5 socket.io 退役评估后本通道可能整体消失。 */
  private async authorize(client: Socket, projectId: string): Promise<boolean> {
    const token = parseSessionToken(client.handshake.headers?.cookie);
    if (!token) return false;
    try {
      const session = await this.sessions.touch(token);   // 无效/过期→null（终态禁复活）
      if (!session) return false;
      const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } });
      if (!project) return false;
      const member = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: project.teamId, userId: session.user.id } },
      });
      return !!member;
    } catch (err: any) {
      // prisma 异常默认会被 Nest WS 层吞掉（reject → 无日志的静默拒绝），留 warn 便于排障；
      // fail-closed 语义不变：任何异常一律拒绝
      this.logger.warn(`join authorize db error: ${err?.message ?? err}`);
      return false;
    }
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
