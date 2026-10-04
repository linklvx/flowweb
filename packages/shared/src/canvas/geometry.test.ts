// packages/shared/src/canvas/geometry.test.ts
import { describe, it, expect } from 'vitest';
import {
  isContentDerivedFrame, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE,
  GROUP_PADDING, GROUP_PADDING_TOP, clampChildIntoGroup, clampPositionToPadding,
  deriveGroupFrame, calcGroupBounds, calcStoryboardSize, emptyGroupSealFrame,
} from './geometry';
import { resolveStoryboardConfig } from './storyboardConfig';

const rect = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

// ══════════ O0b-5（Spec B）：refit 族退役——isContentDerivedFrame 接替谓词 ══════════
// refitGroupGeometry/shouldAutoRefit 整删（函数本体+shared 导出）——守恒重算统一归 reconcile 单写者
//（calcGroupBounds 派生帧），clamp 谓词从"标记域"（data.manuallyResized）改 doc 帧键形态 oracle。
describe('isContentDerivedFrame（O0b-5 refit 退役接替谓词——auto∧!collapsed）', () => {
  it('auto 展开 → true；collapsed（含 auto 折叠）/storyboard/manual（doc 帧三键齐）→ false', () => {
    expect(isContentDerivedFrame({ data: { groupType: 'normal' }, storedFrame: {} })).toBe(true);
    // 折叠档锚（plan O0b-5）：isContentDerivedFrame=auto∧!collapsed——折叠组恒 false（帧固定语义，
    // 入组落点走 clamp 档；cs 帧≡COLLAPSED_SIZE 派生由 reconcile 写域① collapsed 分支承担）
    expect(isContentDerivedFrame({ data: { groupType: 'normal', collapsed: true }, storedFrame: {} })).toBe(false);
    expect(isContentDerivedFrame({ data: { groupType: 'storyboard' }, storedFrame: { position: { x: 0, y: 400 } } })).toBe(false);
    expect(isContentDerivedFrame({
      data: { groupType: 'normal' },
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
    })).toBe(false);
  });

  it('折叠 auto 组入组 abs 落点逐位锚（纯函数形态——collapsed⇒false ⇒ 入组 rel 过 clampChildIntoGroup：' +
    '远点 rel 夹进折叠帧内 xMax/yMax 界=abs−组原点逐位）', () => {
    // 折叠组 cs 帧=COLLAPSED_SIZE 220×160；子 100×50：xMax=220−20−100=100 ≥GROUP_PADDING 不退化、
    // yMax=160−20−50=90 ≥GROUP_PADDING_TOP 不退化——远点 (500,500) 夹到 xMax/yMax 界 (100,90)；
    // 此处锚谓词分档与 clamp 守卫的同构（真行为锚在 store 层 addToGroup 折叠组用例）
    expect(isContentDerivedFrame({ data: { groupType: 'normal', collapsed: true }, storedFrame: {} })).toBe(false);
    const rel = clampChildIntoGroup({ x: 500, y: 500 }, { width: 100, height: 50 }, COLLAPSED_SIZE);
    expect(rel).toEqual({ x: 220 - GROUP_PADDING - 100, y: 160 - GROUP_PADDING - 50 });
  });
});

describe('clampChildIntoGroup（v6——Task 14 拖拽期/Task 18 placement 共享守卫）', () => {
  const child = { width: 100, height: 50 };

  it('组宽/高任一 null → 原 rel 原样返回（同引用，不夹）', () => {
    const rel = { x: 7, y: 9 };
    expect(clampChildIntoGroup(rel, child, { width: null, height: 300 })).toBe(rel);
    expect(clampChildIntoGroup(rel, child, { width: 400, height: null })).toBe(rel);
  });

  it('组比 padding+子还小（xMax < GROUP_PADDING）→ 原 rel 原样（防负坐标钉死）', () => {
    const rel = { x: 7, y: 9 };
    // 界：groupSize.width == GROUP_PADDING*2 + child.width 时 xMax == GROUP_PADDING；再小 1 退化
    const groupSize = { width: GROUP_PADDING * 2 + child.width - 1, height: 300 };
    expect(clampChildIntoGroup(rel, child, groupSize)).toBe(rel);
  });

  it('yMax < GROUP_PADDING_TOP 退化 → 原 rel 原样', () => {
    const rel = { x: 7, y: 9 };
    const groupSize = { width: 400, height: GROUP_PADDING_TOP + GROUP_PADDING + child.height - 1 };
    expect(clampChildIntoGroup(rel, child, groupSize)).toBe(rel);
  });

  it('恰等于界（xMax==GROUP_PADDING / yMax==GROUP_PADDING_TOP）→ 夹到界', () => {
    const groupSize = {
      width: GROUP_PADDING * 2 + child.width,
      height: GROUP_PADDING_TOP + GROUP_PADDING + child.height,
    };
    expect(clampChildIntoGroup({ x: -5, y: -5 }, child, groupSize))
      .toEqual({ x: GROUP_PADDING, y: GROUP_PADDING_TOP });
  });

  it('正常情形 → 与 clampPositionToPadding 同构', () => {
    const groupSize = { width: 400, height: 300 };
    const rel = { x: 500, y: 400 };
    expect(clampChildIntoGroup(rel, child, groupSize))
      .toEqual(clampPositionToPadding(rel, child, groupSize));
  });
});

