// apps/web/src/utils/groupGeometry.test.ts
import { describe, it, expect } from 'vitest';
import { placeGrid } from './groupGeometry';
import { CELL_WIDTH, CONVERT_GAP } from '@flowweb/shared';

const baselineH = 180;

// 与 store 调用侧同构的 sizeOf：未知 id 回落基准（F38 sizeOf 契约）
const sizeOf = (table: Record<string, { width: number; height: number }>) =>
  (id: string) => table[id] ?? { width: CELL_WIDTH, height: baselineH };

describe('placeGrid（F38 解散网格重排）', () => {
  it('① null 槽不塌陷：[a, null, b] 3 列 → b 仍在第 3 槽（x = 2*(基准宽+GAP)）', () => {
    const pos = placeGrid(['a', null, 'b'], 3, CELL_WIDTH, baselineH, sizeOf({ a: { width: 320, height: 180 } }));
    expect(pos.get('a')).toEqual({ x: 0, y: 0 });
    expect(pos.get('b')!.x).toBe(2 * (CELL_WIDTH + CONVERT_GAP)); // 空槽占格推进——b 不被提前到第 2 槽
    expect(pos.get('b')!.y).toBe(0);
  });

  it('② 悬空 id 占格但不对任何节点输出坐标：后续槽位照常推进（残键惰性——store 按真实节点迭代取坐标）', () => {
    const pos = placeGrid(['ghost', 'b'], 2, CELL_WIDTH, baselineH, sizeOf({}));
    expect(pos.get('b')).toEqual({ x: CELL_WIDTH + CONVERT_GAP, y: 0 }); // ghost 槽按基准占格推进——b 不被提前
    // 注：placeGrid 对非 null id 一律产出 pos 键（含悬空残键），"无该 id 输出"的语义面在消费层——
    // store 侧 map 只对真实节点 pos.get（悬空 id 无节点 → 不产生任何节点坐标，plan :2313 注释同义）。
  });

  it('③ 异构尺寸 pitch=max(自身,基准)：500×300 与 320×180 同行 → 行高 = 300（次行 y = 300+GAP）', () => {
    const pos = placeGrid(['big', 'small', 'c'], 2, CELL_WIDTH, baselineH,
      sizeOf({ big: { width: 500, height: 300 }, small: { width: 320, height: 180 } }));
    expect(pos.get('big')).toEqual({ x: 0, y: 0 });
    // 列 pitch 同理：small 的槽被 big 的 500 宽撑开（列内 max(基准320, 500)=500）
    expect(pos.get('small')).toEqual({ x: 500 + CONVERT_GAP, y: 0 });
    expect(pos.get('c')!.y).toBe(300 + CONVERT_GAP);  // 行高 = max(300, 180) = 300，非基准 180
  });
});
