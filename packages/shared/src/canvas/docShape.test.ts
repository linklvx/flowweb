// packages/shared/src/canvas/docShape.test.ts
// C0-1 编译门测试（Spec B）：只锚类型形状与 stub 签名存在——谓词行为测试与实现由后续分片接手。
// 类型锚两手法并用：expectTypeOf（vitest 面）+ 编译锚别名（tsc --noEmit 红——nodeEnvelope.ts:19-22 同族手法）。
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  type DocMapLike, type DocLike, type Rect, type DocNodeRecord,
  type RenderNode, type DragSession, type FrameMode,
  frameMode, isCollapsed, isValidStoredFrame,
} from './docShape';
import type { AbsCoord, RelCoord, AbsPos, RelPos, AbsRecords, RelRecords } from './brands';
import type { CanvasNodeRecord } from './nodeEnvelope';

// ── 编译锚手法（nodeEnvelope.ts 同款——tsc --noEmit 时红，vitest 运行面不感知）──
type _AssertNever<T extends never> = T;
type _AssertTrue<T extends true> = T;
type _IsExtends<A, B> = [A] extends [B] ? true : false;

/** 键集双向锚（约束在实例化点应用——泛型别名体内急切校验会恒红，nodeEnvelope 同款具体类型手法）：
 *  T 的键与 Expected 逐字面量一致才为 never——多一键/少一键都编译红。 */
type _ExactKeysDiff<T, Expected extends readonly string[]> =
  | Exclude<keyof T, Expected[number]>
  | Exclude<Expected[number], keyof T>;

// 键集冻结（plan v3.6-FROZEN 逐字面量——后续分片加键必须先改这里，防静默漂移）
type _AnchorDocMapLikeKeys = _AssertNever<_ExactKeysDiff<DocMapLike, ['get', 'set', 'has']>>;
type _AnchorDocLikeKeys = _AssertNever<_ExactKeysDiff<DocLike, ['getMap']>>;
type _AnchorDocNodeKeys = _AssertNever<_ExactKeysDiff<DocNodeRecord, ['id', 'type', 'parentId', 'position', 'width', 'height', 'data']>>;
type _AnchorRenderNodeKeys = _AssertNever<_ExactKeysDiff<RenderNode, ['id', 'type', 'parentId', 'position', 'width', 'height', 'data', 'hidden']>>;
type _AnchorDragSessionKeys = _AssertNever<_ExactKeysDiff<DragSession, [
  'baseline', 'groupBaseline', 'delta', 'draggingIds', 'dragProtectedIds', 'draggedGroupIds',
  'frozenFrames', 'gestureKind', 'resizePending', 'lastActivityAt', 'activePointers',
  'gestureAbandoned', 'resizeTargetId',
]>>;
type _AnchorFrameModeInputKeys = _AssertNever<_ExactKeysDiff<Parameters<typeof frameMode>[0], ['data', 'storedFrame']>>;
type _AnchorStoredFrameKeys = _AssertNever<_ExactKeysDiff<
  NonNullable<Parameters<typeof frameMode>[0]['storedFrame']>, ['position', 'width', 'height']>>;
type _AnchorIsValidFrameKeys = _AssertNever<_ExactKeysDiff<Parameters<typeof isValidStoredFrame>[0], ['position', 'width', 'height']>>;

// 品牌锚：品牌打在坐标 number 上——品牌删除（退化裸 number）即红
type _AnchorAbsCoordIsNumber = _AssertTrue<_IsExtends<AbsCoord, number>>;
type _AnchorRelCoordIsNumber = _AssertTrue<_IsExtends<RelCoord, number>>;
type _AnchorAbsNotRel = _AssertNever<Extract<AbsCoord, RelCoord>>;
type _AnchorRelNotAbs = _AssertNever<Extract<RelCoord, AbsCoord>>;
type _AnchorPlainNotAbs = _AssertNever<Extract<number, AbsCoord>>;

