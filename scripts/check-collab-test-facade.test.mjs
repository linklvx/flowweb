// Y0c T39b B0：check-collab-test-facade.mjs 单元测试（node --test；check-collab-census.test.mjs 先例形态）。
// 只测纯 helper（universe 解析/别名收集/违规检测/触达计数）；端到端走 verify 链的
// `node scripts/check-collab-test-facade.mjs`。TDD 先红：脚本不存在时本文件 import 失败=红。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrivateMembers, collectGatewayAliases, findFacadeViolations, classifyTouch,
} from './check-collab-test-facade.mjs';
import { stripCommentsAndStrings } from './check-collab-census.mjs';

// 测试 universe 夹具（与真实 gateway 解析同规则的小样本）
const UNIVERSE = new Set(['pendingQueues', 'docProject', 'persistRetry', 'listenServer', 'closeAllConnections1012', 'transition', 'collabState', 'logger']);

/** 便捷：对源码文本跑违规检测（raw+stripped 双入——R3/R4 消费 raw，R1/R2 消费 stripped） */
function detect(src, universe = UNIVERSE) {
  return findFacadeViolations({ raw: src, stripped: stripCommentsAndStrings(src), universe });
}

// ── parsePrivateMembers：universe 解析（脚本内解析逻辑写死——gateway 演进自动跟随） ──

test('parsePrivateMembers：字段/方法/static/构造器参数属性/修饰符组合五形态', () => {
  const src = [
    'export class G {',
    '  private readonly pendingQueues = new Map();',          // readonly 字段
    '  private collabState: CollabState = "initializing";',   // 普通字段带类型
    '  private docTopNLogTimer: ReturnType<typeof setInterval> | null = null;',
    '  private static readonly LEGAL_TRANSITIONS: Record<string, string[]> = {};',   // static 常量
    '  private transition(next: string, cause?: string): void {}',                   // 方法
    '  private async startCollabAfterLease(): Promise<void> {}',                     // async 方法
    '  private static computeX() {}',                                                // static 方法
    '  constructor(',
    '    private readonly prisma: PrismaService,',                                   // 构造器参数属性
    '    private readonly spool: CollabSpoolService,',
    '  ) {}',
    '}',
  ].join('\n');
  const members = parsePrivateMembers(src);
  for (const m of ['pendingQueues', 'collabState', 'docTopNLogTimer', 'LEGAL_TRANSITIONS', 'transition', 'startCollabAfterLease', 'computeX', 'prisma', 'spool']) {
    assert.ok(members.includes(m), `${m} 应入 universe`);
  }
});

test('parsePrivateMembers：public/无修饰成员不入 universe（hooks/server/getCollabState 实况形态）', () => {
  const src = [
    'export class G {',
    '  readonly server: Server;',
    '  readonly hooks: { connected: () => void };',
    '  readonly storeFailedDocs = new Set<string>();',
    '  getCollabState() { return this.collabState; }',
    '  beginDraining() {}',
    '  public explicitPublic = 1;',
    '  private quota = 2;',
    '}',
  ].join('\n');
  const members = parsePrivateMembers(src);
  assert.deepEqual(members, ['quota']);
});

test('parsePrivateMembers：注释/字符串里的 private 字样不产成员（剥离器前置消费）', () => {
  const src = stripCommentsAndStrings([
    '// private notAMember: string;',
    'const s = "private alsoNot";',
    'export class G { private real = 1; }',
  ].join('\n'));
  assert.deepEqual(parsePrivateMembers(src), ['real']);
});

// ── collectGatewayAliases：别名定义收集（R2 前置） ──

test('collectGatewayAliases：gateway RHS 的 as any 与 : any 注解两形态；非 gateway RHS 排除', () => {
  const src = [
    'const g = gateway as any;',                       // 直接 gateway
    'const g2 = kit.gateway as any;',                  // kit.gateway 属性链
    'const gw: any = gateway;',                        // : any 注解形态（无 cast token）
    'const gw2 = this.gateway as any;',
    'const conn = [1, 2] as any;',                     // RHS 无 gateway 词——排除
    'const spoolRef = kit.spool as any;',              // 非 gateway 对象——排除
    'const payload = { document: doc } as any;',       // payload cast——排除
  ].join('\n');
  const aliases = collectGatewayAliases(stripCommentsAndStrings(src));
  assert.deepEqual([...aliases].sort(), ['g', 'g2', 'gw', 'gw2']);
});

