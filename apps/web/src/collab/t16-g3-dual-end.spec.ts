// apps/web/src/collab/t16-g3-dual-end.spec.ts
// Y1c T16 G3 门主体（plan v1.7 卡）——真 Tiptap 编辑器+ySyncPlugin 双端（两 Y.Doc 帧交换）用例：
// 双端并发格式化/mention 插入/图片引用（mediaId）/粘贴/删除节点 fragment 随子树/undo 重建恢复+
// PromptValue 三出口。装置=两编辑器各绑己方 doc 的同 node 同域 XmlFragment（创建 seam 物化），
// 帧交换 Y.encodeStateAsUpdate ⇄ applyUpdate——真双端（非单 doc 模拟）。
// G3 go/no-go：任一失败=调容器或绑定（禁 JSON 垫片——卡文明令）。gate-evidence/g3.json 消费本套。
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/react';
import { richTextOfFragment, referencedMediaIdsOf } from '@flowweb/shared';
import { referencedImageIdsOf } from '../stores/nodeStore';
import { resolveNodeXmlFragment, ySyncHostExtension } from './yXmlFragmentBinding';
import { buildTextContentSchemaExtensions } from '../pages/canvas/components/nodes/textExtensions';
import { buildPromptInputSchemaExtensions } from '../pages/canvas/components/nodes/prompt-input/extensions';
import { attachUndoManager, detachUndoManager, Origin } from '../stores/canvasUndo';

/** 微任务槽（y-prosemirror 观察者/PM dispatch 收敛——sync 主体+slot 保险）。 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 创建 seam 物化节点（fillDoc 同语义直构：type/data/域容器——T15/T16 容器规则）。 */
function seedNode(doc: Y.Doc, nodeId: string, type: string, domainKey: string): Y.XmlFragment {
  const frag = new Y.XmlFragment();
  doc.transact(() => {
    const data = new Y.Map();
    data.set(domainKey, frag);
    const n = new Y.Map();
    n.set('type', type);
    n.set('data', data);
    doc.getMap('nodes').set(nodeId, n);
  });
  return frag;
}

const editors: Editor[] = [];
function makeEditor(fragment: Y.XmlFragment, domain: 'text' | 'prompt'): Editor {
  const extensions = domain === 'text'
    ? buildTextContentSchemaExtensions()
    : buildPromptInputSchemaExtensions({
        placeholder: 'g3',
        imageNodeView: () => ({ dom: document.createElement('span') }),
        commandItems: () => [],
        commandRender: () => ({ onStart: () => {}, onUpdate: () => {}, onExit: () => {} }),
        imageMentionItems: () => [],
        imageMentionRender: () => ({ onStart: () => {}, onUpdate: () => {}, onExit: () => {} }),
        imageMentionCommand: () => {},
      });
  const ed = new Editor({
    extensions: [...extensions, ySyncHostExtension(fragment)],
    content: '',
  });
  editors.push(ed);
  return ed;
}

/** 帧交换（全量互灌——并发回合后双端收敛）。 */
function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  detachUndoManager();
});

describe('Y1c T16 G3：XmlFragment+Tiptap 双端（text 域 content——真编辑器双 doc）', () => {
  it('G3-1 双端并发格式化+文本插入：合并后两方内容均在+格式保持+双端收敛（树合法）', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const fragA = seedNode(docA, 't1', 'textInput', 'content');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const fragB = resolveNodeXmlFragment(docB, 't1', 'content')!;

    const edA = makeEditor(fragA, 'text');
    const edB = makeEditor(fragB, 'text');
    await tick();

    // 并发回合：A 端插入加粗段落，B 端插入普通段落
    edA.commands.insertContent('<p><strong>A 端加粗</strong></p>');
    edB.commands.insertContent('<p>B 端正文</p>');
    exchange(docA, docB);
    await tick();

    const htmlA = edA.getHTML();
    const htmlB = edB.getHTML();
    expect(htmlA).toContain('A 端加粗');
    expect(htmlA).toContain('B 端正文');
    expect(htmlB).toBe(htmlA);                       // 双端收敛（树合法——同构渲染）
    expect(htmlA).toContain('<strong>');             // 格式保持（mark 合并不丢）
    const richA = richTextOfFragment(fragA);
    const richB = richTextOfFragment(fragB);
    expect(richA.text).toContain('A 端加粗');
    expect(richB.text).toBe(richA.text);             // 三出口基座同源
  });

  it('G3-2 粘贴（insertContent HTML 解析）+远端可见：双端一致', async () => {
    const docA = new Y.Doc();
    const fragA = seedNode(docA, 't1', 'textInput', 'content');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docA));
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const fragB = resolveNodeXmlFragment(docB, 't1', 'content')!;

    const edA = makeEditor(fragA, 'text');
    const edB = makeEditor(fragB, 'text');
    await tick();

    edA.commands.insertContent('<h2>粘贴标题</h2><p>粘贴正文</p>');
    exchange(docA, docB);
    await tick();

    expect(edA.getHTML()).toContain('粘贴标题');
    expect(edB.getHTML()).toContain('粘贴标题');
    expect(edB.getHTML()).toContain('粘贴正文');
    expect(edB.getHTML()).toBe(edA.getHTML());
  });

  it('G3-3 删除节点 fragment 随子树+undo 重建恢复（画布级单 manager——origin=ySyncPluginKey 入栈）', async () => {
    const docA = new Y.Doc();
    const fragA = seedNode(docA, 't1', 'textInput', 'content');
    const um = attachUndoManager(docA);

    const edA = makeEditor(fragA, 'text');
    await tick();
    edA.commands.insertContent('<p>待恢复正文</p>');
    um.stopCapturing();   // 分项（captureTimeout 500ms 内键入+删除会并项——undo 语义需分立）
    await tick();
    expect(richTextOfFragment(fragA).text).toContain('待恢复正文');

    // 键入入画布撤销栈（origin=ySyncPluginKey——S3 结论③ addTrackedOrigin 接线验证）
    expect(um.undoStack.length).toBeGreaterThanOrEqual(1);

    // 删除节点：fragment 随子树消失
    docA.transact(() => { docA.getMap('nodes').delete('t1'); }, Origin.LocalUser);
    expect(resolveNodeXmlFragment(docA, 't1', 'content')).toBeNull();

    // undo 重建恢复：节点+容器+内容回来
    um.undo();
    await tick();
    const restored = resolveNodeXmlFragment(docA, 't1', 'content');
    expect(restored).not.toBeNull();
    expect(richTextOfFragment(restored!).text).toContain('待恢复正文');
    // 重建后新编辑器绑定渲染恢复内容（组件重挂形态）
    const edR = makeEditor(restored!, 'text');
    await tick();
    expect(edR.getHTML()).toContain('待恢复正文');
  });

  it('G3-4 键入撤销：编辑器内容经画布级 manager 撤销回滚（单栈纪律——不挂 yUndoPlugin）', async () => {
    const docA = new Y.Doc();
    const fragA = seedNode(docA, 't1', 'textInput', 'content');
    const um = attachUndoManager(docA);
    const edA = makeEditor(fragA, 'text');
    await tick();

    edA.commands.insertContent('<p>第一段</p>');
    um.stopCapturing();
    await tick();
    edA.commands.insertContent('<p>第二段</p>');
    await tick();
    expect(um.undoStack.length).toBeGreaterThanOrEqual(2);

    um.undo();
    await tick();
    expect(richTextOfFragment(fragA).text).toContain('第一段');
    expect(richTextOfFragment(fragA).text).not.toContain('第二段');
    // PM 面同步回滚（远端 origin 变更 → isChangeOrigin 渲染）
    expect(edA.getHTML()).not.toContain('第二段');
  });
});

