// apps/api/src/modules/collab/node-doc.util.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildShadowNodeYMap } from './node-doc.util';

describe('buildShadowNodeYMap（与 ydocBuilder.fillDoc 逐键同构）', () => {
  it('type/position(Y.Map 必写)/data(Y.Map) 结构同构，影子 data 带 __ephemeral', () => {
    // yjs 13.6.32 prelim 机制：孤儿 Y.Map 的 set 写 _prelimContent，get 读 _map——内容仅在集成进 doc 后可读（YMap.js:94 注释原文）。
    // 故断言前先把返回值集成进 doc（与服务端 insertNode 用法一致）；以下断言逐字保留 plan 原文。
    const doc = new Y.Doc();
    const m = buildShadowNodeYMap({ id: 'shadow-video-x', type: 'videoGen', position: { x: -99999, y: -99999 }, data: { model: 'm', __ephemeral: true } });
    doc.getMap('nodes').set('shadow-video-x', m);
    expect(m.get('type')).toBe('videoGen');
    expect(m.get('position')).toBeInstanceOf(Y.Map);
    expect((m.get('position') as Y.Map<any>).get('x')).toBe(-99999);
    const data = m.get('data') as Y.Map<any>;
    expect(data).toBeInstanceOf(Y.Map);
    expect(data.get('__ephemeral')).toBe(true);
  });
  it('无 parentId 键（fillDoc 同构：parentId null 时省略，防差异循环）', () => {
    const doc = new Y.Doc();
    const m = buildShadowNodeYMap({ id: 'shadow-x', type: 'videoGen', position: { x: 0, y: 0 }, data: {} });
    doc.getMap('nodes').set('shadow-x', m);
    expect(m.get('parentId')).toBeUndefined();
  });
});

describe('跨端同步实测（固化机制认知）', () => {
  it('服务端 origin 不随 update 过网——客户端 applyUpdate 后 origin 是自己的，故短路判据必须用 id 前缀', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    server.on('update', (u) => Y.applyUpdate(client, u, 'network'));
    // 服务端以任意 origin 写入影子节点
    server.transact(() => {
      server.getMap('nodes').set('shadow-video-1', buildShadowNodeYMap({ id: 'shadow-video-1', type: 'videoGen', position: { x: 0, y: 0 }, data: { __ephemeral: true } }));
    }, 'server-shadow');
    // 客户端视角：影子节点可见（data.__ephemeral 可判），但事务 origin 是 'network' 而非 'server-shadow'
    const shadow = client.getMap('nodes').get('shadow-video-1') as Y.Map<any>;
    expect(shadow).toBeDefined();
    expect((shadow.get('data') as Y.Map<any>).get('__ephemeral')).toBe(true);
    let observedOrigin: unknown = 'unset';
    client.getMap('nodes').observeDeep((events) => { observedOrigin = events[0].transaction.origin; });
    client.transact(() => { client.getMap('nodes').set('local-1', new Y.Map()); }, 'server-shadow-伪造也不行');
    expect(observedOrigin).not.toBe('server-shadow'); // origin 由应用侧决定——判据只能靠内容（前缀/__ephemeral）
  });
});
