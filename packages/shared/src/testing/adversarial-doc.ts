// packages/shared/src/testing/adversarial-doc.ts
// Y0a-1（E70 最小版）：对抗 DocLike 工厂。节点/data 值一律 FakeMap 嵌套（plain object 会被
// docShape 值守卫跳过=空转）；scalar-node 一例专测守卫行为。零 yjs 依赖（shared 保持无 yjs）。
// 接口适配注记：DocMapLike.set/delete 实际签名返回 void，FakeMap 实现返回 this/boolean——
// TS 允许（非 void 返回可赋 void 期望）；DocLike 含 createMap（mk 已按实际接口供给，无需裁剪）。
import type { DocLike, DocMapLike } from '../canvas/docShape';

class FakeMap implements DocMapLike {
  constructor(private readonly backing = new Map<string, unknown>()) {}
  get(k: string) { return this.backing.get(k); }
  set(k: string, v: unknown) { this.backing.set(k, v); return this; }
  has(k: string) { return this.backing.has(k); }
  delete(k: string) { this.backing.delete(k); return true; }
  entries(): Iterable<[string, unknown]> { return this.backing.entries(); }
}

/** 递归嵌套：对象值→FakeMap；原始值原样（content/width 等叶子保持 string/number） */
const fm = (o: Record<string, unknown>): FakeMap => new FakeMap(new Map(
  Object.entries(o).map(([k, v]): [string, unknown] => [
    k, v !== null && typeof v === 'object' && !Array.isArray(v) ? fm(v as Record<string, unknown>) : v,
  ]),
));

export interface AdversarialCase { name: string; build(): DocLike }

export function generateAdversarialDocs(seed = 42): AdversarialCase[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const LONG = 'x'.repeat(1024 * 1024);
  const deep = (n: number): unknown => (n <= 0 ? { leaf: true } : { child: deep(n - 1) });
  const mk = (nodes: Record<string, unknown>, meta: Record<string, unknown> = {}) => (): DocLike => {
    const maps: Record<string, FakeMap> = { nodes: fm(nodes), edges: new FakeMap(), meta: fm(meta) };
    return { getMap: (n: string) => maps[n] ?? new FakeMap(), createMap: () => new FakeMap() };
  };
  return [
    { name: 'long-content', build: mk({ n1: { data: { content: LONG } } }) },
    { name: 'deep-128', build: mk({ n1: { data: deep(128) } }) },
    { name: 'parent-cycle', build: mk({ a: { parentId: 'b' }, b: { parentId: 'a' } }) },
    { name: 'unknown-fields', build: mk({ n1: { totally: 'unknown', data: { extra: 1 } } }) },
    { name: 'empty-maps', build: mk({ n1: { data: {} } }) },
    { name: 'type-confusion', build: mk({ n1: { x: 'str', data: { width: 'wide' } } }, { schemaVersion: 'not-a-number' }) },
    { name: 'scalar-node', build: () => {   // 值守卫专测：非 map 节点值 → 跳过
      const nodes = new FakeMap(new Map([['raw', 'just-a-string']]));
      return { getMap: (n: string) => (n === 'nodes' ? nodes : new FakeMap()), createMap: () => new FakeMap() };
    } },
    ...Array.from({ length: 8 }, (_, i): AdversarialCase => ({
      name: `fuzz-${i}`,
      build: mk({ [`f${i}`]: { x: rnd() > 0.5 ? LONG.slice(0, 1000) : rnd(), data: deep(1 + Math.floor(rnd() * 20)) } }),
    })),
  ];
}
