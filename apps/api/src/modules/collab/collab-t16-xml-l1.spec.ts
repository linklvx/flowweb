// apps/api/src/modules/collab/collab-t16-xml-l1.spec.ts
// Y1c T16（plan v1.7 卡：XML 白名单 L1 同卡激活——偏离 38⑫，不留 P2 安全窗口）——gate
// frame-local struct 扫描对抗语料（spec §9.2「XmlFragment 对抗语料」api 侧半场；web 侧 PM 解析
// 双验在 apps/web xmlSchemaParity/t16 双端 spec）。
// 红轴：validateXmlL1（shared 单表 XML_ELEMENTS/MARKS/ATTRS 消费——T16 前不存在=import 红）。
// 语料七类（卡文）：未知元素/超深/超长/外链 attr URL/伪造 mention（未知 attr）/XmlHook/
// 嵌套 XmlFragment——全部拒帧；合法语料（paragraph/text/bold mark/image mediaId/mention 三键）放行。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { validateXmlL1 } from '@flowweb/shared';

/** 语料构造：textInput 节点 content=XmlFragment 域（T16 目标载体形态）。全量单 update 产出
 *  （帧内可解析链——depth/attr 执法面）。 */
function frameWith(mutate: (frag: Y.XmlFragment, doc: Y.Doc) => void): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const data = new Y.Map();
    const frag = new Y.XmlFragment();
    data.set('content', frag);
    const n = new Y.Map();
    n.set('type', 'textInput');
    n.set('data', data);
    doc.getMap('nodes').set('t1', n);
    mutate(frag, doc);
  });
  return Y.encodeStateAsUpdate(doc);
}

/** prompt 域同构语料（imageGen.prompt=XmlFragment——三域同表，表执法不分域）。 */
function promptFrameWith(mutate: (frag: Y.XmlFragment) => void): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const data = new Y.Map();
    const frag = new Y.XmlFragment();
    data.set('prompt', frag);
    const n = new Y.Map();
    n.set('type', 'imageGen');
    n.set('data', data);
    doc.getMap('nodes').set('i1', n);
    mutate(frag);
  });
  return Y.encodeStateAsUpdate(doc);
}