describe('单源常量锚（新建——现状散布内联的契约面）', () => {
  it('DEFAULT_CHILD_SIZE = 280×120（六处内联 ?? 280/?? 120 的单源）', () => {
    expect(DEFAULT_CHILD_SIZE).toEqual({ width: 280, height: 120 });
  });
  it('COLLAPSED_SIZE = 220×160（R2d-2 改值；原 canvasStore:1264 与 NormalGroupRenderer:44 两处内联 200×64 的单源）', () => {
    expect(COLLAPSED_SIZE).toEqual({ width: 220, height: 160 });
  });
});

// ════════ O0b-1（Spec B）：deriveGroupFrame 写域①四模式单源 ════════
// 帧装配算术实现点=1（calcGroupBounds——禁本函数自写 padding 公式成第二实现）；
// mode oracle=frameMode(doc storedFrame)——禁 cs 派生帧当 storedFrame（终裁 44，auto 防死锁）；
// collapsed（非 storyboard）⇒COLLAPSED_SIZE 档、优先级最高（终裁 82——doc 三键保持展开态值不动）。
describe('deriveGroupFrame（O0b-1 写域①四模式单源——reconcile 与后续消费共用）', () => {
  it('storyboard 档：尺寸=calcStoryboardSize（resolveStoryboardConfig 单源，无 padding）；origin=帧 position 键', () => {
    const cfg = resolveStoryboardConfig({ storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2 } });
    const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
    const frame = deriveGroupFrame({
      data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2 } },
      childrenAbs: [],
      storedFrame: { position: { x: 30, y: 40 } },
    });
    expect(frame).toEqual({ x: 30, y: 40, width: size.width, height: size.height });
  });

  it('collapsed（非 storyboard）优先级最高：manual 密封 origin+COLLAPSED_SIZE 覆写——storedFrame wh 不被消费（终裁 82）', () => {
    const frame = deriveGroupFrame({
      data: { groupType: 'normal', collapsed: true },
      childrenAbs: [{ x: 120, y: 80, width: 100, height: 60 }],
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
    });
    expect(frame).toEqual({ x: 100, y: 50, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
  });

  it('collapsed auto（doc 0 帧键）：origin 照旧 bbox 派生（calcGroupBounds）+COLLAPSED_SIZE 覆写', () => {
    const b = calcGroupBounds([{ x: 500, y: 300, width: 200, height: 100 }]);
    const frame = deriveGroupFrame({
      data: { groupType: 'normal', collapsed: true },
      childrenAbs: [{ x: 500, y: 300, width: 200, height: 100 }],
      storedFrame: {},
    });
    expect(frame).toEqual({ x: b.x, y: b.y, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
  });

  it('manual 档：storedFrame 三键密封输出；liveFrame（cs 活值——source:\'cs\' 命令中间态）优先', () => {
    const docFrame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [],
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
    });
    expect(docFrame).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    const liveFrame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [],
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
      liveFrame: { position: { x: 7, y: 8 }, width: 91, height: 82 },
    });
    expect(liveFrame).toEqual({ x: 7, y: 8, width: 91, height: 82 });
  });

  it('auto 档：帧=calcGroupBounds(childrenAbs)；liveFrame 不参与 auto（恒派生——liveFrame 只被 manual/storyboard 值面消费）', () => {
    const b = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    const frame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [
        { x: 300, y: 100, width: 200, height: 100 },
        { x: 550, y: 100, width: 150, height: 80 },
      ],
      storedFrame: {},
      liveFrame: { position: { x: 999, y: 999 }, width: 1, height: 1 },
    });
    expect(frame).toEqual({ x: b.x, y: b.y, width: b.width, height: b.height });
  });

  it('空 auto 组→COLLAPSED_SIZE@fallbackOrigin（assertEmptyAutoGroupCollapsedSize 同口径）', () => {
    const frame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [],
      storedFrame: {},
      fallbackOrigin: { x: 12, y: 34 },
    });
    expect(frame).toEqual({ x: 12, y: 34, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
  });

  it('emptyGroupSealFrame（B5'-2 空组档密封）≡deriveGroupFrame 空 auto 档同值@冻结 origin（跨端收敛 doc 载体单源）', () => {
    const seal = emptyGroupSealFrame({ x: 680, y: 550 });
    expect(seal).toEqual({ x: 680, y: 550, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
    expect(seal).toEqual(deriveGroupFrame({
      data: { groupType: 'normal' }, childrenAbs: [], storedFrame: {}, fallbackOrigin: { x: 680, y: 550 },
    }));
  });
});

