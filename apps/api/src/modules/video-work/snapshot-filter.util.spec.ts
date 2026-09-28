import {
  buildFilteredSnapshot, WHITELIST, stripHtmlToText, ensureParentFirst, CLONE_WHITELIST, normalizeNodeRecord,
  type RawCanvasData, type FilterOptions,
} from './snapshot-filter.util';
import { VIDEO_WORK_NODE_TYPES } from '@flowweb/shared'; // 测试文件值导入（vitest 转译；tsconfig exclude **/*.spec.ts，永不进 dist）。生产源码值导入自 R1a 起合法（shared main→dist CJS 真构建+内联 check-shared-dist 门禁，见 admin.guard.ts:3-4 注释）——勿删本导入（:154-156/:269-271 键集锚定依赖，删了退回自指清单）

const rawNode = (id: string, type: string, data: Record<string, unknown>, extra: any = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data, ...extra });

describe('snapshot-filter 白名单（spec §4.6 表，键以 CanvasView nodeTypes 8 键为真值、shared VIDEO_WORK_NODE_TYPES 锚定——第八轮更正）', () => {
  // 两个口径（第八轮裁定，spec:228/D9）：快照【不】剥 videoEdit——保留节点、data 全剥（WHITELIST['videoEdit']=[]）；
  // 剥除是克隆独有差异。下方白名单用例走快照口径 base；剥除行为用例走克隆口径 cloneOpts。
  const base: FilterOptions = { dropTypes: [], dropIdPrefixes: ['shadow-'], resetStatusIdle: false, injectThumbnails: false };       // 快照口径（getProcessSnapshot 实参）
  const cloneOpts: FilterOptions = { dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'], resetStatusIdle: false, injectThumbnails: false }; // 剥除口径——仅 dropXxx 维度与 clone 一致（clone 真实实参另传 resetStatusIdle:true；本组用例只测剥除行为，第十轮注）

  it('textInput：content HTML→纯文本、prompt（string）直保留', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'textInput', { content: '<p>一只猫在窗台上</p>', prompt: '副提示词' })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('一只猫在窗台上');
    expect(out.nodes[0].data.prompt).toBe('副提示词');
  });

  it('imageGen：prompt.text 保留；html/fileId/mediaUrl/allImages/referenceImage/mediaName/generationBatchId/extConfig 全剥', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'imageGen', {
        prompt: { text: '一只猫', html: '<p>一只猫</p>', referencedImageIds: ['r1'] },
        style: 's', model: 'm', quality: 'q', ratio: '1:1', resolution: '2k', aspectRatio: 1,
        fileId: 'f1', mediaUrl: 'http://x', referenceImage: 'ri', mediaName: 'cat.png',
        allImages: [{ id: 'i1', url: 'http://y', name: 'a.png', status: 'success' }],
        generationBatchId: 'g1', extConfig: { model: 'm2', prompt: { text: 't', html: '<p>x</p>' } }, status: 'done',
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.prompt).toBe('一只猫');           // PromptValue → .text 字符串化
    expect(d.style).toBe('s'); expect(d.model).toBe('m'); expect(d.aspectRatio).toBe(1); // aiTool 是 imageExtGen 根级专属（nodeStore.ts:126），不在 imageGen 白名单（C2 Task 5.1 第五轮）
    const keys = Object.keys(d);
    for (const banned of ['html', 'fileId', 'mediaUrl', 'allImages', 'referenceImage', 'mediaName', 'generationBatchId', 'extConfig', 'referencedImageIds', 'status']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('imageExtGen：aiTool/aspectRatio 保留（根级专属）；extConfig 整体剥离、style/prompt 不外显（第五轮 C2 独立用例——第八轮回写正文）', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'imageExtGen', {
        aiTool: 'grid_25', aspectRatio: 1, style: 's',
        extConfig: { model: 'm2', prompt: { text: 't', html: '<x>' } },
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.aiTool).toBe('grid_25');
    expect(d.aspectRatio).toBe(1);
    expect(Object.keys(d).sort()).toEqual(['aiTool', 'aspectRatio']); // 无 extConfig 无 html 无 style 无 prompt（ext 节点提示词在 extConfig 内随整体剥离）
  });

  it('videoGen：label/model/ratio/prompt.text/trim 保留；origin/videoProjectId/fileId 剥离', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'videoGen', { origin: 'video-edit', videoProjectId: 'vp1', fileId: 'f1', label: '末班地铁 · 导出 1', model: 'video-01', ratio: '16:9', prompt: { text: 'p', html: 'h' }, trimStart: 0, trimEnd: 5, status: 'done' })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.label).toBe('末班地铁 · 导出 1');
    expect(d.origin).toBeUndefined(); expect(d.videoProjectId).toBeUndefined(); expect(d.fileId).toBeUndefined();
  });

  it('audioGen：model/content 保留（类型键是 audioGen 非 audio）', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'audioGen', { model: 'tts', content: '旁白文字', fileId: 'f', status: 'done' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('旁白文字');
    expect(out.nodes[0].data.fileId).toBeUndefined();
  });

  it('multiImageGen：prompt（string）/label 保留；images/generationBatchId/nodeStatus 剥离', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'multiImageGen', { prompt: '分镜提示', label: 'L', images: [{ url: 'u' }], generationBatchId: 'g', nodeStatus: 'done', mainImageIndex: 0, expanded: false })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.prompt).toBe('分镜提示');
    expect(out.nodes[0].data.images).toBeUndefined();
  });

  it('group：groupType/cells/name 保留；collapsed/storyboard 剥离；cells 悬空 id 原样返回', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'group', { groupType: 'storyboard', cells: ['ghost-id', null], name: '分镜1', collapsed: false, storyboard: { x: 1 } })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.groupType).toBe('storyboard');
    expect(d.cells).toEqual(['ghost-id', null]); // 原样返回（§7.6 断言口径）
    expect(d.name).toBe('分镜1');
    expect(d.collapsed).toBeUndefined(); expect(d.storyboard).toBeUndefined();
  });

  it('克隆口径：videoEdit 与 shadow- 前缀节点及相连边剥除；__ephemeral 标记节点（无前缀）同样剥除（spec §4.6 字面）', () => {
    const input: RawCanvasData = {
      nodes: [
        rawNode('n1', 'videoGen', { model: 'm' }),
        rawNode('n2', 'videoEdit', { timeline: [1] }),
        rawNode('shadow-tmp', 'imageGen', { prompt: { text: 'x', html: 'y' } }),
        rawNode('n3', 'videoGen', { model: 'm', __ephemeral: true }), // 无 shadow- 前缀、带标记
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n1', target: 'shadow-tmp' },
        { id: 'e3', source: 'n1', target: 'n3' },
      ],
    };
    const out = buildFilteredSnapshot(input, cloneOpts);
    expect(out.nodes.map(n => n.id)).toEqual(['n1']);
    expect(out.edges).toEqual([]);
  });

  it('快照口径：videoEdit 节点保留、data 全剥为 {}、连线保留（spec:228"仅结构字段→全部 data"——剥除仅是克隆差异 D9，第八轮裁定）', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'videoGen', { model: 'm' }), rawNode('n2', 'videoEdit', { timeline: [1], draft: '内部时间轴' })],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const out = buildFilteredSnapshot(input, base);
    const edit = out.nodes.find(n => n.id === 'n2')!;
    expect(edit).toBeTruthy();          // 节点保留（前端 TYPE_LABEL 有"视频剪辑"）
    expect(edit.data).toEqual({});      // data 全剥
    expect(out.edges).toHaveLength(1);  // 连线保留
  });

  it('剥离范围收口（第七轮）：audioGen.content 是纯文本旁白——含尖括号的正常文本原样保留；PromptValue.text 不做二次 strip', () => {
    const input: RawCanvasData = {
      nodes: [
        rawNode('a1', 'audioGen', { model: 'tts', content: '若 3 < 5 且 6 > 4 则对', fileId: 'f', status: 'done' }),
        rawNode('i1', 'imageGen', { prompt: { text: '数量 2 < 10 的猫', html: '<p>x</p>' }, style: 's' }),
      ],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('若 3 < 5 且 6 > 4 则对'); // 不剥——audioGen content 非 HTML
    expect(out.nodes[1].data.prompt).toBe('数量 2 < 10 的猫');        // .text 原文，不再 strip
  });

  it('injectThumbnails: true 时保留注入的 thumbnailUrl 且剥 fileId', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'imageGen', { prompt: { text: 'a' }, fileId: 'f1', thumbnailUrl: 'http://x/ok.webp' })], edges: [] };
    const out = buildFilteredSnapshot(input, { ...base, injectThumbnails: true });
    expect(out.nodes[0].data.thumbnailUrl).toBe('http://x/ok.webp'); // 注入字段在白名单外但 injectThumbnails 分支放行（util :92-94）
    expect(out.nodes[0].data).not.toHaveProperty('fileId');
  });

  it('未知类型默认全剥 data（仅结构字段）', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'futureType', { secret: 'x', nice: 'y' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data).toEqual({});
  });

  it('nodeTypes 注册表全覆盖：WHITELIST keys ⊇ VIDEO_WORK_NODE_TYPES（shared 锚定，第八轮裁定——替代本文件硬编码清单的自指断言；配套 web 侧锚定见 Task 9.3）', () => {
    for (const t of VIDEO_WORK_NODE_TYPES) expect(Object.keys(WHITELIST)).toContain(t);
  });

  // 第十二轮 T1/补强：两处"因缺陷而生"的防御分支此前零用例（违反本 plan TDD 铁律）——readCanvas 的
  // position/data 均为 ?.toJSON()（collab-document.service.ts:70-71）可为 undefined、互指 parentId 会爆栈，
  // 都是 readCanvas 真实可达形态。顺带消费 import 的 ensureParentFirst/stripHtmlToText（原未用导入）。
  it('ensureParentFirst 互指 parentId（A↔B）不死循环不爆栈，两节点均保留（visiting 环守卫——C2-B7）', () => {
    const a = rawNode('a', 'group', { groupType: 'normal' }, { parentId: 'b' });
    const b = rawNode('b', 'group', { groupType: 'normal' }, { parentId: 'a' });
    const out = ensureParentFirst([a, b]);
    expect(out.map(n => n.id).sort()).toEqual(['a', 'b']);
    // 第十三轮补：钉 visiting 提前返回的输出序——visit(a) 先递归父 b、b 先 emit（父先子后），out=[b,a]
    expect(out.map(n => n.id)).toEqual(['b', 'a']);
  });

  it('节点缺 data/position（readCanvas 两个 ?.toJSON() 可为 undefined）→ 兜底不抛、输出空 data 与原点', () => {
    const out = buildFilteredSnapshot({ nodes: [{ id: 'n1', type: 'imageGen' } as any], edges: [] }, base);
    expect(out.nodes[0].data).toEqual({});
    expect(out.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  // 第十三轮补：width/height 归一（TDD 缺口——第十一轮加了实现 ?? undefined 但无用例，违反本 plan TDD 铁律）
  it('width/height 为 null（readCanvas 的 m.get(...) ?? null，collab-document.service.ts:68-69）→ 归一为 undefined', () => {
    const out = buildFilteredSnapshot({ nodes: [{ id: 'n1', type: 'imageGen', width: null, height: null } as any], edges: [] }, base);
    expect(out.nodes[0].width).toBeUndefined();
    expect(out.nodes[0].height).toBeUndefined();
  });

  it('stripHtmlToText 剥标签并解码基础实体（同实体多次亦被 /g 全替换）', () => {
    // 夹具含两个 &nbsp;（第十三轮修：原夹具仅一个，期望串 "猫 & <狗>" 的 & 与 < 之间空格无处可来——必红）
    expect(stripHtmlToText('<p>猫&nbsp;&amp;&nbsp;&lt;狗&gt;</p>')).toBe('猫 & <狗>');
  });

  // Step 4 追加：ensureParentFirst（spec §4.6 排序）——plan 写"spec 文件追加"，代码引用上方 base 常量，
  // 文件级追加是 TS2304（describe 块级作用域），故置于本 describe 内、代码逐字不变
  describe('ensureParentFirst（spec §4.6 排序）', () => {
    it('子先父后的输入 → 输出父在前（index(parent) < index(child)）', () => {
      const child = rawNode('c1', 'videoGen', {}, { parentId: 'g1' });
      const parent = rawNode('g1', 'group', { groupType: 'normal', cells: ['c1'] });
      const out = buildFilteredSnapshot({ nodes: [child, parent], edges: [] }, base);
      expect(out.nodes.findIndex(n => n.id === 'g1')).toBeLessThan(out.nodes.findIndex(n => n.id === 'c1'));
    });
    it('悬空 parentId 不死循环不报错', () => {
      const out = buildFilteredSnapshot({ nodes: [rawNode('c1', 'videoGen', {}, { parentId: 'ghost' })], edges: [] }, base);
      expect(out.nodes).toHaveLength(1);
    });
  });

  // Step 5 追加：危险夹具用例（XSS 红线终验）
  it('危险夹具：content 嵌 <img onerror> → 输出纯文本无标签残留', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'textInput', { content: '<p>ok</p><img src=x onerror=alert(1)>' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).not.toContain('<');
    expect(out.nodes[0].data.content).toBe('ok');
  });

  it('实体编码变体：tiptap 常规存储形态 &lt;img...&gt; 单次解码重生标签形文本（安全性依赖 React 文本节点渲染，非无标签输出）', () => {
    const out = stripHtmlToText('<p>a</p>&lt;img src=x&gt;');
    expect(out).toBe('a<img src=x>'); // 钉实际行为：剥标签（&lt;/&gt; 不匹配标签正则）→ 实体解码在后，单次解码即得标签形字符串
  });

  it('styleId/styleName 进入 imageGen/imageExtGen/videoGen 白名单且快照保留（field 级，spec §7.3——现有断言只做 type 级，漏字段全绿）', () => {
    for (const t of ['imageGen', 'imageExtGen', 'videoGen'] as const) {
      expect(WHITELIST[t]).toContain('styleId');
      expect(WHITELIST[t]).toContain('styleName');
    }
    for (const t of ['imageGen', 'imageExtGen', 'videoGen'] as const) {
      const out = buildFilteredSnapshot(
        { nodes: [rawNode('n1', t, { styleId: 'st1', styleName: '胶片' })], edges: [] },
        base,
      );
      expect(out.nodes[0].data.styleId).toBe('st1');
      expect(out.nodes[0].data.styleName).toBe('胶片');
    }
  });

  // ↓↓↓ 以下追加进既有外层 describe 内部 ↓↓↓

  it('clone 表 group 保留全部 9 键（R0a）', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('g1', 'group', {
        groupType: 'storyboard', cells: ['n1', null], name: '分镜',
        storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' },
        collapsed: false, savedSize: { width: 100, height: 60 },
        nameCustom: true, color: 'red', manuallyResized: true,
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, {
      dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'], resetStatusIdle: true, injectThumbnails: false,
      whitelist: CLONE_WHITELIST,
    });
    expect(Object.keys(out.nodes[0].data).sort()).toEqual(
      ['cells', 'collapsed', 'color', 'groupType', 'manuallyResized', 'name', 'nameCustom', 'savedSize', 'storyboard'].sort(),
    );
  });

  it('不传 whitelist 维持 snapshot 表（group 3 键——F21 载荷收敛不推翻）', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('g1', 'group', {
        groupType: 'storyboard', cells: ['n1'], name: '分镜',
        storyboard: { aspectRatio: '16:9' }, collapsed: true, savedSize: { width: 1, height: 1 },
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(Object.keys(out.nodes[0].data).sort()).toEqual(['cells', 'groupType', 'name']);
  });

  it('CLONE_WHITELIST.group 与 shared GROUP_NODE_DATA_KEYS parity（防 R1a 切值导入漏项）', async () => {
    const { GROUP_NODE_DATA_KEYS } = await import('@flowweb/shared');
    expect([...CLONE_WHITELIST.group].sort()).toEqual([...GROUP_NODE_DATA_KEYS].sort());
  });

  it('CLONE_WHITELIST 覆盖全部节点类型（WHITELIST 侧既有 :154-156 已锚定——本条只补 clone 侧对称半边）', () => {
    for (const t of VIDEO_WORK_NODE_TYPES) expect(Object.keys(CLONE_WHITELIST)).toContain(t);
  });

  it('normalizeNodeRecord：parentId/width/height null → undefined（JSON.stringify 键消失）', () => {
    const out = normalizeNodeRecord({ id: 'n1', type: 'group', position: { x: 1, y: 2 }, data: {}, parentId: null, width: null, height: null } as any);
    expect(JSON.parse(JSON.stringify(out)).parentId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(out)).width).toBeUndefined();
  });

  it('normalizeNodeRecord：有值全保留；position undefined → {x:0,y:0}；data undefined → {}', () => {
    const out = normalizeNodeRecord({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' }, width: 320, height: 180 });
    expect(out.width).toBe(320);
    expect(out.parentId).toBeUndefined();
    const out2 = normalizeNodeRecord({ id: 'n1', type: 'textInput', data: undefined, position: undefined } as any);
    expect(out2.position).toEqual({ x: 0, y: 0 });
    expect(out2.data).toEqual({});
  });
});