// 数组品牌锚（泛型包装 readonly T[]——copyPlan 族/投影族签名用）
interface _RecA { id: string; position: AbsPos }
interface _RecR { id: string; position: RelPos }
type _AnchorAbsRecArr = _AssertTrue<_IsExtends<AbsRecords<_RecA>, readonly _RecA[]>>;
type _AnchorAbsRecBrand = _AssertTrue<_IsExtends<AbsRecords<_RecA>, { readonly __recordsSpace: 'abs' }>>;
type _AnchorAbsRecNotRel = _AssertNever<Extract<AbsRecords<_RecA>, RelRecords<_RecA>>>;
type _AnchorRelRecArr = _AssertTrue<_IsExtends<RelRecords<_RecR>, readonly _RecR[]>>;
type _AnchorRelRecBrand = _AssertTrue<_IsExtends<RelRecords<_RecR>, { readonly __recordsSpace: 'rel' }>>;
type _AnchorRelRecNotAbs = _AssertNever<Extract<RelRecords<_RecR>, AbsRecords<_RecR>>>;

describe('DocLike/DocMapLike（Y 结构性最小面——零 yjs import，防跨实例 instanceof 静默失败）', () => {
  it('getMap(name: string) 返回 DocMapLike；DocMapLike 三方法签名', () => {
    expectTypeOf<ReturnType<DocLike['getMap']>>().toEqualTypeOf<DocMapLike>();
    expectTypeOf<Parameters<DocLike['getMap']>>().toEqualTypeOf<[string]>();
    expectTypeOf<ReturnType<DocMapLike['get']>>().toEqualTypeOf<unknown>();
    expectTypeOf<ReturnType<DocMapLike['set']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<DocMapLike['has']>>().toEqualTypeOf<boolean>();
    expectTypeOf<Parameters<DocMapLike['get']>>().toEqualTypeOf<[string]>();
    expectTypeOf<Parameters<DocMapLike['set']>>().toEqualTypeOf<[string, unknown]>();
    expectTypeOf<Parameters<DocMapLike['has']>>().toEqualTypeOf<[string]>();
  });
});

