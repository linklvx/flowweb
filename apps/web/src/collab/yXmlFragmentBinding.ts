// apps/web/src/collab/yXmlFragmentBinding.ts
// Y1c T16（plan v1.7 卡）：XmlFragment 域 Tiptap 双端绑定装置——y-prosemirror ySyncPlugin
// 直绑嵌套 fragment（spec v5-7：Tiptap 富文本正文/prompt=XmlFragment，不得当纯文本、不得留
// 过渡形状）。三件：
//   ① resolveNodeXmlFragment：doc→nodes→entry→data→域键 容器解析（**零懒建**——T15 容器规则：
//      缺容器=结构错误，调用方走只读回退渲染，不掩盖）；
//   ② ySyncHostExtension：Tiptap Extension 包 ySyncPlugin（plugin 首次事务前注册——editor
//      构造即挂；S3 spike 结论③：ySyncPlugin 事务 origin=ySyncPluginKey≠LocalUser ⇒ T16 必须
//      addTrackedOrigin〔canvasUndo.attachUndoManager 落〕）；
//   ③ richTextOfFragment re-export：getHTML 只读导出（PromptValue 三出口的 shared 单源派生
//      ——doc-codec RichTextValue{text,html,json}；禁第二实现）。
// 单 editor 实例（全屏/工具栏复用——TextInputNode 形态）；不挂 yUndoPlugin（单 manager——
// T18；spec §3.3）。editor content 恒 ''（fragment 权威——view() _forceRerender 初始装载）。
import * as Y from 'yjs';
import { Extension } from '@tiptap/react';
import { ySyncPlugin } from 'y-prosemirror';
import { richTextOfFragment, type RichTextValue } from '@flowweb/shared';

/** doc→node→data→域键 的 XmlFragment 容器解析（零懒建——缺=结构错误返回 null）。 */
export function resolveNodeXmlFragment(doc: Y.Doc | null, nodeId: string, key: string): Y.XmlFragment | null {
  if (!doc) return null;
  const entry: unknown = doc.getMap('nodes').get(nodeId);
  if (!(entry instanceof Y.Map)) return null;
  const data: unknown = entry.get('data');
  if (!(data instanceof Y.Map)) return null;
  const frag: unknown = data.get(key);
  return frag instanceof Y.XmlFragment ? frag : null;
}

/** ySyncPlugin 宿主 Extension（plugin 首次事务前注册——editor extensions 构造面单点）。 */
export function ySyncHostExtension(fragment: Y.XmlFragment) {
  return Extension.create({
    name: 'ySyncHost',
    addProseMirrorPlugins() {
      return [ySyncPlugin(fragment)];
    },
  });
}

/** 只读导出（getHTML 只读——禁经 editor 状态派生写回）：fragment→RichTextValue 单源走
 *  shared doc-codec，面板/执行读面同形。 */
export { richTextOfFragment, type RichTextValue };
