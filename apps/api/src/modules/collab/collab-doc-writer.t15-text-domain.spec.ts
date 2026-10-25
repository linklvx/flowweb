// apps/api/src/modules/collab/collab-doc-writer.t15-text-domain.spec.ts
// Y1c T15（plan v1.7 卡）——服务端写 seam（applyWriteNodeDataToDoc 原语——deliverArtifact 直调面，
// 先于 writeBatch Z108 键白名单〔SERVER_NODE_DATA_KEYS 不含 prompt——writeBatch 路径已结构性拒〕）
// 红绿用例。两条红轴（卡文「先红」逐字，服务端半边）：
//   红① 整串覆盖写被拒：原语对 Y.Text 域键（audioGen.prompt 等）整串 patch=容器替换对抗面
//       ——服务端无 splice 写腿，一律守卫拒绝（written:false+reason），容器不被动；
//   红② 缺容器=拒绝不懒建：节点缺 data Y.Map 时拒绝（现状：懒建 data Map 后照写——掩盖结构错误）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyWriteNodeDataToDoc } from './collab-document.service';

/** 手建 audioGen 节点（种子独立于被测实现——fillDoc 物化前红阶段可达）。 */
function seedAudioNode(doc: Y.Doc, id = 'a1', opts?: { promptContainer?: string }) {
  const data = new Y.Map();
  data.set('model', 'm-audio');
  if (opts?.promptContainer !== undefined) data.set('prompt', new Y.Text(opts.promptContainer));
  const n = new Y.Map();
  n.set('type', 'audioGen');
  n.set('data', data);
  doc.getMap('nodes').set(id, n);
  return { node: n, data };
}

describe('Y1c T15 服务端写 seam 原语：Y.Text 域整串覆盖拒 + 缺容器不懒建', () => {
  it('红①：audioGen.prompt=Y.Text 容器上原语写 {prompt:string} ⇒ written:false 拒绝+容器原样（现状红：整串 set 替换容器）', () => {
    const doc = new Y.Doc();
    const { data } = seedAudioNode(doc, 'a1', { promptContainer: 'abc' });
    const r = applyWriteNodeDataToDoc(doc, 'a1', { prompt: 'whole-overwrite' });
    expect(r.written).toBe(false);
    expect(data.get('prompt') instanceof Y.Text).toBe(true);
    expect((data.get('prompt') as Y.Text).toString()).toBe('abc');
  });

  it('红① 同型：textInput.prompt=Y.Map{text} 域键同拒（域词表跨三型生效）', () => {
    const doc = new Y.Doc();
    const promptMap = new Y.Map();
    promptMap.set('text', new Y.Text('面板词'));
    const data = new Y.Map();
    data.set('prompt', promptMap);
    const n = new Y.Map();
    n.set('type', 'textInput');
    n.set('data', data);
    doc.getMap('nodes').set('t1', n);
    const r = applyWriteNodeDataToDoc(doc, 't1', { prompt: { text: 'server-write' } });
    expect(r.written).toBe(false);
    expect(((data.get('prompt') as Y.Map<unknown>).get('text') as Y.Text).toString()).toBe('面板词');
  });

  it('红②：节点缺 data Y.Map ⇒ written:false 拒绝不懒建（现状红：懒建 data Map 后照写）', () => {
    const doc = new Y.Doc();
    const n = new Y.Map();
    n.set('type', 'audioGen');
    doc.getMap('nodes').set('a2', n);
    const r = applyWriteNodeDataToDoc(doc, 'a2', { fileId: 'f9' });
    expect(r.written).toBe(false);
    expect(n.has('data')).toBe(false);
  });

  it('非域键写不受影响（fileId 服务端域照写——deliverArtifact 语义回归锚）', () => {
    const doc = new Y.Doc();
    const { data } = seedAudioNode(doc, 'a1', { promptContainer: 'abc' });
    const r = applyWriteNodeDataToDoc(doc, 'a1', { fileId: 'f1' });
    expect(r.written).toBe(true);
    expect(data.get('fileId')).toBe('f1');
    expect((data.get('prompt') as Y.Text).toString()).toBe('abc');
  });
});

describe('T15 收口 B①（Q-I-2）：api 逐键拒对称化——混 patch 域键 skip 非域键照写（与 web 同尺）', () => {
  it('混 patch {prompt,model}：written:true+model 落+prompt 容器原样（现状红：整 op 拒 model 丢）', () => {
    const doc = new Y.Doc();
    const { data } = seedAudioNode(doc, 'a1', { promptContainer: 'abc' });
    const r = applyWriteNodeDataToDoc(doc, 'a1', { prompt: 'whole-overwrite', model: 'm2' });
    expect(r.written).toBe(true);                          // 至少一键落=true（A1 语义：written=有写入）
    expect(data.get('model')).toBe('m2');                  // 非域键照写（现状红：整 op 拒连带丢）
    expect(data.get('prompt') instanceof Y.Text).toBe(true);
    expect((data.get('prompt') as Y.Text).toString()).toBe('abc');
  });

  it('全域键 patch 仍 written:false（text-domain-protected 档不变）+空 patch 维持 written:true no-op', () => {
    const doc = new Y.Doc();
    const { data } = seedAudioNode(doc, 'a1', { promptContainer: 'abc' });
    expect(applyWriteNodeDataToDoc(doc, 'a1', { prompt: 'x' })).toMatchObject({ written: false, reason: 'text-domain-protected' });
    expect(applyWriteNodeDataToDoc(doc, 'a1', {})).toEqual({ written: true });
    expect((data.get('prompt') as Y.Text).toString()).toBe('abc');
  });
});
