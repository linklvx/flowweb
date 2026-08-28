import { Injectable, Logger, Optional, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server } from '@hocuspocus/server';
import type { onAuthenticatePayload, onDisconnectPayload, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { svSatisfied } from './sv.util';

export const COMPACT_THRESHOLD = 32;

export function parseProjectId(documentName: string): string {
  return documentName.replace(/^project:/, '');
}

@Injectable()
export class CollabGateway implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabGateway.name);
  readonly server: Server;
  /** 每文档"已持久化状态"（spec 2.2 lastPersistedSV，= Postgres maxSeq 时刻状态） */
  private readonly persistedSVs = new Map<string, Uint8Array>();
  readonly hooks: {
    onLoadDocument: (p: onLoadDocumentPayload) => Promise<any>;
    onStoreDocument: (p: onStoreDocumentPayload) => Promise<void>;
    onDisconnect: (p: onDisconnectPayload) => Promise<void>;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repo: CanvasDocUpdateRepository,
    @Optional() @Inject('COLLAB_PORT') port?: number,
    @Optional() @Inject('COLLAB_DEBOUNCE') debounce?: number,
  ) {
    this.hooks = {
      onLoadDocument: (p) => this.loadDocument(p),
      onStoreDocument: (p) => this.storeDocument(p),
      onDisconnect: (p) => this.disconnect(p),
    };
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
      onLoadDocument: this.hooks.onLoadDocument,
      onStoreDocument: this.hooks.onStoreDocument,
      onDisconnect: this.hooks.onDisconnect,
      extensions: [
        // v4.6.0 无 url 选项——createClient 直建 ioredis（吃 REDIS_URL，pub/sub 各一连接）
        new RedisExtension({ createClient: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0') }),
      ],
    });
  }

  /** spec 2.3：快照 + 增量按 (projectId, seq ASC) 重放 */
  private async loadDocument({ document, documentName }: onLoadDocumentPayload) {
    const projectId = parseProjectId(documentName);
    const docRow = await this.prisma.canvasDoc.findUnique({ where: { projectId } });
    if (docRow) Y.applyUpdate(document, new Uint8Array(docRow.state));
    for (const u of await this.repo.loadUpdates(projectId)) {
      Y.applyUpdate(document, new Uint8Array(u));
    }
    this.persistedSVs.set(projectId, Y.encodeStateVector(document));
    return document;
  }

  /** spec 2.2：diff append（含 flush 语义）+ 阈值触发 compaction */
  private async storeDocument({ document, documentName }: Pick<onStoreDocumentPayload, 'document' | 'documentName'>) {
    const projectId = parseProjectId(documentName);
    const lastSV = this.persistedSVs.get(projectId);
    if (!lastSV) return;
    const currentSV = Y.encodeStateVector(document);
    if (svSatisfied(currentSV, lastSV) && svSatisfied(lastSV, currentSV)) return; // 无变化
    await this.repo.append(projectId, Y.encodeStateAsUpdate(document, lastSV));
    this.persistedSVs.set(projectId, currentSV);
    if (await this.repo.count(projectId) >= COMPACT_THRESHOLD) {
      const snapshotSV = await this.repo.compact(projectId);
      if (snapshotSV) this.persistedSVs.set(projectId, snapshotSV);
    }
  }

  /** spec 2.2：最后连接断开（含直连）强制 flush-then-compact */
  private async disconnect({ document, documentName }: onDisconnectPayload) {
    if (document.getConnectionsCount() > 0) return;
    const projectId = parseProjectId(documentName);
    try {
      await this.storeDocument({ document, documentName });
      await this.repo.compact(projectId);
    } catch (err) {
      this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);
    } finally {
      this.persistedSVs.delete(projectId);
    }
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
