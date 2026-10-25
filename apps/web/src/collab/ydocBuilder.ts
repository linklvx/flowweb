// Y.Doc 结构构造/反序列化——O0a-1 收编薄委托：实现单源 shared/canvas/docShape（fillDoc/
// applyRecordToYMap——DocLike 结构性入参），本文件仅承担 Y.Doc→DocLike
// 类型适配（createMap 工厂注入，零行为）+ CanvasNodeRecord 快照面→StoredNodeRecord 桥。
// 调用点>10 处（生产 2+测试 6 文件）——plan 授权留 re-export 形态薄委托并注明 O0b 拆。
// Y1c T4：读出口改道 doc-codec.toReadModel（readRecordsFromMaps 收编 codec 内部——readCanvasFromDoc
// =全 web 读入口薄委托不变，出口 read model 同形）。
import * as Y from 'yjs';
import {
  fillDoc as fillDocShapes,
  toReadModel,
  applyRecordToYMap as applyRecordToMap,
  toDocRecord,
  type DocLike, type DocMapLike, type StoredNodeRecord, type DocEdgeRecord, type TextLike,
  type XmlFragmentLike, type XmlElementLike, type XmlTextLike,
  type CanvasNodeRecord,
} from '@flowweb/shared';

export { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';

export interface PlainEdge {
  id: string;
  source?: string;
  target?: string;
}

/** Y.Doc→DocLike 结构性适配（零行为——getMap 直通/createMap 注入 Y.Map 工厂；Y.Map 结构兼容
 *  DocMapLike 单 cast 断言，方法全在。Y1c T15 增 createText——Y.Text 域容器物化工厂，fillDoc
 *  创建 seam 消费；Y1c T16 增三 XML 工厂——XmlFragment 域容器物化）。 */
export function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
    createText: () => new Y.Text() as unknown as TextLike,
    createXmlFragment: () => new Y.XmlFragment() as unknown as XmlFragmentLike,
    createXmlElement: (name) => new Y.XmlElement(name) as unknown as XmlElementLike,
    createXmlText: () => new Y.XmlText() as unknown as XmlTextLike,
  };
}

export function buildDocFromSnapshot(nodes: CanvasNodeRecord[], edges: PlainEdge[]): Y.Doc {
  const doc = new Y.Doc();
  fillDoc(doc, nodes.map(toDocRecord), edges);
  return doc;
}

export function fillDoc(
  doc: Y.Doc,
  records: readonly StoredNodeRecord[],
  edges: readonly PlainEdge[],
): void {
  fillDocShapes(toDocLike(doc), records, edges as readonly DocEdgeRecord[]);
}

/** doc 直读（O0a-1 出口=作者态 StoredNodeRecord 可选键——doc 无键⇄records 同形无键，三层表；
 *  分镜子 cs {0,0} 构造默认由消费面（applyDocToStore hydrate）补齐。Y1c T4：实现改道
 *  doc-codec.toReadModel（readRecordsFromMaps 收编单源——v3 纯 JSON 值逐位同出口零行为变更）。 */
export function readCanvasFromDoc(doc: Y.Doc): { nodes: StoredNodeRecord[]; edges: PlainEdge[] } {
  return toReadModel(doc);
}

/** 增量写（createMap 工厂注入——Y.Map 无自建方法）。仅测试消费（生产写路径已收口 canvasIntents）。 */
export function applyRecordToYMap(m: Y.Map<any>, r: StoredNodeRecord): void {
  applyRecordToMap(m as unknown as DocMapLike, r, () => new Y.Map() as unknown as DocMapLike);
}
