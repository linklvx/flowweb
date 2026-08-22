// apps/web/src/utils/groupLayout.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcDefaultGrid, calcStoryboardSize, calcStitchSize,
  sortNodesByPosition, calcGroupBounds, ASPECT_RATIO_MAP,
} from './groupLayout';

describe('calcDefaultGrid', () => {
  it.each([
    [1, { rows: 1, cols: 1 }], [2, { rows: 1, cols: 2 }],
    [4, { rows: 2, cols: 2 }], [5, { rows: 3, cols: 3 }],
    [9, { rows: 3, cols: 3 }], [10, { rows: 4, cols: 4 }],
    [16, { rows: 4, cols: 4 }], [17, { rows: 5, cols: 5 }],
    [25, { rows: 5, cols: 5 }], [26, { rows: 6, cols: 5 }],
  ])('count=%i → %o', (count, expected) => {
    expect(calcDefaultGrid(count)).toEqual(expected);
  });
});

describe('calcStoryboardSize', () => {
  it('2x2 16:9 → 642x362', () => {
    expect(calcStoryboardSize(2, 2, '16:9')).toEqual({
      width: 2 * 320 + 2, height: 2 * (320 / (16 / 9)) + 2,
      cellWidth: 320, cellHeight: 320 / (16 / 9),
    });
  });
  it('9:16 单格高 ≈568.9', () => {
    const { cellHeight } = calcStoryboardSize(1, 1, '9:16');
    expect(cellHeight).toBeCloseTo(568.89, 1);
  });
});

describe('calcStitchSize', () => {
  it('2K 2x2 16:9', () => {
    const cellWidth = (2048 - 2) / 2;
    expect(calcStitchSize(2, 2, '16:9', 2048)).toEqual({
      width: 2048, height: Math.round(2 * (cellWidth / (16 / 9)) + 2),
      cellWidth: Math.round(cellWidth), cellHeight: Math.round(cellWidth / (16 / 9)),
    });
  });
});

describe('sortNodesByPosition', () => {
  it('按 (x,y) 字典序（严格弱序）', () => {
    const nodes = [
      { id: 'a', positionX: 100, positionY: 50 },
      { id: 'b', positionX: 50, positionY: 999 },
      { id: 'c', positionX: 100, positionY: 10 },
    ];
    expect(sortNodesByPosition(nodes).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('calcGroupBounds', () => {
  it('包围盒外扩 20px', () => {
    const bounds = calcGroupBounds([
      { x: 100, y: 200, width: 300, height: 150 },
      { x: 500, y: 100, width: 300, height: 150 },
    ]);
    expect(bounds).toEqual({ x: 80, y: 80, width: 740, height: 290 });
  });
});

describe('ASPECT_RATIO_MAP', () => {
  it('六比例齐全', () => {
    expect(Object.keys(ASPECT_RATIO_MAP)).toHaveLength(6);
    expect(ASPECT_RATIO_MAP['1:1']).toBe(1);
  });
});
