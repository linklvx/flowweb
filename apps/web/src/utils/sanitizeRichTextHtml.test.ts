// Y4b Task 5（D10）：DOMPurify 兜底单源出口单测——四类攻击串剥除 + 正例=真实 fragment 走
// richTextOfFragment（spec §0 条 8：白名单按 codec 真输出——HTML 解析收小写，断言小写标签；
// 禁手写 <h1><ul> 假正例）+ TextInputNode 现有 `<p>一只猫在窗台上</p>` 回退档兼容。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { richTextOfFragment } from '@flowweb/shared';
import { sanitizeRichTextHtml } from './sanitizeRichTextHtml';

describe('sanitizeRichTextHtml（D10 兜底——DOMPurify 单源出口）', () => {
  // ── 四类攻击串（fallback-only 可达面：回退 HTML 直吐 dangerouslySetInnerHTML 前消毒）──
  it('① <img src=x onerror=…>：剥 onerror 事件属性', () => {
    const out = sanitizeRichTextHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).toContain('<img');
  });

  it('② <script>alert(1)</script>：整剥 script 标签', () => {
    const out = sanitizeRichTextHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('③ <a href="javascript:…">：剥 a 与 href', () => {
    const out = sanitizeRichTextHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a');
    expect(out).toContain('x');
  });

  it('④ <style> 与 style 属性：剥标签与属性', () => {
    const out = sanitizeRichTextHtml('<style>body{color:red}</style><div style="color:red">t</div>');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('body{color:red}');
    expect(out).not.toContain('style=');
    expect(out).toContain('t');
  });

  // ── 正例=真实 fragment 走 richTextOfFragment（Review Focus 5——codec 真输出形态）──
  it('真实 fragment（heading+bulletList/listItem+img+command）消毒后小写标签与 media-id、label 都在', () => {
    // fragment 与生产同形=住 Y.Doc（Yjs XML 类型须 attach 后才可读——detached toArray 抛
    // Invalid access；先例 doc-codec.roundtrip.spec.ts:130 零散建+transact set 挂 doc）
    const doc = new Y.Doc();
    const frag = new Y.XmlFragment();
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', '2');
    const headingText = new Y.XmlText();
    headingText.insert(0, '标题');
    heading.insert(0, [headingText]);
    const bulletList = new Y.XmlElement('bulletList');
    const listItem = new Y.XmlElement('listItem');
    const itemText = new Y.XmlText();
    itemText.insert(0, '列表项');
    listItem.insert(0, [itemText]);
    bulletList.insert(0, [listItem]);
    const img = new Y.XmlElement('image');
    img.setAttribute('src', 'media-abc');
    const command = new Y.XmlElement('command');
    command.setAttribute('id', 'cmd-1');
    command.setAttribute('label', '美化画面');
    frag.insert(0, [heading, bulletList, img, command]);
    doc.transact(() => { doc.getMap('nodes').set('f', frag); });
    const html = richTextOfFragment(frag).html;
    // codec 真输出=驼峰标签原样当标签（nodeHtmlOf 其余元素名分支；image 恒带 alt——:237）
    expect(html).toContain('<heading level="2">');
    expect(html).toContain('<bulletList>');
    expect(html).toContain('<listItem>');
    expect(html).toContain('<img src="media-abc" alt="">');
    expect(html).toContain('<command id="cmd-1" label="美化画面">');

    const out = sanitizeRichTextHtml(html);
    // DOMPurify HTML 解析收小写——断言小写标签（禁断言驼峰原样留下）
    expect(out).toContain('<heading level="2">');
    expect(out).toContain('<bulletlist>');
    expect(out).toContain('<listitem>');
    expect(out).toContain('<command');
    expect(out).toContain('<img');
    expect(out).toContain('media-abc');
    expect(out).toContain('美化画面');
  });

  // ── TextInputNode 现有回退档兼容（`<p>一只猫在窗台上</p>` 仍过）──
  it('<p>一只猫在窗台上</p> 消毒后原样保留', () => {
    const out = sanitizeRichTextHtml('<p>一只猫在窗台上</p>');
    expect(out).toContain('<p>一只猫在窗台上</p>');
  });
});