describe('Y1c T16 G3：XmlFragment+Tiptap 双端（prompt 域——mention/image/三出口）', () => {
  it('G3-5 双端并发 mention 插入+图片引用（mediaId）：合并后双端一致+referencedImageIds 派生', async () => {
    const docA = new Y.Doc();
    const fragA = seedNode(docA, 'i1', 'imageGen', 'prompt');
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const fragB = resolveNodeXmlFragment(docB, 'i1', 'prompt')!;

    const edA = makeEditor(fragA, 'prompt');
    const edB = makeEditor(fragB, 'prompt');
    await tick();

    // A 端：命令 mention + 文本；B 端：imageMention + 图片引用（src=mediaId——修正批#1）
    edA.commands.insertContent('<p>生成</p>');
    edA.commands.insertContent({ type: 'command', attrs: { id: 'cmd-style', label: '/风格' } });
    edB.commands.insertContent({ type: 'imageMention', attrs: { id: 'media-m2', label: '@素材' } });
    edB.commands.insertContent({ type: 'image', attrs: { src: 'media-img-1', alt: '参考图' } });
    exchange(docA, docB);
    await tick();

    expect(edA.getHTML()).toBe(edB.getHTML());       // 双端收敛
    const html = edA.getHTML();
    expect(html).toContain('生成');
    expect(html).toContain('cmd-style');
    expect(html).toContain('media-img-1');
    expect(html).toContain('media-m2');

    // PromptValue 三出口（PromptInput 生产面同源派生）
    const rich = richTextOfFragment(fragA);
    expect(rich.text).toContain('生成');
    expect(richTextOfFragment(fragB).text).toBe(rich.text);
    const ids = referencedMediaIdsOf(rich.json);
    expect(ids).toContain('cmd-style');
    expect(ids).toContain('media-img-1');
    expect(ids).toContain('media-m2');
    // web 出口薄委托同值（nodeStore referencedImageIdsOf）
    expect(referencedImageIdsOf(rich)).toEqual(ids);
  });

  it('G3-6 对抗语料客户端 PM 解析双验：未知元素经帧到达后客户端渲染删除（L1 之外的第二道）', async () => {
    const docA = new Y.Doc();
    const fragA = seedNode(docA, 'i1', 'imageGen', 'prompt');
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const fragB = resolveNodeXmlFragment(docB, 'i1', 'prompt')!;

    const edB = makeEditor(fragB, 'prompt');
    await tick();

    // 恶意端（绕过客户端）：fragA 直插未知元素（L1 拒帧构造同款——服务端拒；此处验第二道）
    docA.transact(() => {
      const evil = new Y.XmlElement('script');
      const t = new Y.XmlText();
      t.insert(0, 'xss');
      evil.insert(0, [t]);
      fragA.insert(0, [evil]);
      const ok = new Y.XmlElement('paragraph');
      const ot = new Y.XmlText();
      ot.insert(0, '合法段');
      ok.insert(0, [ot]);
      fragA.insert(1, [ok]);
    });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    await tick();

    // 客户端渲染面：未知元素被 y-prosemirror createNodeIfNotExists 删除（schema.node throw 兜底）
    //——合法段保留，script 不入 PM 树
    expect(edB.getHTML()).toContain('合法段');
    expect(edB.getHTML()).not.toContain('script');
    expect(edB.getHTML()).not.toContain('xss');
  });
});
