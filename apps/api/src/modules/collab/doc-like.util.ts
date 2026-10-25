// apps/api/src/modules/collab/doc-like.util.ts
// O0a-2（Spec B）：Y.Doc→DocLike 结构性适配——web ydocBuilder.toDocLike 同款手法（零行为）。
// api 侧不可 import apps/web（防第二真源），api 无法共享其实现——同构五行适配在此落位。
// Y1c T15 增 createText：Y.Text 域容器物化工厂（fillDoc 创建 seam——text-domains 单源消费）。
// Y1c T16 增三 XML 工厂：XmlFragment 域容器物化（fillDoc 创建 seam——xml-schema 单源消费）。
import * as Y from 'yjs';
import { type DocLike, type DocMapLike, type TextLike, type XmlFragmentLike, type XmlElementLike, type XmlTextLike } from '@flowweb/shared';

export function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
    createText: () => new Y.Text() as unknown as TextLike,
    createXmlFragment: () => new Y.XmlFragment() as unknown as XmlFragmentLike,
    createXmlElement: (name: string) => new Y.XmlElement(name) as unknown as XmlElementLike,
    createXmlText: () => new Y.XmlText() as unknown as XmlTextLike,
  };
}
