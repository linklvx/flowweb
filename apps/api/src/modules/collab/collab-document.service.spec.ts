// apps/api/src/modules/collab/collab-document.service.spec.ts
// O0a-2（Spec B）：api 读≡web 读——readCanvas 收编 shared readRecordsFromMaps 后，
// 同一真 Y.Doc 双跑对照（api 收编后读出口 vs web readCanvasFromDoc 同款手法
// readRecordsFromMaps(toDocLike(doc))）逐位相等。
// O0b-0（Spec B）格式批：REST 读入口版本门 v2.1 fail-closed——v1 档/无戳∧有节点拒、
// 无戳∧零节点放行（REST 不盖戳）、sv 路径两锚（v1 同拒/v2 正常不退化）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabDocumentService } from './collab-document.service';
import { readRecordsFromMaps, stampDocSchema, CANVAS_DOC_SCHEMA_VERSION, type DocLike, type DocMapLike } from '@flowweb/shared';

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
    stampDocSchema(toDocLike(doc));   // O0b-0：REST 读需 v2 戳——夹具显式盖章（生产由 WS loadDocument 自愈/api 种子盖章）
    const service = buildService(doc);
    const apiOut = await service.readCanvas('p1');
    const webOut = readRecordsFromMaps(toDocLike(doc)); // web readCanvasFromDoc = 本调用（ydocBuilder 薄委托）
    expect(apiOut).toEqual(webOut);
  });

  it('读出口=作者态 DocNodeRecord：doc 缺键→出口无键（null 消除——批4a 契约/键集表同形）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    const { nodes } = await service.readCanvas('p1');
    const bare = nodes.find((n: any) => n.id === 'bare') as any;
    expect(bare.type).toBe('imageGen');
    expect('parentId' in bare).toBe(false);   // 旧实现此处为 null——收编后键消失
    expect('position' in bare).toBe(false);   // 旧实现此处为 {x:0,y:0} 兜底——键消失
    expect('width' in bare).toBe(false);
    expect(bare.data).toEqual({});
  });

  it('edges 单形状键集锁定（R1a 语义锁保留——toEqual 键集敏感）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    const { edges } = await service.readCanvas('p1');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ id: 'e1', source: 'full', target: 'bare' }); // 无双键名别名键
  });
});

describe('O0b-0 版本门 v2.1（REST 读入口 fail-closed——第五行：v1 档拒+明确信息，非按 abs 解释 rel 静默错位）', () => {
  it('戳=2 放行（盖章夹具正常返回）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).resolves.toBeTruthy();
  });

  it('戳=1（人为写 1）拒——v1 旧档 fail-closed', async () => {
    const doc = buildDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).rejects.toThrow(/schemaVersion/);
  });

  it('无戳∧有节点 拒（裸 doc 手建节点不经 fillDoc——终裁 92 构造纪律防假绿）', async () => {
    const doc = buildDoc(); // buildDoc 无戳+有节点——门档构造纪律形态
    const service = buildService(doc);
    await expect(service.readCanvas('p1')).rejects.toThrow(/schemaVersion/);
  });

  it('无戳∧零节点 放行（空画布合法档——REST 侧不盖戳）', async () => {
    const service = buildService(new Y.Doc());
    await expect(service.readCanvas('p1')).resolves.toEqual({ nodes: [], edges: [] });
  });

  it('sv 下 v1 档同样拒（第五行 sv 路径——门从全量 doc 读 meta，不依赖 sv 差量）', async () => {
    const doc = buildDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    const service = buildService(doc);
    const sv = Y.encodeStateVector(new Y.Doc()); // 客户端空 sv——等待语义与门无关
    await expect(service.readCanvas('p1', sv, 50)).rejects.toThrow(/schemaVersion/);
  });

  it('sv 下 v2 档正常返回（门不退化 sv 等待路径——不因 gate 改全量读语义）', async () => {
    const doc = buildDoc();
    stampDocSchema(toDocLike(doc));
    const service = buildService(doc);
    const sv = Y.encodeStateVector(doc);
    await expect(service.readCanvas('p1', sv, 50)).resolves.toBeTruthy();
    expect(CANVAS_DOC_SCHEMA_VERSION).toBe(2);
  });
});