// ══════════ O0b-2（Spec B）：尺寸取整单源 ceil + contain-fit 单源 + multiImage 公式单源 ══════════
// 终裁 59③/75/83④/91——adaptToFit 新名独立纯函数（不复用 adaptCustomSize 名）+calcConstrainedSize/
// ratioDimensions 三份逐字重复收编 shared 单源（web census：定义点=1）+normalizeSize=Math.ceil 落 docShape
//（geometry 消费同源）。round 同批改 ceil（差 ≤1px——防同一节点两来源差 1px）。
import { adaptToFit, calcConstrainedSize, ratioDimensions, multiImageSize,
  MULTI_IMAGE_STACKED_SIZE } from './geometry';

describe('O0b-2 adaptToFit（contain-fit 单源——wh=滚动约束框：以当前框为约束适配新比例）', () => {
  it('新比例更宽（fitByWidth>height）⇒高约束：保 height，width=ceil(height*ratio)', () => {
    const out = adaptToFit({ width: 1600, height: 900 }, 1); // 方形内容进 16:9 框
    expect(out).toEqual({ width: 900, height: 900 });
  });

  it('新比例更窄（fitByWidth≤height）⇒宽约束：保 width，height=ceil(width/ratio)', () => {
    const out = adaptToFit({ width: 400, height: 1200 }, 16 / 9);
    expect(out).toEqual({ width: 400, height: Math.ceil(400 / (16 / 9)) });
  });

  it('整除不尽时 ceil 取整（round 同批改 ceil——终裁 59③）', () => {
    // 100/3 = 33.33… ⇒ ceil=34（round 会得 33——锚鉴别力）
    const out = adaptToFit({ width: 100, height: 100 }, 3);
    expect(out).toEqual({ width: 100, height: 34 });
  });
});

describe('O0b-2 calcConstrainedSize（shared 单源——参数化 bounds；round 改 ceil）', () => {
  const bounds = { maxW: 548, maxH: 500, minW: 200, minH: 100 };

  it('超 max 缩到 max 内（保比例，ceil）；低于 min 抬到 min', () => {
    // 2000x1200 → 宽超 548：h=ceil(1200*548/2000)=ceil(328.8)=329 ≤500 ⇒ {548,329}
    expect(calcConstrainedSize(2000, 1200, bounds)).toEqual({ w: 548, h: 329 });
    // 100x60 → 低于 min：{200,100}
    expect(calcConstrainedSize(100, 60, bounds)).toEqual({ w: 200, h: 100 });
  });

  it('区间内原样返回（ceil 恒等）', () => {
    expect(calcConstrainedSize(300, 200, bounds)).toEqual({ w: 300, h: 200 });
  });

  it('ceil 鉴别力：分数 <0.5 档 ceil 向上（round 会向下——266.34 ⇒ ceil 267 / round 266）', () => {
    // 823x400，maxW=548：h=ceil(400*548/823)=ceil(266.34)=267（round 会得 266）
    expect(calcConstrainedSize(823, 400, bounds)).toEqual({ w: 548, h: 267 });
  });
});

describe('O0b-2 ratioDimensions（shared 单源——比例名→约束尺寸；ceil；非法比例兜底 548×306）', () => {
  const bounds = { maxW: 548, maxH: 500, minW: 200, minH: 100 };

  it("16:9 ⇒ base 1000 约束 ⇒ {548, ceil(548*9/16)=309}", () => {
    expect(ratioDimensions('16:9', bounds)).toEqual({ w: 548, h: 309 });
  });

  it('非法比例⇒兜底 {548,306}', () => {
    expect(ratioDimensions('bogus', bounds)).toEqual({ w: 548, h: 306 });
    expect(ratioDimensions('0:0', bounds)).toEqual({ w: 548, h: 306 });
  });
});

describe('O0b-2 multiImageSize（组件显式上报公式单源——四类触发点共用同一纯函数，终裁 91）', () => {
  it('展开档：gridCols(≤4 图=2/否则 3)+gridRows ⇒ expandedW/H 公式', () => {
    // 3 图：cols=2 rows=2 → W=min(2*150+8+24,548)=332；H=2*150+8+48=356
    expect(multiImageSize(3, true)).toEqual({ width: 332, height: 356 });
    // 6 图：cols=3 rows=2 → W=min(3*150+2*8+24,548)=490；H=356
    expect(multiImageSize(6, true)).toEqual({ width: 490, height: 356 });
  });

  it('非展开档：stackedSize 缺省⇒MULTI_IMAGE_STACKED_SIZE；显式 stackedSize 透传', () => {
    expect(multiImageSize(4, false)).toEqual(MULTI_IMAGE_STACKED_SIZE);
    expect(multiImageSize(4, false, { width: 321, height: 123 })).toEqual({ width: 321, height: 123 });
  });
});