// ── findFacadeViolations R1：直接 cast ∧ 私有成员链 ──

test('R1：(gateway as any).member 命中；两跳=每 cast occurrence 各计 1', () => {
  const v1 = detect('const q = (gateway as any).pendingQueues.get("p1");');
  assert.equal(v1.length, 1);
  assert.equal(v1[0].member, 'pendingQueues');
  assert.equal(v1[0].kind, 'cast');
  const v2 = detect('expect((gateway as any).pendingQueues.get((gateway as any).docProject.get(doc))).toBe(ref);');
  assert.equal(v2.length, 2, '两跳=两 cast occurrence=两违规点');
  assert.deepEqual(v2.map((v) => v.member).sort(), ['docProject', 'pendingQueues']);
});

test('R1：跨行 cast 成员链捕获（(gateway\\n as any)\\n .member 形态）', () => {
  const v = detect('const q = (gateway\n  as any)\n  .persistRetry.get(name);');
  assert.equal(v.length, 1);
  assert.equal(v.member ?? v[0].member, 'persistRetry');
});

test('R1：可选链 ?. 成员捕获（(gateway as any)?.pendingQueues 变体）', () => {
  const v = detect('const n = (gateway as any)?.pendingQueues?.size;');
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'pendingQueues');
});

test('R1 变体：as unknown as <类型名> 后接成员访问捕获（换写法绕过防线——Z140②）', () => {
  const v = detect('const q = (gateway as unknown as CollabGateway).pendingQueues;');
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'pendingQueues');
  const v2 = detect('const q = (kit.gateway as unknown as { x: number }).persistRetry;');
  assert.ok(v2.length >= 1, '带结构类型的 as unknown as 后成员访问仍须捕获');
});

test('R1 反例：payload cast/非 gateway 对象 cast/公有成员 cast 不违规', () => {
  assert.equal(detect('await gateway.hooks.onStoreDocument({ document: doc, documentName: name } as any);').length, 0, 'payload cast 无成员链');
  assert.equal(detect('expect((repo.append as any).mock.calls.length).toBe(1);').length, 0, 'mock 链非 universe');
  assert.equal(detect('await (gateway as any).server.destroy();').length, 0, 'server 公有成员——cast 冗余但非内部状态访问');
  assert.equal(detect('await (kit.gateway as any).hooks.onLoadDocument({} as any);').length, 0, 'hooks 公有');
  assert.equal(detect('const doc = serverDoc as unknown as Y.Doc;').length, 0, '纯类型转换无成员访问');
  assert.equal(detect('const m = doc.getMap(name) as unknown as DocMapLike;').length, 0);
});

test('R1 反例：注释/字符串里的 cast 形态不命中（剥离器消费面）', () => {
  const src = [
    '// (gateway as any).pendingQueues 注释提及',
    "const s = '(gateway as any).persistRetry';",
    'const ok = 1;',
  ].join('\n');
  assert.equal(detect(src).length, 0);
});

// ── findFacadeViolations R2：别名成员触达 ──

test('R2：别名定义后 X.member 逐处计数；公有成员触达不计', () => {
  const src = [
    'const g = kit.gateway as any;',
    'g.pendingQueues.set("p1", [u]);',
    'g.hooks.onStoreDocument(payload);',                    // hooks 公有——不计
    'const q = g.pendingQueues.get("p1");',
    'g.transition("draining", "test");',
  ].join('\n');
  const v = detect(src);
  assert.equal(v.length, 3, 'pendingQueues×2 + transition×1');
  assert.deepEqual(v.map((x) => x.member).sort(), ['pendingQueues', 'pendingQueues', 'transition']);
  assert.ok(v.every((x) => x.kind === 'alias'));
});