describe('DocNodeRecord 分裂（作者态 doc 侧——键可选）vs CanvasNodeRecord（信封必填——一字不动）', () => {
  it('DocNodeRecord：position?: AbsPos / width? / height? 可选键——键集表语义', () => {
    expectTypeOf<DocNodeRecord['position']>().toEqualTypeOf<AbsPos | undefined>();
    expectTypeOf<DocNodeRecord['width']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DocNodeRecord['height']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DocNodeRecord['data']>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('CanvasNodeRecord 维持必填原状（position 必填裸 number、非品牌）——分裂不波及现有面', () => {
    expectTypeOf<CanvasNodeRecord['position']>().toEqualTypeOf<{ x: number; y: number }>();
  });

  it('Rect 形状（冻结帧/快照共用）', () => {
    expectTypeOf<Rect>().toEqualTypeOf<{ x: number; y: number; width: number; height: number }>();
  });
});

describe('RenderNode 最小骨架（完整化留 O0c-2 分片）', () => {
  it('position 必填 RelPos（品牌）+ hidden?: boolean 必须出现', () => {
    expectTypeOf<RenderNode['position']>().toEqualTypeOf<RelPos>();
    expectTypeOf<RenderNode['hidden']>().toEqualTypeOf<boolean | undefined>();
  });
});

describe('DragSession 键集（draggingIds=被拖集合 / dragProtectedIds=保护集合含 resize 扩展——两者并存）', () => {
  it('全键类型逐项锚定', () => {
    expectTypeOf<DragSession['baseline']>().toEqualTypeOf<ReadonlyMap<string, Rect>>();
    expectTypeOf<DragSession['groupBaseline']>().toEqualTypeOf<ReadonlyMap<string, Rect>>();
    expectTypeOf<DragSession['delta']>().toEqualTypeOf<{ x: number; y: number }>();
    expectTypeOf<DragSession['draggingIds']>().toEqualTypeOf<ReadonlySet<string>>();
    expectTypeOf<DragSession['dragProtectedIds']>().toEqualTypeOf<ReadonlySet<string>>();
    expectTypeOf<DragSession['draggedGroupIds']>().toEqualTypeOf<ReadonlySet<string>>();
    expectTypeOf<DragSession['frozenFrames']>().toEqualTypeOf<ReadonlyMap<string, Rect>>();
    expectTypeOf<DragSession['gestureKind']>().toEqualTypeOf<'drag' | 'resize'>();
    expectTypeOf<DragSession['resizePending']>().toEqualTypeOf<boolean>();
    expectTypeOf<DragSession['lastActivityAt']>().toEqualTypeOf<number>();
    expectTypeOf<DragSession['activePointers']>().toEqualTypeOf<Set<number>>();
    expectTypeOf<DragSession['gestureAbandoned']>().toEqualTypeOf<boolean>();
    expectTypeOf<DragSession['resizeTargetId']>().toEqualTypeOf<string | null>();
  });
});

describe('品牌类型（字段级为主——品牌打在坐标 number 上）', () => {
  it('AbsPos={x:AbsCoord;y:AbsCoord} / RelPos={x:RelCoord;y:RelCoord}', () => {
    expectTypeOf<AbsPos>().toEqualTypeOf<{ x: AbsCoord; y: AbsCoord }>();
    expectTypeOf<RelPos>().toEqualTypeOf<{ x: RelCoord; y: RelCoord }>();
  });

  it('数组品牌：泛型包装 readonly T[] 且带空间标识（纯类型零运行时）', () => {
    expectTypeOf<AbsRecords<_RecA>>().toEqualTypeOf<readonly _RecA[] & { readonly __recordsSpace: 'abs' }>();
    expectTypeOf<RelRecords<_RecR>>().toEqualTypeOf<readonly _RecR[] & { readonly __recordsSpace: 'rel' }>();
  });
});

describe('frameMode / isCollapsed / isValidStoredFrame 签名（行为留后续分片）', () => {
  it('frameMode 三值返回（dirty-manual 档不存在——manuallyResized 已被终裁 50 删除，多一档即红）', () => {
    expectTypeOf<FrameMode>().toEqualTypeOf<'auto' | 'manual' | 'storyboard'>();
    expectTypeOf<ReturnType<typeof frameMode>>().toEqualTypeOf<FrameMode>();
  });

  it('frameMode 输入 { data, storedFrame? }——oracle=doc 侧键（禁 cs 派生帧当 storedFrame）', () => {
    expectTypeOf<Parameters<typeof frameMode>[0]['data']>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<NonNullable<Parameters<typeof frameMode>[0]['storedFrame']>>().toEqualTypeOf<{
      position?: { x: number; y: number };
      width?: number;
      height?: number;
    }>();
  });

  it('isCollapsed（与 frameMode 正交：collapsed∧manual/auto 交叉装不下四值枚举）与 isValidStoredFrame 均 boolean', () => {
    expectTypeOf<Parameters<typeof isCollapsed>[0]>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<ReturnType<typeof isCollapsed>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof isValidStoredFrame>>().toEqualTypeOf<boolean>();
  });
});

describe('C0 stub 签名存在（不锚返回值——调用即抛 C0 stub，防本片提前实现）', () => {
  it('三个谓词 body 全部 throw C0 stub', () => {
    expect(() => frameMode({ data: {} })).toThrow('C0 stub');
    expect(() => frameMode({
      data: { groupType: 'storyboard' },
      storedFrame: { position: { x: 0, y: 0 }, width: 10, height: 10 },
    })).toThrow('C0 stub');
    expect(() => isCollapsed({ collapsed: true })).toThrow('C0 stub');
    expect(() => isValidStoredFrame({ position: { x: 1, y: 2 }, width: 3, height: 4 })).toThrow('C0 stub');
  });
});
