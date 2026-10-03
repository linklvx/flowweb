// apps/api/src/gate-canvas-state.ts
// A0-0 门禁画布二进制纯构造（自 gate-seed.ts 抽出——O0c-3 gate-seed 验收断言消费；本模块零
// prisma/auth 副作用可单测，gate-seed.ts 消费同函数=构造单源）。构造契约：gate-node-1/2 保留 +
// auto 组 + 分镜组 + meta 戳；fillDoc 走 shared docShape 咽喉——禁自建 Y.Map 绕过。
// tsx 直跑消费 dist——片尾必须 pnpm --filter @flowweb/shared build。
import * as Y from 'yjs';
import { fillDoc, stampDocSchema, type DocLike, type DocMapLike } from '@flowweb/shared';

/** Y.Doc→DocLike 结构性适配（doc-like.util 同构——gate 侧不 import api src 编译面外的模块） */
export function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

/** 画布 yjs 快照（O0b-0 一次到位——doc=abs 空间 v2 档）：
 *  - gate-node-1/2 保留不动（a0-0-env.spec:27-28 兼容）
 *  - auto 组 1（组+2 子：组无帧三键[键集表]、子带 abs position）
 *  - 分镜组 1（组带 position+storyboard 完整 config+cells；分镜子无 position 带 width/height）
 *  - meta 戳（stampDocSchema——WS loadDocument 版本门放行）
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
    { id: 'gate-auto-child-1', type: 'textInput', parentId: 'gate-auto-group', position: { x: 40, y: 70 }, width: 200, height: 80, data: { content: 'auto child 1' } },
    { id: 'gate-auto-child-2', type: 'textInput', parentId: 'gate-auto-group', position: { x: 280, y: 70 }, width: 200, height: 80, data: { content: 'auto child 2' } },
    // 分镜组 1（组带 position；storyboard 完整 config+cells；分镜子无 position 带 width/height）
    { id: 'gate-sb-group', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', cells: ['gate-sb-cell-1', 'gate-sb-cell-2'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' } } },
    { id: 'gate-sb-cell-1', type: 'imageGen', parentId: 'gate-sb-group', width: 320, height: 180, data: { status: 'done' } },
    { id: 'gate-sb-cell-2', type: 'imageGen', parentId: 'gate-sb-group', width: 320, height: 180, data: { status: 'idle' } },
  ], [
    { id: 'gate-edge-1', source: 'gate-node-1', target: 'gate-node-2' },
  ]);
  stampDocSchema(docLike);   // O0b-0：v2 戳（戳源唯一化——fillDoc 不写 meta）
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}
