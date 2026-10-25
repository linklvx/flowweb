// apps/api/src/gate-canvas-state.ts
// A0-0 门禁画布二进制纯构造（自 gate-seed.ts 抽出——O0c-3 gate-seed 验收断言消费；本模块零
// prisma/auth 副作用可单测，gate-seed.ts 消费同函数=构造单源）。构造契约：gate-node-1/2 保留 +
// auto 组 + 分镜组 + meta 戳；fillDoc 走 shared docShape 咽喉——禁自建 Y.Map 绕过。
// tsx 直跑消费 dist——片尾必须 pnpm --filter @flowweb/shared build。
import * as Y from 'yjs';
import { fillDoc, type DocLike, type DocMapLike, type TextLike, type XmlFragmentLike, type XmlElementLike, type XmlTextLike, type YArrayLike } from '@flowweb/shared';

/** Y.Doc→DocLike 结构性适配（doc-like.util 同构——gate 侧不 import api src 编译面外的模块；
 *  Y1c T15 增 createText——Y.Text 域容器物化工厂；Y1c T17 增 createArray——媒体列表域容器物化）。 */
export function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
    createText: () => new Y.Text() as unknown as TextLike,
    createXmlFragment: () => new Y.XmlFragment() as unknown as XmlFragmentLike,
    createXmlElement: (name) => new Y.XmlElement(name) as unknown as XmlElementLike,
    createXmlText: () => new Y.XmlText() as unknown as XmlTextLike,
    createArray: () => new Y.Array() as unknown as YArrayLike,
  };
}

/** 画布 yjs 快照（O0b-0 一次到位——doc=abs 空间 v2 档）：
 *  - gate-node-1/2 保留不动（a0-0-env.spec:27-28 兼容）
 *  - auto 组 1（组+2 子：组无帧三键[键集表]、子带 abs position）
 *  - 分镜组 1（组带 position+storyboard 完整 config——T17 cells 派生删；分镜子无 position
 *    带 width/height+slot 格位）
 *  - T18：meta 零键（版本承载=CanvasDoc.schemaVersion PG 列——建行 @default(3)）
 *  collab.gateway.loadDocument 直接 applyUpdate 本二进制。 */
export function buildGateCanvasState(): Buffer {
  const doc = new Y.Doc();
  const docLike = toDocLike(doc);
  fillDoc(docLike, [
    // gate-node-1/2（a0-0 兼容——顶层 abs）
    { id: 'gate-node-1', type: 'videoGen', position: { x: 0, y: 0 }, data: {} },
    { id: 'gate-node-2', type: 'videoGen', position: { x: 360, y: 120 }, data: {} },
    // auto 组 1（组无帧三键——键集表"auto/collapsed 组=0 帧键"；子带 abs position）
    { id: 'gate-auto-group', type: 'group', data: { groupType: 'normal', name: 'Gate Auto 组' } },
    // Y1c T15：textInput 域键随创建补齐（prompt=Y.Map{text:Y.Text} 容器——fillDoc 物化）
    { id: 'gate-auto-child-1', type: 'textInput', parentId: 'gate-auto-group', position: { x: 40, y: 70 }, width: 200, height: 80, data: { content: 'auto child 1', prompt: { text: '' } } },
    { id: 'gate-auto-child-2', type: 'textInput', parentId: 'gate-auto-group', position: { x: 280, y: 70 }, width: 200, height: 80, data: { content: 'auto child 2', prompt: { text: '' } } },
    // 分镜组 1（组带 position；storyboard 完整 config——T17：cells 派生不落 doc；分镜子无
    // position 带 width/height+slot 格位真源）
    { id: 'gate-sb-group', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' } } },
    { id: 'gate-sb-cell-1', type: 'imageGen', parentId: 'gate-sb-group', width: 320, height: 180, data: { status: 'done', slot: 0 } },
    { id: 'gate-sb-cell-2', type: 'imageGen', parentId: 'gate-sb-group', width: 320, height: 180, data: { status: 'idle', slot: 1 } },
  ], [
    { id: 'gate-edge-1', source: 'gate-node-1', target: 'gate-node-2' },
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}
