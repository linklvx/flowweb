import * as Y from 'yjs';
import { vi } from 'vitest';
import { CollabRedisSync } from './collab-redis-sync.service';

class MockRedis {
  channels: string[] = [];
  handlers = new Map<string, (...args: unknown[]) => void>();
  publish(ch: string, msg: string) {
    this.handlers.get(ch)?.(msg);
    return Promise.resolve(1);
  }
  subscribe(ch: string) { this.channels.push(ch); return Promise.resolve(); }
  psubscribe(..._patterns: string[]) { return Promise.resolve(); }
  on(ev: string, handler: (...args: unknown[]) => void) { this.handlers.set(ev, handler); }
  /** 模拟 ioredis pmessageBuffer 回调：参数为 Buffer */
  emitPmessage(pattern: string, channel: string, msg: string) {
    this.handlers.get('pmessageBuffer')?.(pattern, Buffer.from(channel), Buffer.from(msg));
  }
}

describe('CollabRedisSync', () => {
  it('请求方：1s 内收到 response 则 apply，超时降级 resolve', async () => {
    const svc = new CollabRedisSync({ pub: new MockRedis() as any, sub: new MockRedis() as any });
    const peerDoc = new Y.Doc(); peerDoc.getMap('nodes').set('peer', 1);
    setTimeout(() => svc.handleResponseForTest('p1', Y.encodeStateAsUpdate(peerDoc)), 10);
    const local = new Y.Doc();
    await svc.syncFromPeers('project:p1', local, 1000);
    expect(local.getMap('nodes').get('peer')).toBe(1);
  });

  it('请求方：超时不抛错（Postgres 为准兜底）', async () => {
    const svc = new CollabRedisSync({ pub: new MockRedis() as any, sub: new MockRedis() as any });
    const local = new Y.Doc();
    await expect(svc.syncFromPeers('project:p1', local, 50)).resolves.toBeUndefined();
  });

  it('res 路由：含冒号 docName 的频道尾段 requestId 匹配 pending 并 apply', async () => {
    const pub = new MockRedis();
    const sub = new MockRedis();
    const publishSpy = vi.fn((_ch: string, _msg: string) => Promise.resolve(1));
    pub.publish = publishSpy;
    const svc = new CollabRedisSync({ pub: pub as any, sub: sub as any });

    const peerDoc = new Y.Doc(); peerDoc.getMap('nodes').set('peer', 1);
    const updateB64 = Buffer.from(Y.encodeStateAsUpdate(peerDoc)).toString('base64');

    const local = new Y.Doc();
    const promise = svc.syncFromPeers('project:p1', local, 1000);
    const req = JSON.parse(publishSpy.mock.calls[0]![1]) as { requestId: string };
    sub.emitPmessage(
      'collab-sync:res:*',
      `collab-sync:res:project:p1:${req.requestId}`,
      JSON.stringify({ requestId: req.requestId, docName: 'project:p1', update: updateB64 }),
    );
    await promise;
    expect(local.getMap('nodes').get('peer')).toBe(1);
  });

  it('req 处理：onRequest 以差异 update 回复到 res:<docName>:<requestId> 频道', async () => {
    const pub = new MockRedis();
    const sub = new MockRedis();
    const publishSpy = vi.fn((_ch: string, _msg: string) => Promise.resolve(1));
    pub.publish = publishSpy;
    const svc = new CollabRedisSync({ pub: pub as any, sub: sub as any });

    const peerDoc = new Y.Doc(); peerDoc.getMap('nodes').set('peer', 1);
    svc.getDocument = (name) => (name === 'project:p1' ? peerDoc : undefined);

    const svB64 = Buffer.from(Y.encodeStateVector(new Y.Doc())).toString('base64');
    const requestId = 'req-test-1';
    sub.emitPmessage(
      'collab-sync:req:*',
      'collab-sync:req:project:p1',
      JSON.stringify({ requestId, docName: 'project:p1', sv: svB64 }),
    );

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [ch, msg] = publishSpy.mock.calls[0]!;
    expect(ch).toBe(`collab-sync:res:project:p1:${requestId}`);
    const res = JSON.parse(msg) as { requestId: string; update: string };
    expect(res.requestId).toBe(requestId);
    const target = new Y.Doc();
    Y.applyUpdate(target, new Uint8Array(Buffer.from(res.update, 'base64')));
    expect(target.getMap('nodes').get('peer')).toBe(1);
  });
});