test('R2：别名赋值 LHS 形态捕获（g.collabState = "isolated" 直写）', () => {
  const src = [
    'const g = kit.gateway as any;',
    'g.collabState = "isolated";',
  ].join('\n');
  const v = detect(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'collabState');
});

test('R2 反例：同名局部非 gateway 别名不误报（文件级近似的边界自证——RHS 无 gateway 词不入别名集）', () => {
  const src = [
    'const g = someOtherThing as any;',
    'g.pendingQueues.set("p1", []);',
  ].join('\n');
  assert.equal(detect(src).length, 0);
});

// ── findFacadeViolations R3：spyOn 字符串成员（stripped 剥串结构性消失——raw 消费） ──

test('R3：spyOn(cast, "privateMethod") 与 spyOn(alias, "privateMethod") 两形态捕获', () => {
  const v1 = detect("const spy = vi.spyOn(gateway as any, 'listenServer').mockResolvedValue(undefined);");
  assert.equal(v1.length, 1);
  assert.equal(v1[0].member, 'listenServer');
  assert.equal(v1[0].kind, 'spyOn');
  const src2 = [
    'const g = kit.gateway as any;',
    "vi.spyOn(g, 'closeAllConnections1012').mockImplementation(() => {});",
  ].join('\n');
  const v2 = detect(src2);
  assert.equal(v2.filter((x) => x.kind === 'spyOn').length, 1);
  assert.equal(v2.find((x) => x.kind === 'spyOn').member, 'closeAllConnections1012');
});

test('R3 反例：spyOn 公有成员/非 gateway 对象不命中', () => {
  assert.equal(detect("vi.spyOn(gateway, 'beginDraining');").length, 0, 'beginDraining 公有且无 cast');
  const src = [
    'const g = kit.gateway as any;',
    "vi.spyOn(kit.spool, 'append').mockRejectedValue(new Error('x'));",
    "vi.spyOn(g, 'releaseAllResidentSessions').mockResolvedValue(undefined);",
  ].join('\n');
  assert.equal(detect(src).filter((x) => x.kind === 'spyOn').length, 0);
});

// ── findFacadeViolations R4：@ts-expect-error 抑制私有访问 ──

test('R4：@ts-expect-error 下一行私有成员访问捕获（无 cast 直访形态）', () => {
  const src = [
    '// @ts-expect-error 私有访问测试',
    'gateway.pendingQueues.clear();',
  ].join('\n');
  const v = detect(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'pendingQueues');
  assert.equal(v[0].kind, 'ts-expect-error');
});

test('R4：与同行 cast/alias 命中去重（同一触达点不双计）；无成员访问的 ts-expect-error 不计', () => {
  const src1 = [
    '// @ts-expect-error x',
    'const q = (gateway as any).pendingQueues;',
  ].join('\n');
  assert.equal(detect(src1).length, 1, 'cast 已计——ts-expect-error 不叠加');
  const src2 = [
    '// @ts-expect-error 类型不匹配',
    'await someFn(wrongTypeArg);',
  ].join('\n');
  assert.equal(detect(src2).length, 0);
});

// ── countMemberTouches：M1 统计口径（--report 消费，与执法口径分离） ──

test('classifyTouch：五形态分类（直调/赋值写/写/读/引用——三列清单第三列原料）', () => {
  assert.deepEqual(classifyTouch('g.pendingQueues.set("p1", [u]);', 'pendingQueues'), ['写']);
  assert.deepEqual(classifyTouch('const q = g.pendingQueues.get("p1");', 'pendingQueues'), ['读']);
  assert.deepEqual(classifyTouch('g.collabState = "isolated";', 'collabState'), ['赋值写']);
  assert.deepEqual(classifyTouch('await g.handoffPendingToSpool("p1");', 'handoffPendingToSpool'), ['直调']);
  assert.deepEqual(classifyTouch('expect(g.pendingQueues.has("p")).toBe(true);', 'pendingQueues'), ['读']);
  assert.deepEqual(classifyTouch('const before = g.pendingQueues.get("p");', 'pendingQueues'), ['读']);
  assert.deepEqual(classifyTouch('q.splice(0, 1); x.foo(g.pendingQueues);', 'pendingQueues'), ['引用']);
});
