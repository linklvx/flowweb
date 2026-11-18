import { describe, it, expect } from 'vitest';
import { buildCopyPlan, normalizeCopiedNodeData } from './copyPlan';
import { validatePlacementData } from './placement';
import { normalizeSelection, participation } from './arrangeSelection';

const G = (id: string, extra: any = {}) => {
  const { position, ...dataExtra } = extra ?? {};
  return {
    id, type: 'group', parentId: undefined, position: position ?? { x: 0, y: 0 },
    width: 400, height: 300, data: { groupType: 'normal', ...dataExtra },
  };
};
const N = (id: string, parentId?: string, extra: any = {}) =>
  ({ id, type: 'imageGen', parentId, position: parentId ? { x: 20, y: 50 } : { x: 100, y: 100 }, data: { fileId: 'f1', prompt: 'p-ns', ...extra } });

// 分工契约组合测试缝：buildCopyPlan 只接收已裁决 ids——测试输入统一经 participation 组合取得
// （传裸组 id 违反契约：['g2'] 不含 'x' 则不该有 x 的副本，"折叠组成员纳入"断言必然落空）
const dupIds = (records: any[], ids: string[]) =>
  participation(normalizeSelection(records, ids), 'duplicate', records).ids;

describe('normalizeCopiedNodeData（Z14 单函数五路径共用）', () => {
  // Y2 B3（裁决 4）翻转：副本槽不携媒体 id——fileId/mediaId/status 均剥（交付归服务端 bind 命令）。
  it('loading 源副本：status/fileId 整删（旧「有 fileId 则 done」归一随身份剥离退役）', () => {
    const out = normalizeCopiedNodeData({ status: 'loading', fileId: 'm1', prompt: 'p' });
    expect(out.status).toBeUndefined();
    expect(out.fileId).toBeUndefined();
    expect(out.prompt).toBe('p');
  });
  it('loading 无 fileId → status 仍删（副本不转圈=无键态）', () => {
    expect(normalizeCopiedNodeData({ status: 'loading' }).status).toBeUndefined();
  });
  it('error 源：status/errorCode/error 清（副本不继承失败态）', () => {
    const out = normalizeCopiedNodeData({ status: 'error', fileId: 'm2', errorCode: 'X' });
    expect(out.status).toBeUndefined();
    expect(out.fileId).toBeUndefined();
    expect(out.errorCode).toBeUndefined();
    expect(out.error).toBeUndefined();
  });
  it('images[].url 删、images[].id 保留（多图身份引用不 strip）', () => {
    const out = normalizeCopiedNodeData({
      images: [{ id: 'img1', status: 'success', url: 'http://x/1' }, { id: 'img2', status: 'uploading' }],
    }) as any;
    expect(out.images[0]).toEqual({ id: 'img1', status: 'success' });
    expect(out.images[1]).toEqual({ id: 'img2', status: 'uploading' });
  });
  it('cells 派生删 + slot 保留（分镜副本格位保真）；order 删（allocator 重新分配）', () => {
    const out = normalizeCopiedNodeData({ cells: ['a', 'b'], slot: 2, order: '5' });
    expect(out.cells).toBeUndefined();
    expect(out.slot).toBe(2);
    expect(out.order).toBeUndefined();
  });
  it('终态 done 同剥；入参不被就地修改（纯函数）', () => {
    const input = { status: 'done', fileId: 'f', cells: ['a'] };
    const out = normalizeCopiedNodeData(input);
    expect(out.status).toBeUndefined();   // Y2 B3：status 整删（终态亦不随副本走）
    expect(out.fileId).toBeUndefined();
    expect(input.cells).toEqual(['a']);   // 入参隔离
    expect(input.status).toBe('done');
    expect(out.cells).toBeUndefined();
  });
});

