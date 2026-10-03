// packages/shared/src/canvas/docShape.stripAuthorState.test.ts
// O0a-2（Spec B）：stripAuthorState 行为测试——api 种子入口剥键回作者态（spec ③记录契约：
// fillDoc 只接受其输出）。键集表（spec ④字段×模式）：组 position⟺manual∨storyboard；
// 组 width/height⟺manual only（storyboard 尺寸=config 权威故剥）；auto/collapsed 组=0 帧键；
// 分镜子无 position。与 O0a-1 剥键口径一致（stripDerivedKeys 同一谓词源）。
import { describe, it, expect } from 'vitest';
import { stripAuthorState, type DocNodeRecord } from './docShape';

const rec = (over: Partial<DocNodeRecord>): DocNodeRecord => ({
  id: 'n1', type: 'textInput', data: {},
  ...over,
});

describe('stripAuthorState（键集表④——纯剥不补：输入无键⇄输出无键）', () => {
  it('非组节点：信封键原样保留（wh=measured 自由面），data 透传不碰内部', () => {
    const out = stripAuthorState([
      rec({ id: 'n1', type: 'imageGen', position: { x: 1, y: 2 }, width: 320, height: 180, data: { fileId: 'f', nested: { a: 1 } } }),
    ]);
    expect(out[0].position).toEqual({ x: 1, y: 2 });
    expect(out[0].width).toBe(320);
    expect(out[0].height).toBe(180);
    expect(out[0].data).toEqual({ fileId: 'f', nested: { a: 1 } }); // 白名单/快照域归 O0c-1——本函数不碰 data
  });

  it('manual 组（三键齐且有限且宽高>0）：帧三键全留（G1 手动尺寸保持）', () => {
    const out = stripAuthorState([
      rec({ id: 'g1', type: 'group', position: { x: 5, y: 6 }, width: 300, height: 200, data: { groupType: 'normal' } }),
    ]);
    expect(out[0].position).toEqual({ x: 5, y: 6 });
    expect(out[0].width).toBe(300);
    expect(out[0].height).toBe(200);
  });

  it('storyboard 组：剥 width/height（尺寸=config 权威）、留 position', () => {
    const out = stripAuthorState([
      rec({ id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 642, height: 362, data: { groupType: 'storyboard', cells: ['c1'] } }),
    ]);
    expect(out[0].position).toEqual({ x: 0, y: 0 });
    expect(out[0].width).toBeUndefined();
    expect(out[0].height).toBeUndefined();
  });

  it('auto 组（帧键不齐/无效）：position/width/height 全剥=0 帧键（部分帧键同剥）', () => {
    const partial = stripAuthorState([
      rec({ id: 'g1', type: 'group', position: { x: 1, y: 1 }, width: 300, data: { groupType: 'normal' } }), // 缺 height→非 manual
    ])[0];
    expect(partial.position).toBeUndefined();
    expect(partial.width).toBeUndefined();
    expect(partial.height).toBeUndefined();
    const collapsed = stripAuthorState([
      rec({ id: 'g2', type: 'group', width: 80, height: 80, data: { groupType: 'normal', collapsed: true } }), // 无 position→非 manual；折叠同 0 帧键
    ])[0];
    expect(collapsed.position).toBeUndefined();
    expect(collapsed.width).toBeUndefined();
    expect(collapsed.height).toBeUndefined();
  });

  it('manual 组+collapsed=true：帧三键保留（doc 三键=展开态密封源——终裁 82/89）；对照档=上方 g2 auto+collapsed⇒0 帧键', () => {
    const out = stripAuthorState([
      rec({ id: 'g3', type: 'group', position: { x: 5, y: 6 }, width: 300, height: 200, data: { groupType: 'normal', collapsed: true } }),
    ]);
    expect(out[0].position).toEqual({ x: 5, y: 6 });
    expect(out[0].width).toBe(300);
    expect(out[0].height).toBe(200);
  });

  it('分镜子（parentId 指向 storyboard 组）：剥 position、留 width/height（全量预扫不依赖遍历序）', () => {
    const out = stripAuthorState([
      rec({ id: 'c1', type: 'imageGen', parentId: 'sb1', position: { x: 1, y: 1 }, width: 320, height: 180, data: {} }), // 子在前
      rec({ id: 'sb1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['c1'] } }),     // 父在后
    ]);
    expect(out[0].position).toBeUndefined();
    expect(out[0].width).toBe(320);   // 分镜子只剥 position——wh 是 cell 尺寸自由面
    expect(out[0].height).toBe(180);
    expect(out[0].parentId).toBe('sb1');
  });

  it('非分镜子节点（父=normal 组）：position 不剥（剥键域仅限分镜子）', () => {
    const out = stripAuthorState([
      rec({ id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal' } }),
      rec({ id: 'c1', parentId: 'g1', position: { x: 7, y: 8 } }),
    ]);
    expect(out[1].position).toEqual({ x: 7, y: 8 });
  });

  it('无键输入不补键：分镜子无 position 入→无 position 出；data undefined→{}（与 toDocRecord 同构）', () => {
    const out = stripAuthorState([
      rec({ id: 'c1', parentId: 'sb1', width: 100, height: 50 }),
      rec({ id: 'sb1', type: 'group', data: { groupType: 'storyboard' } as any }),
    ]);
    expect('position' in out[0]).toBe(false);
    expect(out[0].data).toEqual({});
    expect('position' in out[1]).toBe(false);
    expect('width' in out[1]).toBe(false);
  });

  it('幂等（O0c-1 验收）：stripAuthorState(stripAuthorState(x)) ≡ stripAuthorState(x)——键集表全档一次入参（种子入口重复剥无害）', () => {
    const input: DocNodeRecord[] = [
      rec({ id: 'g1', type: 'group', position: { x: 5, y: 6 }, width: 300, height: 200, data: { groupType: 'normal', collapsed: true } }), // manual（折叠不剥）
      rec({ id: 'ag', type: 'group', position: { x: 9, y: 9 }, width: 100, data: { groupType: 'normal' } }),                              // auto（脏帧键→0 帧键）
      rec({ id: 'sb', type: 'group', position: { x: 0, y: 0 }, width: 642, height: 362, data: { groupType: 'storyboard', cells: ['c1'] } }), // storyboard（剥 wh 留 position）
      rec({ id: 'c1', type: 'imageGen', parentId: 'sb', position: { x: 1, y: 1 }, width: 320, height: 180, data: {} }),                   // 分镜子（剥 position）
      rec({ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { content: 'x' } }),                                             // 非组（原样）
    ];
    const once = stripAuthorState(input);
    expect(stripAuthorState(once)).toEqual(once);
  });
});
