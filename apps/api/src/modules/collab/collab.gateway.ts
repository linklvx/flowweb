import { Injectable, Logger, Optional, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server } from '@hocuspocus/server';
import type { onAuthenticatePayload, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';

export function parseProjectId(documentName: string): string {
  return documentName.replace(/^project:/, '');
}

@Injectable()
export class CollabGateway implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabGateway.name);
  readonly server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() @Inject('COLLAB_PORT') port?: number,
    @Optional() @Inject('COLLAB_DEBOUNCE') debounce?: number,
  ) {
    this.server = new Server({
      port: port ?? (Number(process.env.COLLAB_PORT) || 3001),
      debounce: debounce ?? 5000,
      maxDebounce: 10000,
      // 鉴权：session 直查 DB（BetterAuth getSession 在 NestJS 上下文失效——auth.service 同结论）；
      // token 来自 WS 握手 query（测试/工具）或 httpOnly cookie（浏览器自动携带）
      onAuthenticate: async ({ requestHeaders, requestParameters, documentName }: onAuthenticatePayload) => {
        const token = requestParameters?.get('token')
          ?? (requestHeaders?.get('cookie') || '').match(/flowweb\.session_token=([^;]+)/)?.[1]
          ?? null;
        const session = token
          ? await this.prisma.session.findUnique({ where: { token }, include: { user: true } })
          : null;
        if (!session || session.expiresAt < new Date()) throw new Error('未登录');
        const projectId = parseProjectId(documentName);
        const project = await this.prisma.canvasProject.findUnique({
          where: { id: projectId },
          select: { teamId: true },
        });
        if (!project) throw new Error('项目不存在');
        const member = await this.prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: project.teamId, userId: session.user.id } },
        });
        if (!member) throw new Error('非团队成员');
        return { user: { id: session.user.id, name: session.user.name, role: member.role } };
      },
      onLoadDocument: async ({ document, documentName }: onLoadDocumentPayload) => {
        const docRow = await this.prisma.canvasDoc.findUnique({
          where: { projectId: parseProjectId(documentName) },
        });
        if (docRow) {
          Y.applyUpdate(document, new Uint8Array(docRow.state));
        }
        return document;
      },
      onStoreDocument: async ({ document, documentName }: onStoreDocumentPayload) => {
        const projectId = parseProjectId(documentName);
        const state = Buffer.from(Y.encodeStateAsUpdate(document));
        await this.prisma.canvasDoc.upsert({
          where: { projectId },
          update: { state },
          create: { projectId, state },
        });
      },
    });
  }

  onModuleInit() {
    this.server.listen();
    // I3/M2：解散事件到达时 projects 可能已删——按 payload.projectIds 关连接，不查库
    this.eventEmitter.on('team.disbanded', (payload: { teamId: string; projectIds: string[] }) => {
      this.closeTeamDocuments(payload.projectIds);
    });
  }

  async onApplicationShutdown() {
    await this.server.destroy();
  }

  closeTeamDocuments(projectIds: string[]) {
    for (const projectId of projectIds) {
      try {
        this.server.hocuspocus.closeConnections(`project:${projectId}`);
      } catch (err) {
        this.logger.warn(`closeConnections failed for ${projectId}: ${(err as Error).message}`);
      }
    }
  }
}