describe('buildCopyPlan（副本构造体——分工单点：participation 裁决前置）', () => {
  it('组闭包：选中组→成员全纳入；cells 派生删（格位=子 slot 保留重挂），子副本数==源子节点数', () => {
    const records: any[] = [G('g1'), N('a', 'g1'), N('b', 'g1')];
    const plan = buildCopyPlan(records, dupIds(records, ['g1']), { offset: { x: 40, y: 0 } }, () => 'new-id');
    const newG = plan.copies.find((c) => c.type === 'group')!;
    expect(plan.copies.filter((c) => c.parentId === newG.id).length).toBe(2);
    expect((newG.data as any).cells).toBeUndefined();   // T17：cells 不落副本（派生键）
  });
  it('data 保真：普通节点副本 data=records 输入——prompt 等非桥接键逐字保真', () => {
    const records: any[] = [N('n1', undefined, { prompt: '用户改过的长提示词' })];
    const plan = buildCopyPlan(records, dupIds(records, ['n1']), { offset: { x: 40, y: 0 } }, () => 'c1');
    expect((plan.copies[0].data as any).prompt).toBe('用户改过的长提示词');
  });
  it('副本归一（Y2 B3 翻转）：loading 源副本 status/fileId 均剥（bind 命令补绑定）', () => {
    const records: any[] = [N('n1', undefined, { status: 'loading', fileId: 'm9' })];
    const plan = buildCopyPlan(records, dupIds(records, ['n1']), { offset: { x: 40, y: 0 } }, () => 'c1');
    const d = plan.copies[0].data as any;
    expect(d.status).toBeUndefined();
    expect(d.fileId).toBeUndefined();
  });
  it('P1-1 禁两可红线：slot 档副本跳过 order 分配——全员 validatePlacementData 零违例（分镜宫格保真不降级）', () => {
    const records: any[] = [
      { id: 'sg', type: 'group', parentId: undefined, position: { x: 0, y: 0 }, width: 642, height: 182,
        data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
      { id: 'p', type: 'imageGen', parentId: 'sg', position: { x: 0, y: 0 }, data: { fileId: 'f', slot: 0 } },
      { id: 'q', type: 'imageGen', parentId: 'sg', position: { x: 0, y: 0 }, data: { fileId: 'g', slot: 1 } },
    ];
    const plan = buildCopyPlan(
      records, ['sg', 'p', 'q'], { offset: { x: 40, y: 0 } }, () => 'c',
      [], () => '7000',           // allocator 恒给合法键（生产路径必带——duplicate/paste）
    );
    const kids = plan.copies.filter((c) => c.parentId != null);
    expect(kids).toHaveLength(2);
    for (const k of kids) {
      expect((k.data as any).slot).toBeDefined();          // slot 保真
      expect((k.data as any).order).toBeUndefined();       // 禁两可：slot 档不注入 order
      expect(validatePlacementData(k.data)).toEqual([]);   // 契约表零违例
    }
    const top = plan.copies.find((c) => c.type === 'group')!;
    expect((top.data as any).order).toBe('7000');           // 自由节点照常分配
    expect(validatePlacementData(top.data)).toEqual([]);
  });
  it('质评 Minor#3：detached 副本（分镜子单独复制顶层化）剥 slot 补 order——根层读序不殿后', () => {
    const records: any[] = [
      { id: 'sg', type: 'group', parentId: undefined, position: { x: 0, y: 0 }, width: 642, height: 182,
        data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
      { id: 'p', type: 'imageGen', parentId: 'sg', position: { x: 0, y: 0 }, data: { fileId: 'f', slot: 1 } },
    ];
    const plan = buildCopyPlan(
      records, ['p'], { offset: { x: 40, y: 0 } }, () => 'c',
      [], () => '7000',
    );
    const copy = plan.copies[0];
    expect(copy.parentId).toBeUndefined();               // detached 顶层化（F41）
    expect((copy.data as any).slot).toBeUndefined();     // slot 残键剥（顶层无格位语义）
    expect((copy.data as any).order).toBe('7000');       // order 补（根层读序不殿后）
    expect(validatePlacementData(copy.data)).toEqual([]);
  });
  it('allocateOrder 缝：根层副本/闭包子层各按层分配新 order 键（副本同层同 order 重复键红线）', () => {
    const records: any[] = [G('g1'), N('a', 'g1'), N('b', 'g1')];
    const assigned: (string | null)[] = [];
    const plan = buildCopyPlan(
      records, dupIds(records, ['g1']), { offset: { x: 40, y: 0 } }, () => 'n',
      [], (layer) => { assigned.push(layer); return `k${assigned.length}`; },
    );
    const newG = plan.copies.find((c) => c.type === 'group')!;
    expect(newG.data.order).toBe('k1');                       // 根层
    const childOrders = plan.copies.filter((c) => c.parentId === newG.id).map((c) => c.data.order as string);
    expect(childOrders).toEqual(['k2', 'k3']);                // 闭包子层（新组层）
    expect(assigned[0]).toBeNull();
  });
  it('分镜组副本：子 slot 保留（宫格保真）、cells 不存在', () => {
    const records: any[] = [
      G('s1', { groupType: 'storyboard', cells: ['p', 'q'] }),
      { ...N('p', 's1'), data: { fileId: 'f', slot: 0 } },
      { ...N('q', 's1'), data: { fileId: 'g', slot: 1 } },
    ];
    const plan = buildCopyPlan(records, dupIds(records, ['s1']), { offset: { x: 40, y: 0 } }, () => 's');
    const newG = plan.copies.find((c) => c.type === 'group')!;
    expect((newG.data as any).cells).toBeUndefined();
    const kids = plan.copies.filter((c) => c.parentId === newG.id);
    expect(kids.map((k) => k.data.slot).sort()).toEqual([0, 1]);
  });
  it('hidden 保真：折叠组成员随组入副本集（parentId=组副本 id、rel 保留）+ 副本组继承 collapsed；分镜子副本 position 归零 {0,0}', () => {
    const records: any[] = [
      G('g2', { collapsed: true }), N('x', 'g2'),
      G('s1', { groupType: 'storyboard' }), { ...N('p', 's1'), data: { fileId: 'f', slot: 0 } },
    ];
    const dup = buildCopyPlan(records, dupIds(records, ['g2']), { offset: { x: 40, y: 0 } }, () => 'd');
    const newG = dup.copies.find((c) => c.type === 'group')!;
    expect(dup.copies.filter((c) => c.parentId === newG.id).length).toBe(1);   // 折叠组成员纳入（非空壳）
    expect((newG.data as any).collapsed).toBe(true);                            // 副本继承 collapsed
    const st = buildCopyPlan(records, dupIds(records, ['s1']), { offset: { x: 40, y: 0 } }, () => 's');
    const child = st.copies.find((c) => c.parentId !== undefined)!;
    expect(child.position).toEqual({ x: 0, y: 0 });                              // 分镜子 rel 恒 0
  });
  it('detached 副本顶层化：parentId=undefined + 绝对坐标（父位置+rel）+offset + extent=undefined（F41）', () => {
    const records: any[] = [G('g1', { position: { x: 100, y: 100 } }), N('a', 'g1')];
    const plan = buildCopyPlan(records, dupIds(records, ['a']), { offset: { x: 40, y: 0 } }, () => 'c');
    expect(plan.copies[0].parentId).toBeUndefined();
    expect(plan.copies[0].position).toEqual({ x: 160, y: 150 });
    // extent=undefined: copy record carries extent undefined
    expect((plan.copies[0] as any).extent).toBeUndefined();
  });
  it('选区闭包互连边重映射（两端都在复制集内）；selected：组副本 true / 子副本 false', () => {
    // e1 连 a→b（两端均在 g1 闭包内）→ 重映射保留；e2 连 a→z、e3 连 z→a（z 不在集合）→ 丢弃
    const records: any[] = [G('g1'), N('a', 'g1'), N('b', 'g1'), N('z')];
    let i = 0;
    const plan = buildCopyPlan(
      records, dupIds(records, ['g1']), { offset: { x: 40, y: 0 } }, () => `id${++i}`,
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'z' },
        { id: 'e3', source: 'z', target: 'a' },
      ],
    );
    expect(plan.newEdges).toHaveLength(1);
    expect(plan.newEdges[0]).toEqual({ id: 'id4', source: plan.idMap.get('a'), target: plan.idMap.get('b') });
    const gCopy = plan.copies.find((c) => c.id === plan.idMap.get('g1'))!;
    expect(gCopy.selected).toBe(true);   // 组副本入选（成为新选区）
    for (const childId of ['a', 'b']) {
      expect(plan.copies.find((c) => c.id === plan.idMap.get(childId))!.selected).toBe(false);   // 子副本不入选
    }
  });
});

