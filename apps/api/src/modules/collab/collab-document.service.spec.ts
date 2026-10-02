// apps/api/src/modules/collab/collab-document.service.spec.ts
// O0a-2（Spec B）：api 读≡web 读——readCanvas 收编 shared readRecordsFromMaps 后，
// 同一真 Y.Doc 双跑对照（api 收编后读出口 vs web readCanvasFromDoc 同款手法
// readRecordsFromMaps(toDocLike(doc))）逐位相等。identity 档不变量的 api 侧锚。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService } from './collab-document.service';
import { readRecordsFromMaps, type DocLike, type DocMapLike } from '@flowweb/shared';

/** web ydocBuilder.toDocLike 同款手法（api 侧不可 import apps/web——测试内联同构对照半边） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

/** 真 Y.Doc 夹具：全键节点+缺键节点（无 parentId/width/height/position）+单边 */
function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');

  const full = new Y.Map();
  full.set('type', 'textInput');
  full.set('parentId', 'g1');
  full.set('width', 320);
  full.set('height', 120);
  const pos = new Y.Map();
  pos.set('x', 10);
  pos.set('y', 20);
  full.set('position', pos);
  const data = new Y.Map();
  data.set('text', 'a');
  full.set('data', data);
  nodes.set('full', full);

  const bare = new Y.Map(); // 缺键节点——读出口键消除判据（doc 无键⇄records 无键）
  bare.set('type', 'imageGen');
  nodes.set('bare', bare);

  const edges = doc.getMap('edges');
  const e = new Y.Map();
  e.set('source', 'full');
  e.set('target', 'bare');
  edges.set('e1', e);
  return doc;
}

function buildService(doc: Y.Doc): CollabDocumentService {
  const service = new CollabDocumentService({} as any);
  vi.spyOn(service, 'withDoc').mockImplementation(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc) as any);
  return service;
}

describe('CollabDocumentService.readCanvas（O0a-2 收编 readRecordsFromMaps——api 读≡web 读）', () => {
  it('同一 doc 双端比：api readCanvas 输出 ≡ web 手法 readRecordsFromMaps(toDocLike(doc)) 逐位相等', async () => {
    const doc = buildDoc();
    const service = buildService(doc);
    const apiOut = await service.readCanvas('p1');
    const webOut = readRecordsFromMaps(toDocLike(doc)); // web readCanvasFromDoc = 本调用（ydocBuilder 薄委托）
    expect(apiOut).toEqual(webOut);
  });

  it('读出口=作者态 DocNodeRecord：doc 缺键→出口无键（null 消除——批4a 契约/键集表同形）', async () => {
    const service = buildService(buildDoc());
    const { nodes } = await service.readCanvas('p1');
    const bare = nodes.find((n: any) => n.id === 'bare') as any;
    expect(bare.type).toBe('imageGen');
    expect('parentId' in bare).toBe(false);   // 旧实现此处为 null——收编后键消失
    expect('position' in bare).toBe(false);   // 旧实现此处为 {x:0,y:0} 兜底——键消失
    expect('width' in bare).toBe(false);
    expect(bare.data).toEqual({});
  });

  it('edges 单形状键集锁定（R1a 语义锁保留——toEqual 键集敏感）', async () => {
    const service = buildService(buildDoc());
    const { edges } = await service.readCanvas('p1');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ id: 'e1', source: 'full', target: 'bare' }); // 无双键名别名键
  });
});
