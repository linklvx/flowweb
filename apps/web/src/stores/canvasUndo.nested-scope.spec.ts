// apps/web/src/stores/canvasUndo.nested-scope.spec.ts
// Y1c T0-B（plan v1.7 Task 0 spike S3）：UndoManager([nodes,edges]) 对嵌套 Y.Text/Y.Map/XmlFragment
// 变更捕获实证（changedParentTypes 父链）——证明 addToScope 不需要。
//
// 【机制】（yjs 13.6.32 源码引证）：
//  · AbstractType.js callTypeObservers :241-255——每个变更（最深）类型沿 _item.parent 链上行，
//    把**每一级祖先**都记入 transaction.changedParentTypes（键=祖先类型）；
//  · UndoManager.js afterTransactionHandler :210-218——捕获谓词=scope.some(type =>
//    transaction.changedParentTypes.has(type) || type===doc)：tracked root 命中任一祖先键即捕获。
//  ⇒ 嵌套在 nodes/edges 根之下的任意深度类型变更，天然入栈——无需 addToScope。
//  本套件在 T15/T16 目标形状（data.content:Y.Text / prompt:Y.Map{text:Y.Text} / prompt:XmlFragment
//  及 XML 深链）上行为级锁定该结论；真 attachUndoManager（生产接线形态：scope=[nodes,edges]/
//  trackedOrigins=[LocalUser]/captureTimeout 500——T18 单 manager 卡的基座）。
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { attachUndoManager, detachUndoManager, stopCapturing, Origin } from './canvasUndo';

/** T15/T16 目标 v4 形状节点：nodes/<id> = {type, data:{content:Y.Text, prompt:Y.Map{text:Y.Text},
 *  rich:Y.XmlFragment}}——三域嵌套容器（容器规则=结构创建时一次性建） */
function makeV4Node(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const entry = new Y.Map();
    entry.set('type', 'textInput');
    const data = new Y.Map();
    data.set('content', new Y.Text());
    const prompt = new Y.Map();
    prompt.set('text', new Y.Text());
    data.set('prompt', prompt);
    data.set('rich', new Y.XmlFragment());
    entry.set('data', data);
    doc.getMap('nodes').set(id, entry);
  });
}

const contentText = (doc: Y.Doc, id: string): Y.Text =>
  ((doc.getMap('nodes').get(id) as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('content') as Y.Text;
const promptText = (doc: Y.Doc, id: string): Y.Text =>
  (((doc.getMap('nodes').get(id) as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('prompt') as Y.Map<unknown>).get('text') as Y.Text;
const richFrag = (doc: Y.Doc, id: string): Y.XmlFragment =>
  ((doc.getMap('nodes').get(id) as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('rich') as Y.XmlFragment;

describe('Y1c T0-S3 UndoManager 嵌套 scope 父链实证（addToScope 不需要）', () => {
  afterEach(() => detachUndoManager());

  it('嵌套 data.content:Y.Text 编辑（nodes 根下三层）——origin=LocalUser 捕获+undo/redo 完整', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    expect(um.undoStack.length).toBe(0);   // 结构创建同 origin=LocalUser?——makeV4Node 无 origin（null）不入栈
    doc.transact(() => contentText(doc, 'n1').insert(0, 'hello'), Origin.LocalUser);
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(contentText(doc, 'n1').toString()).toBe('');
    um.redo();
    expect(contentText(doc, 'n1').toString()).toBe('hello');
    doc.destroy();
  });

  it('prompt:Y.Map{text:Y.Text}（四层嵌套）——捕获+undo 恢复', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    doc.transact(() => promptText(doc, 'n1').insert(0, 'p1'), Origin.LocalUser);
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(promptText(doc, 'n1').toString()).toBe('');
    doc.destroy();
  });

  it('data.rich:Y.XmlFragment（Map 下挂 XmlFragment）——元素插入/属性/文本三操作捕获+undo 清空', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    doc.transact(() => {
      const p = new Y.XmlElement('p');
      p.setAttribute('align', 'center');
      richFrag(doc, 'n1').insert(0, [p]);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, 'rich-text');
    }, Origin.LocalUser);
    expect(richFrag(doc, 'n1').toString()).toBe('<p align="center">rich-text</p>');
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(richFrag(doc, 'n1').toString()).toBe('');
    um.redo();
    expect(richFrag(doc, 'n1').toString()).toBe('<p align="center">rich-text</p>');
    doc.destroy();
  });

  it('XML 深链（XmlFragment>XmlElement>XmlElement>text）——深子树捕获+undo', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    doc.transact(() => {
      const frag = richFrag(doc, 'n1');
      const outer = new Y.XmlElement('div');
      const inner = new Y.XmlElement('span');
      frag.insert(0, [outer]);
      outer.insert(0, [inner]);
      const t = new Y.XmlText();
      inner.insert(0, [t]);
      t.insert(0, 'deep');
    }, Origin.LocalUser);
    expect(richFrag(doc, 'n1').toString()).toBe('<div><span>deep</span></div>');
    um.undo();
    expect(richFrag(doc, 'n1').toString()).toBe('');
    doc.destroy();
  });

  it('异 origin 不入栈（AutoEdge/remote applyUpdate）——trackedOrigins 过滤对嵌套形状同样生效', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    doc.transact(() => contentText(doc, 'n1').insert(0, 'auto'), Origin.AutoEdge);
    // remote 形态：他端 update 经 applyUpdate 进本端 doc（origin=provider 连接对象，非 LocalUser）
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const rText = contentText(remote, 'n1');
    remote.transact(() => rText.insert(0, 'remote-'));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect(contentText(doc, 'n1').toString()).toBe('remote-auto');
    expect(um.undoStack.length).toBe(0);   // 两路均不入栈——撤销栈只收本端 LocalUser
    doc.destroy(); remote.destroy();
  });

  it('栈粒度与 scope 精度：两次嵌套编辑=两栈项；undo 只回滚本项内容（兄弟节点不动）', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    makeV4Node(doc, 'n2');
    doc.transact(() => contentText(doc, 'n1').insert(0, 'a'), Origin.LocalUser);
    stopCapturing();
    doc.transact(() => contentText(doc, 'n2').insert(0, 'b'), Origin.LocalUser);
    expect(um.undoStack.length).toBe(2);
    um.undo();   // 只回滚 n2 的 'b'
    expect(contentText(doc, 'n1').toString()).toBe('a');
    expect(contentText(doc, 'n2').toString()).toBe('');
    um.undo();   // 再回滚 n1 的 'a'
    expect(contentText(doc, 'n1').toString()).toBe('');
    doc.destroy();
  });

  it('edges 根同形（边 entry 内嵌套 Y.Text 变更亦捕获）+整节点删除基线', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    makeV4Node(doc, 'n1');
    doc.transact(() => {
      const e = new Y.Map();
      e.set('label', new Y.Text());
      doc.getMap('edges').set('e1', e);
    });   // origin=null——结构创建不入栈
    doc.transact(() => {
      ((doc.getMap('edges').get('e1') as Y.Map<unknown>).get('label') as Y.Text).insert(0, 'L');
    }, Origin.LocalUser);
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(((doc.getMap('edges').get('e1') as Y.Map<unknown>).get('label') as Y.Text).toString()).toBe('');
    // 基线：根级整节点删除（现行 undo 主路径）仍捕获
    doc.transact(() => doc.getMap('nodes').delete('n1'), Origin.LocalUser);
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(doc.getMap('nodes').has('n1')).toBe(true);
    doc.destroy();
  });
});
