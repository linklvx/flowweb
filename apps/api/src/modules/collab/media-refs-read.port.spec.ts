// apps/api/src/modules/collab/media-refs-read.port.spec.ts
// C3a-7（质评 I-3）：CollabMediaRefsReadAdapter 语义单测——节点不存在→null；节点在册零引用→[]；
// 引用集→MediaRef[]（collectMediaRefsForNode 单源）；withSession 抛 ServiceUnavailableException
// 原样透传；读路径 opts.mode='read'（不得被写成 write）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { CollabMediaRefsReadAdapter } from './media-refs-read.port';
import { CollabDocumentService } from './collab-document.service';

function setup(doc: Y.Doc) {
  const withSession = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));
  const adapter = new CollabMediaRefsReadAdapter({ withSession } as unknown as CollabDocumentService);
  return { adapter, withSession };
}

/** 真实 Y.Doc 节点形态：nodes map→nodeId→Y.Map{data: Y.Map}（plain object 不被 collect 认）。 */
function docWithNode(nodeId: string, data: Record<string, unknown> = {}): Y.Doc {
  const doc = new Y.Doc();
  const node = new Y.Map<unknown>();
  const nodeData = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(data)) nodeData.set(k, v);
  node.set('data', nodeData);
  doc.getMap('nodes').set(nodeId, node);
  return doc;
}

describe('C3a-7 CollabMediaRefsReadAdapter：doc 源节点引用读端口', () => {
  it('① 节点不在 doc→null（controller 分档 400 SOURCE_NODE_MISSING 的输入形态）', async () => {
    const doc = new Y.Doc();
    try {
      const { adapter } = setup(doc);
      await expect(adapter.readNodeRefs('p1', 'n-missing')).resolves.toBeNull();
    } finally {
      doc.destroy();
    }
  });

  it('② 节点在册零引用→[]（按引用集判归属——空集不是 null）', async () => {
    const doc = docWithNode('n1');
    try {
      const { adapter } = setup(doc);
      await expect(adapter.readNodeRefs('p1', 'n1')).resolves.toEqual([]);
    } finally {
      doc.destroy();
    }
  });

  it('③ data.fileId→[{nodeId,mediaId,role,targetField,targetItemId}]；withSession 第三参 {mode:"read"}', async () => {
    const doc = docWithNode('n1', { fileId: 'm1' });
    try {
      const { adapter, withSession } = setup(doc);
      await expect(adapter.readNodeRefs('p1', 'n1')).resolves.toEqual([
        { nodeId: 'n1', mediaId: 'm1', role: 'primary', targetField: 'fileId', targetItemId: '' },
      ]);
      expect(withSession).toHaveBeenCalledWith('p1', expect.any(Function), { mode: 'read' });
    } finally {
      doc.destroy();
    }
  });

  it('④ withSession 抛 ServiceUnavailableException→原样透传（lease 失守/维护窗 503 档）', async () => {
    const err = new ServiceUnavailableException('collab not serving (lease not held)');
    const withSession = vi.fn().mockRejectedValue(err);
    const adapter = new CollabMediaRefsReadAdapter({ withSession } as unknown as CollabDocumentService);
    await expect(adapter.readNodeRefs('p1', 'n1')).rejects.toBe(err);
  });
});