// ══════════ Y2 B3（裁决 4）：副本槽不携媒体 id——fileId 保留规则翻转（副本图示走服务端
//    bind 命令补绑定；mediaId 同批剥离——作者键与 fileId 同族）══════════
describe('Y2 B3：normalizeCopiedNodeData 副本槽剥离翻转', () => {
  it('fileId 删（裁决 4 翻转——副本不携媒体身份；服务端 bind 命令补绑定）', () => {
    const out = normalizeCopiedNodeData({ fileId: 'm1', prompt: 'p' });
    expect(out.fileId).toBeUndefined();
  });
  it('mediaId 删（作者键同族剥离）', () => {
    const out = normalizeCopiedNodeData({ mediaId: 'm-author', prompt: 'p' });
    expect(out.mediaId).toBeUndefined();
  });
  it('status 归一翻转：副本不再落 done/idle——loading/error 整态删除（交付值不随副本走）', () => {
    const out = normalizeCopiedNodeData({ status: 'loading', fileId: 'm1', errorCode: 'X', error: 'boom' });
    expect(out.status).toBeUndefined();
    expect(out.errorCode).toBeUndefined();
    expect(out.error).toBeUndefined();
    expect(out.fileId).toBeUndefined();
  });
  it('非身份键保真（prompt/images[].id/slot 等不受影响）', () => {
    const out = normalizeCopiedNodeData({
      prompt: 'p', slot: 2, images: [{ id: 'i1', status: 'success', url: 'http://x' }],
    }) as any;
    expect(out.prompt).toBe('p');
    expect(out.slot).toBe(2);
    expect(out.images[0]).toEqual({ id: 'i1', status: 'success' });   // images[].id 保留（域容器身份）
  });
});