describe('Y1c T16 XML L1 frame-local 对抗语料：拒帧七类（单表白名单执法）', () => {
  const HOSTS = ['cdn.flowweb.local'] as const;

  it('X1 未知 XmlElement：nodeName ∉ XML_ELEMENTS ⇒ 拒（现状红：validateXmlL1 不存在）', () => {
    const u = frameWith((frag) => {
      const el = new Y.XmlElement('script');
      const t = new Y.XmlText();
      t.insert(0, 'xss');
      el.insert(0, [t]);
      frag.insert(0, [el]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unknown-xml-element');
  });

  it('X2 超深子树：嵌套 paragraph 链深度 > 32 ⇒ 拒', () => {
    const u = frameWith((frag) => {
      let cur: Y.XmlElement | Y.XmlFragment = frag;
      for (let i = 0; i < 40; i += 1) {
        const el = new Y.XmlElement('paragraph');
        cur.insert(0, [el]);
        cur = el;
      }
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-depth');
  });

  it('X3 超长 ContentString：单 XmlText 文本 > 128KiB ⇒ 拒', () => {
    const u = frameWith((frag) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'x'.repeat(131_073));
      p.insert(0, [t]);
      frag.insert(0, [p]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-text-bytes');
  });

  it('X4 外链 attr URL：image.src=http(s) 域外 host ⇒ 拒（URL allowlist 面——修正批#1：src=mediaId 后 URL 值仅 allowlist 放行）', () => {
    const u = frameWith((frag) => {
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'https://evil.example.com/pixel.png');
      frag.insert(0, [img]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-url');
  });

  it('X5 伪造 mention：command 元素未知属性键 ⇒ 拒（format key/attr 白名单执法）', () => {
    const u = frameWith((frag) => {
      const m = new Y.XmlElement('command');
      m.setAttribute('id', 'cmd-1');
      m.setAttribute('label', '/风格');
      m.setAttribute('data-evil', '1');
      frag.insert(0, [m]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-attr');
  });

  it('X5b 未知 format/mark 键：XmlText mark ∉ XML_MARKS ⇒ 拒', () => {
    const u = frameWith((frag) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, '文本');
      t.setAttribute('underline', 'true');
      p.insert(0, [t]);
      frag.insert(0, [p]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-attr');
  });

  it('X6 XmlHook：DOM 插槽占位入树 ⇒ 拒', () => {
    const u = frameWith((frag) => {
      const hook = new Y.XmlHook('imageUploader');
      frag.insert(0, [hook as unknown as Y.XmlElement]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-hook');
  });

  it('X7 嵌套 XmlFragment：XmlElement 子位再挂 XmlFragment ⇒ 拒（域容器仅 Y.Map data 直挂）', () => {
    const u = frameWith((frag) => {
      const p = new Y.XmlElement('paragraph');
      const nested = new Y.XmlFragment();
      const t = new Y.XmlText();
      t.insert(0, 'nested');
      nested.insert(0, [t]);
      p.insert(0, [nested as unknown as Y.XmlElement]);
      frag.insert(0, [p]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('xml-nested-fragment');
  });

  it('L1 合法语料放行：paragraph/text/bold mark/image mediaId/mention 三键/深度内合法嵌套', () => {
    const u = frameWith((frag) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, '正常正文');
      t.setAttribute('bold', 'true');
      p.insert(0, [t]);
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'media-abc-123');
      img.setAttribute('alt', '素材');
      p.insert(1, [img]);
      const m = new Y.XmlElement('command');
      m.setAttribute('id', 'cmd-1');
      m.setAttribute('label', '/风格');
      m.setAttribute('mentionSuggestionChar', '/');
      p.insert(2, [m]);
      const cb = new Y.XmlElement('codeBlock');
      cb.setAttribute('language', 'ts');
      const ct = new Y.XmlText();
      ct.insert(0, 'const a = 1;');
      cb.insert(0, [ct]);
      frag.insert(0, [p, cb]);
    });
    const r = validateXmlL1(u, { allowedUrlHosts: HOSTS });
    expect(r.ok).toBe(true);
  });

  it('L1b 非 XML 帧零误伤：纯 Y.Text/Y.Map 域帧（audioGen prompt splice）+节点结构帧放行', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const data = new Y.Map();
      data.set('prompt', new Y.Text('audio 域文本'));
      const n = new Y.Map();
      n.set('type', 'audioGen');
      n.set('data', data);
      doc.getMap('nodes').set('a1', n);
      (data.get('prompt') as Y.Text).insert(5, '插入');
    });
    expect(validateXmlL1(Y.encodeStateAsUpdate(doc), { allowedUrlHosts: HOSTS }).ok).toBe(true);
  });

  it('L1c 执法档：缺省零 URL 执法+空表 deny-all+prompt 域同表（imageGen.prompt 未知元素同拒）', () => {
    const ok = promptFrameWith((frag) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'prompt 正文');
      p.insert(0, [t]);
      frag.insert(0, [p]);
    });
    expect(validateXmlL1(ok).ok).toBe(true);
    const bad = promptFrameWith((frag) => {
      frag.insert(0, [new Y.XmlElement('iframe')]);
    });
    expect(validateXmlL1(bad).ok).toBe(false);
    const noHosts = frameWith((frag) => {
      const a = new Y.XmlElement('codeBlock');
      a.setAttribute('language', 'md');
      frag.insert(0, [a]);
    });
    const urlFrameUndefined = frameWith((frag) => {
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'https://any.host/x.png');
      frag.insert(0, [img]);
    });
    expect(validateXmlL1(noHosts).ok).toBe(true);   // 缺省 fail-closed（deny-all http(s)——spec-M-2 收口）：非 URL 属性值不受影响
    // spec-M-2（双评审收口）：undefined 缺省档 fail-closed——http(s) attr URL 一律拒（漏传
    // allowlist 不放行攻击面；择一说明=改 deny-all 形态而非调用点断言——扫描器纯函数缺省即安全，
    // 零生产窗口〔gate 恒传数组〕+零调用点改动）
    expect(validateXmlL1(urlFrameUndefined).ok).toBe(false);
    // 空表=deny-all http(s)（修正批#1：src=mediaId 后绝对 URL 属性值 off-spec——不留 P2 窗口）
    const urlFrame = frameWith((frag) => {
      const img = new Y.XmlElement('image');
      img.setAttribute('src', 'https://any.host/x.png');
      frag.insert(0, [img]);
    });
    expect(validateXmlL1(urlFrame, { allowedUrlHosts: [] }).ok).toBe(false);
    // 正文 ContentString 含 URL 不扫（用户散文面——URL 承载=属性值）
    const proseUrl = frameWith((frag) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, '见 https://example.com/docs 说明');
      p.insert(0, [t]);
      frag.insert(0, [p]);
    });
    expect(validateXmlL1(proseUrl, { allowedUrlHosts: [] }).ok).toBe(true);
  });
});
