import * as Y from 'yjs';
import { CollabRedisSync } from './collab-redis-sync.service';

class MockRedis {
  channels: string[] = [];
  handlers = new Map<string, (msg: string) => void>();
  publish(ch: string, msg: string) {
    this.handlers.get(ch)?.(msg);
    return Promise.resolve(1);
  }
  subscribe(ch: string) { this.channels.push(ch); return Promise.resolve(); }
  psubscribe(..._patterns: string[]) { return Promise.resolve(); }
  on(_ev: string, _handler: (msg: string, ch: string) => void) {}
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
});
