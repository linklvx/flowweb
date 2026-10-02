// apps/api/src/modules/collab/doc-like.util.ts
// O0a-2（Spec B）：Y.Doc→DocLike 结构性适配——web ydocBuilder.toDocLike 同款手法（零行为）。
// api 侧不可 import apps/web（防第二真源），api 无法共享其实现——同构五行适配在此落位。
import * as Y from 'yjs';
import { type DocLike, type DocMapLike } from '@flowweb/shared';

export function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}
