// apps/api/src/modules/collab/adversarial-readers.spec.ts
// Y0a-1（Task 8 / E68 读侧铁律）：任意语料要么产出结果要么 typed 拒绝，绝不崩。
// 双路径：①FakeMap DocLike 直读（shared 语料工厂原样）②真 Y.Doc（fillDoc→toDocLike 读写双侧
// 适配——写侧同样走 toDocLike，Y.Doc 无 createMap，裸传 fillDoc 会 throw 被 catch 吞=断言真空）。
import { describe, it, expect } from 'vitest';
import { generateAdversarialDocs, readRecordsFromMaps, ensureSchemaVersion, fillDoc } from '@flowweb/shared';
import { toDocLike } from './doc-like.util';
import * as Y from 'yjs';

const cases = generateAdversarialDocs(42);
const byName = (n: string) => cases.find((c) => c.name === n)!;

describe('api 读者全函数（E68 读侧铁律：任意语料要么产出结果要么 typed 拒绝，绝不崩）', () => {
  it.each(cases.map((c) => [c.name]))('%s：FakeMap 路径 readRecordsFromMaps 不抛且返回数组', (name) => {
    const r = readRecordsFromMaps(byName(name).build());
    expect(Array.isArray(r.nodes)).toBe(true);
    expect(Array.isArray(r.edges)).toBe(true);
  });

  it('非空转锚：long-content 语料真的到达读者出口（防"守卫跳过一切"的 vacuous 绿）', () => {
    const r = readRecordsFromMaps(byName('long-content').build());
    expect(r.nodes).toHaveLength(1);
    expect((r.nodes[0].data as Record<string, unknown>).content).toHaveLength(1024 * 1024);
  });

  it('值守卫行为锚：scalar-node 跳过（nodes 空）不抛', () => {
    const r = readRecordsFromMaps(byName('scalar-node').build());
    expect(r.nodes).toHaveLength(0);
  });

  // E68 断言适配注记（实证）：yjs 写侧只收 JSON 值——Map/类实例值（语料 data 内嵌 FakeMap）
  // ⇒ Y.Map.set 抛 typed Error "Unexpected content type"（undefined 可往返、plain JSON 可写）。
  // typed Error=E68 允许的拒绝档（产出∨typed 拒绝，绝不崩）——按铁律原义断言而非 not.toThrow。
  // try 范围只包 fillDoc 写侧：读侧断言放 catch 后（防 AssertionError 被 catch 吞=假绿，且
  // 读侧自身崩溃不得与写侧 typed 拒绝混淆）。
  it.each(cases.map((c) => [c.name]))('%s：真 Y.Doc 路径（fillDoc→toDocLike 读写双侧适配）——产出或 typed 拒绝', (name) => {
    const doc = new Y.Doc();
    const r = readRecordsFromMaps(byName(name).build());
    let wrote = false;
    try {
      // 写侧同样走 toDocLike（Y.Doc 无 createMap——裸传 fillDoc 会 throw 被 catch 吞=断言真空）
      fillDoc(toDocLike(doc), r.nodes, r.edges);
      wrote = true;
    } catch (e) {
      expect(e).toBeInstanceOf(Error); // typed 拒绝合法档；非 Error 崩溃在此失败
    }
    const out = readRecordsFromMaps(toDocLike(doc));
    expect(Array.isArray(out.nodes)).toBe(true);
    expect(Array.isArray(out.edges)).toBe(true);
    if (wrote && r.nodes.length > 0) expect(out.nodes.length).toBeGreaterThan(0);   // 成功支非空转（输入有节点则往返后仍在——scalar-node 输入空集除外）
  });

  it('ensureSchemaVersion：要么放行要么抛 typed Error（畸形 meta 不崩进程）', () => {
    let threw = 0;
    for (const c of cases) {
      try { ensureSchemaVersion(c.build()); } catch (e) { expect(e).toBeInstanceOf(Error); threw += 1; }
    }
    expect(threw).toBeGreaterThan(0);   // 防退化空转：全放行（或语料全合法化）时此组断言不空转
  });
});
