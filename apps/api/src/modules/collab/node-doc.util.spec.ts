// apps/api/src/modules/collab/node-doc.util.spec.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { writeNodeToYMap } from './node-doc.util';

describe('writeNodeToYMap（整信封写入共享入口——R1a；与 ydocBuilder.fillDoc 逐键同构）', () => {
  it('type/position(Y.Map 必写)/data(Y.Map) 结构同构，影子 data 带 __ephemeral', () => {
    // yjs 13.6.32 prelim 机制：孤儿 Y.Map 的 set 写 _prelimContent，get 读 _map——内容仅在集成进 doc 后可读（YMap.js:94 注释原文）。
    // 集成由 writeNodeToYMap 内部 nodesMap.set 完成（与服务端 insertNode 用法一致）；以下断言逐字保留 plan 原文。
    const doc = new Y.Doc();
    const m = writeNodeToYMap(doc.getMap('nodes'), { id: 'shadow-video-x', type: 'videoGen', position: { x: -99999, y: -99999 }, data: { model: 'm', __ephemeral: true } } as any);
    expect(m.get('type')).toBe('videoGen');
    expect(m.get('position')).toBeInstanceOf(Y.Map);
    expect((m.get('position') as Y.Map<any>).get('x')).toBe(-99999);
    const data = m.get('data') as Y.Map<any>;
    expect(data).toBeInstanceOf(Y.Map);
    expect(data.get('__ephemeral')).toBe(true);
  });
  it('无 parentId 键（fillDoc 同构：parentId null 时省略，防差异循环）', () => {
    const nodesMap = new Y.Doc().getMap('nodes');
    const m = writeNodeToYMap(nodesMap, { id: 'shadow-x', type: 'videoGen', position: { x: 0, y: 0 }, data: {} } as any);
    expect(m.get('parentId')).toBeUndefined();
  });
  it('data 全量写入（空 data Map 会使模板导入丢全部节点数据）', () => {
    const nodesMap = new Y.Doc().getMap('nodes');
    const m = writeNodeToYMap(nodesMap, { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { prompt: 'x' } } as any);
    expect((m.get('data') as Y.Map<any>).get('prompt')).toBe('x');
    // shadow 场景：__ephemeral 写在 data 内
    const sm = writeNodeToYMap(nodesMap, { id: 'shadow-n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { fileId: 'f1', __ephemeral: true } } as any);
    expect((sm.get('data') as Y.Map<any>).get('__ephemeral')).toBe(true);
  });
});
