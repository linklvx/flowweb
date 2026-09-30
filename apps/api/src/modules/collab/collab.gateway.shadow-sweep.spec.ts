// apps/api/src/modules/collab/collab.gateway.shadow-sweep.spec.ts
// 批0b-2：孤儿影子服务端年龄清理（R32 GC 出口——所有权归位）。
// 轻量直构单元测试：不走真协议（R12 夹具重、端口/时序噪声大）——mock prisma/repo/redisSync
// 直构 gateway，不调 onModuleInit（不 listen、不起定时器，零残留句柄）。
// shadow id 形状先例：video-project.service.ts:93 `shadow-${kind}-${Date.now()}-${rand}`。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { describe, it, expect, vi } from 'vitest';

const TTL_MS = 7 * 24 * 3600 * 1000;

function buildGateway() {
  const prisma = { canvasDoc: { findUnique: vi.fn().mockResolvedValue(null) } };
  const repo = { loadUpdates: vi.fn().mockResolvedValue([]) };
  const redisSync = { syncFromPeers: vi.fn(async () => {}) };
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, redisSync as any,
    { resolve: vi.fn() } as any, 43000 + Math.floor(Math.random() * 20000),
  );
  return { gateway, repo, redisSync };
}

const agedId = (kind = 'video') => `shadow-${kind}-${Date.now() - TTL_MS - 24 * 3600 * 1000}-ab12cd`; // 超龄 1 天余量
const freshId = () => `shadow-audio-${Date.now()}-ef34gh`;

describe('批0b-2：孤儿影子服务端年龄清理（sweepDocument）', () => {
  it('只删超龄影子——新影子/普通节点/无时间戳旧形状影子不动', () => {
    const { gateway } = buildGateway();
    const doc = new Y.Doc();
    const nodes = doc.getMap('nodes');
    const aged = agedId();
    const fresh = freshId();
    nodes.set(aged, new Y.Map());
    nodes.set(fresh, new Y.Map());
    nodes.set('n1', new Y.Map());
    nodes.set('shadow-video-1', new Y.Map()); // 无时间戳段（regex 不匹配）——保守不动
    (gateway as any).sweepDocument(doc);
    expect(nodes.get(aged)).toBeUndefined();
    expect(nodes.get(fresh)).toBeTruthy();
    expect(nodes.get('n1')).toBeTruthy();
    expect(nodes.get('shadow-video-1')).toBeTruthy();
  });

  it('sweep 事务产生正确 delete set——update 应用到副本即删（持久化/广播路径依赖）', () => {
    const { gateway } = buildGateway();
    const src = new Y.Doc();
    const aged = agedId('audio');
    src.getMap('nodes').set(aged, new Y.Map());
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(src));
    const updates: Uint8Array[] = [];
    src.on('update', (u: Uint8Array) => updates.push(u));
    (gateway as any).sweepDocument(src);
    expect(updates).toHaveLength(1);
    for (const u of updates) Y.applyUpdate(replica, u);
    expect(replica.getMap('nodes').get(aged)).toBeUndefined();
  });
});

describe('批0b-2：触发点接线', () => {
  it('loadDocument 钩子尾触发 sweep——加载完成即清超龄影子，且删除 update 进 pending（持久化管道）', async () => {
    const { gateway } = buildGateway();
    const doc = new Y.Doc();
    const aged = agedId();
    doc.getMap('nodes').set(aged, new Y.Map());
    doc.getMap('nodes').set('n1', new Y.Map());
    await (gateway as any).loadDocument({ document: doc, documentName: 'project:p1' });
    expect(doc.getMap('nodes').get(aged)).toBeUndefined();
    expect(doc.getMap('nodes').get('n1')).toBeTruthy();
    const pending = (gateway as any).pendingUpdates.get(doc) as Uint8Array[];
    expect(pending).toBeDefined();       // loadDocument 注册的 update 监听已接住 sweep 删除
    expect(pending.length).toBeGreaterThan(0);
  });

  it('sweepAgedShadows：遍历 server 内存 documents Map 逐 doc 清理', async () => {
    const { gateway } = buildGateway();
    const doc = new Y.Doc();
    const aged = agedId();
    doc.getMap('nodes').set(aged, new Y.Map());
    gateway.server.hocuspocus.documents.set('project:p1', doc as any);
    await (gateway as any).sweepAgedShadows();
    expect(doc.getMap('nodes').get(aged)).toBeUndefined();
    gateway.server.hocuspocus.documents.delete('project:p1');
  });
});
