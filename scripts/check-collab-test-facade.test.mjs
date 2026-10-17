// Y0c T39b B0：check-collab-test-facade.mjs 单元测试（node --test；check-collab-census.test.mjs 先例形态）。
// 只测纯 helper（universe 解析/别名收集/违规检测/触达计数）；端到端走 verify 链的
// `node scripts/check-collab-test-facade.mjs`。TDD 先红：脚本不存在时本文件 import 失败=红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePrivateMembers, collectGatewayAliases, findFacadeViolations, classifyTouch,
  buildUniverseFromFiles, UNIVERSE_FILES_REL,
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
  assert.equal(v[0].kind, 'ts-directive');   // M-1 扩展后 kind 更名（@ts-expect-error/@ts-ignore 同族）
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

// ── 波 1 评审收口修复（I-1/I-3/M-1/M-2）──

test('I-1 R1 受体限定：非 gateway 受体 cast 的 universe 同名成员放行（8 处假阳性根修——logger/repo 等通用名）', () => {
  // 三处实锤形态：collab-residency-reaper ×6 / collab-ready.controller ×1 / telemetry.controller ×1
  assert.equal(detect("const errSpy = vi.spyOn((fx.residency as any).logger, 'error');").length, 0, 'fx.residency 的 logger=CollabResidencyService 非 gateway');
  assert.equal(detect("const errSpy = vi.spyOn((controller as any).logger, 'error');").length, 0, 'controller.logger 非 gateway');
  assert.equal(detect("const logSpy = vi.spyOn((svc as any).logger, 'log');").length, 0, 'svc.logger 非 gateway');
  // 构造参数深层 gateway 词面不构成 RHS 资格（词面扩面伴生假阳性实锤——ready.controller :38/:187 复活根修）
  const src = [
    'controller = new CollabReadyController(readyMock as any, gatewayMock as any, auditMock as any);',
    "const errSpy = vi.spyOn((controller as any).logger, 'error');",
  ].join('\n');
  assert.equal(detect(src).length, 0, 'controller 不入别名集——RHS 头部 CollabReadyController 无 gateway 词面');
});

test('I-1 R1 受体限定：gateway 受体词（gateway/kit.gateway/gw/this.gateway）cast 的 universe 成员命中', () => {
  assert.equal(detect("const s = vi.spyOn((gateway as any).logger, 'error');").length, 1);
  assert.equal(detect("const s = vi.spyOn((kit.gateway as any).logger, 'error');").length, 1);
  assert.equal(detect("const s = vi.spyOn((gw as any).logger, 'error');").length, 1);
  assert.equal(detect("const s = vi.spyOn((this.gateway as any).logger, 'error');").length, 1);
  const v = detect("const s = vi.spyOn((kit.gateway as any).logger, 'error');");
  assert.equal(v[0].member, 'logger');
  assert.equal(v[0].kind, 'cast');
});

test('I-1 R1 受体限定扩面（实测裁决——窄词面丢 6 真阳性的根修）：类名静态/gw 前缀变体/别名受体三形态命中', () => {
  // 实锤形态：collab-auth-defense :337/:354 `(CollabGateway as any).AUTH_DB_DEADLINE_MS`（类名静态私有常量）
  assert.equal(detect('const ms = (CollabGateway as any).logger;').length, 1, '类名词面（大小写不敏感 gateway 子串）');
  // 实锤形态：collab-shrink :284/:300 `(gw2 as any).docTruth`（buildGateway 工厂返回的型化实例）
  assert.equal(detect('const t = (gw2 as any).pendingQueues;').length, 1, 'gw 前缀变体');
  // 实锤形态：collab-shrink :314 `(g as any).freezeQuota`（g=R2 已收 gateway 别名——受体词面∨别名集双支）
  const src = ['const g = gateway as any;', 'const q = (g as any).pendingQueues;'].join('\n');
  assert.equal(detect(src).filter((x) => x.kind === 'cast').length, 1, '别名受体经别名集判定');
});

test('B3 承接账⑤ 受体词面扩（Minor-3——sg/dr/sessionGuard/docRegistry 别名逃逸面闭合）：四形态命中+子串假阳性对照零命中', () => {
  // 词边界受体直接命中（(sg as any)/(dr as any) 旧词面逃逸形态）
  assert.equal(detect('const c = (sg as any).logger;').length, 1, 'sg 词边界受体');
  assert.equal(detect('const c = (dr as any).logger;').length, 1, 'dr 词边界受体');
  // camelCase service 名受体（kit.sessionGuard/kit.docRegistry 深层链形态）
  assert.equal(detect('const c = (kit.sessionGuard as any).logger;').length, 1, 'sessionGuard 词面');
  assert.equal(detect('const c = (kit.docRegistry as any).logger;').length, 1, 'docRegistry 词面');
  // RHS 资格面同扩（RECEIVER_GATEWAY_RE 同源）：service 别名入 R2 别名集
  const src = ['const sg2 = kit.sessionGuard as any;', 'const q = sg2.logger;'].join('\n');
  assert.equal(detect(src).filter((x) => x.kind === 'alias').length, 1, 'service 别名 R2 回收');
  // 假阳性对照：子串无词边界不命中（扩面误报面控制——现场评估依据）
  assert.equal(detect('const c = (sgStub as any).logger;').length, 0, 'sg 子串不命中（词边界）');
  assert.equal(detect('const c = (drainOpts as any).logger;').length, 0, 'dr 子串不命中（词边界）');
});

test('I-1 别名 RHS 词面扩（重基线实测裁决）：camelCase 工厂 RHS（makeBareGateway/buildGateway）入别名集', () => {
  // 实锤形态：旧 gateway.spec :1688 `const g2 = makeBareGateway()` + :1691 `(g2 as any).selfIsolate`
  // ——窄词面 \bgateway\b（大小写敏感）漏 camelCase 工厂名⇒该 cast 逃逸（重基线 534→525 而非 526 的 −1 根因）
  const src = [
    'const g2 = makeBareGateway();',
    "await (g2 as any).listenServer();",
  ].join('\n');
  const v = detect(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'listenServer');
  assert.equal(v[0].kind, 'cast');
  // 别名成员触达同链（R2 消费同一别名集）
  const src2 = [
    'const gw3 = buildGateway({ x: 1 }) as any;',
    'gw3.pendingQueues.clear();',
  ].join('\n');
  assert.equal(detect(src2).length, 1);
});

test('I-1 免 cast 型化局部不入别名成员扫描（DTO/façade 假阳性根修——degraded ×7/试点 ×9 实锤）', () => {
  // 实锤形态一：公有方法返回 DTO 同名字段裸读=合法公有访问（degraded :60-84 `d = gateway.computeDegraded()`）
  const src = [
    'const dto = gateway.computeDegraded();',
    'expect(dto.logger).toBeNull();',
  ].join('\n');
  assert.equal(detect(src).length, 0, '免 cast 型化局部不进 R2 成员扫描');
  // 实锤形态二：façade 工厂对象直调转发同名方法（试点 :127 `g = gatewayFacade(gateway)` + g.listenCollab()）
  const src2 = [
    'const g = gatewayFacade(kit.gateway);',
    'await g.listenServer();',
  ].join('\n');
  assert.equal(detect(src2).length, 0, 'façade 转发面同名方法非绕过');
});

test('I-3① R1 括号计算访问：cast 后 [\'member\'] 字符串字面量成员捕获（平衡括号跳过不再吃掉）', () => {
  const v = detect("const q = (gateway as any)['pendingQueues'];");
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'pendingQueues');
  assert.equal(v[0].kind, 'cast');
  const v2 = detect('const q = (kit.gateway as any)?.["persistRetry"];');
  assert.equal(v2.length, 1, '?.[ 形态');
  assert.equal(v2[0].member, 'persistRetry');
  assert.equal(detect("const q = (fx.residency as any)['logger'];").length, 0, '受体限定同样适用于括号形态');
  assert.equal(detect("const q = (gateway as any)['notAMember'];").length, 0, '非 universe 成员不计');
});

test('I-3② R2 解构形态：const { member } = gateway as any 解构绑定名 ∈ universe 逐处计数', () => {
  const v = detect('const { pendingQueues } = gateway as any;');
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'pendingQueues');
  assert.equal(v[0].kind, 'alias');
  const v2 = detect('const { pendingQueues: pq, docProject } = kit.gateway as any;');
  assert.equal(v2.length, 2, '重命名形态取属性键+多绑定逐处');
  assert.deepEqual(v2.map((x) => x.member).sort(), ['docProject', 'pendingQueues']);
  assert.equal(detect('const { x } = foo as any;').length, 0, 'RHS 无 gateway 词不计');
  assert.equal(detect('const { server } = gateway as any;').length, 0, '公有成员不计');
});

test('I-3③ R2 赋值语句别名：let g; g = kit.gateway as any 后续 g.member 逐处计数', () => {
  const src = [
    'let g;',
    'g = kit.gateway as any;',
    'g.pendingQueues.clear();',
    'g.transition("draining", "test");',
  ].join('\n');
  const v = detect(src);
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((x) => x.member).sort(), ['pendingQueues', 'transition']);
  assert.ok(v.every((x) => x.kind === 'alias'));
  const src2 = ['let h;', 'h = someOther as any;', 'h.pendingQueues.clear();'].join('\n');
  assert.equal(detect(src2).length, 0, 'RHS 无 gateway 词不入别名集');
});

test('I-3④ 已知边界钉：函数参数别名形态=已知逃逸面（行级检测不可行需数据流分析——波 2 全量替换纪律+评审承担）', () => {
  const src = [
    'function poke(g: any) { g.pendingQueues.clear(); }',
    'poke(kit.gateway as any);',
  ].join('\n');
  // 逃逸面实证钉：参数别名不入别名集、调用点 cast 无成员链⇒零命中。此形态由波 2 替换纪律承担，
  // 门禁不执法（数据流分析超出符号级门禁口径——偏离 62② 近似边界同族披露）。
  assert.equal(detect(src).length, 0);
});

test('M-1 R4 扩展：@ts-ignore 下一行私有成员访问捕获（Z140② 同族绕过形态；kind=ts-directive）', () => {
  const src = [
    '// @ts-ignore 私有访问',
    'gateway.pendingQueues.clear();',
  ].join('\n');
  const v = detect(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].member, 'pendingQueues');
  assert.equal(v[0].kind, 'ts-directive');
});

test('M-2 parsePrivateMembers：private get/set 访问器——修饰词不入 universe、访问器名入 universe', () => {
  const src = [
    'class G {',
    '  private get foo() { return this.x; }',
    '  private set bar(v: number) { this.x = v; }',
    '  private static get baz() { return 1; }',
    '  private settings = new Map();',   // set 前缀同名词不误吞
    '}',
  ].join('\n');
  assert.deepEqual(parsePrivateMembers(src), ['bar', 'baz', 'foo', 'settings']);
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

// ── T41 W4（偏离 71/RC6-a）：universe 扩三文件（gateway+SG+DR）——执法加强非放松 ──

test('W4 buildUniverseFromFiles：多文件私有成员合并入单一 universe（去重、逐文件解析）', () => {
  const gwSrc = 'class G { private collabState = "initializing"; private transition() {} }';
  const sgSrc = 'class SG { private sweepKickPending = false; private sweepIntervalMs() {} }';
  const drSrc = 'class DR { private docTruth = new Map(); private collabState = "dup-name"; }';
  const u = buildUniverseFromFiles([gwSrc, sgSrc, drSrc]);
  for (const m of ['collabState', 'transition', 'sweepKickPending', 'sweepIntervalMs', 'docTruth']) {
    assert.ok(u.has(m), `${m} 应入合并 universe`);
  }
  assert.ok(u instanceof Set, 'universe 为 Set（重名成员自然去重——findFacadeViolations 消费面不变）');
});

test('W4 buildUniverseFromFiles：注释/字符串内 private 不产成员（剥离器逐文件前置消费——单文件同规则）', () => {
  const u = buildUniverseFromFiles([
    '// private notAGatewayMember: string;',
    'class SG { /* private notASgMember() {} */ private realSg = 1; }',
    'const s = "private notADrMember"; class DR { private realDr = 2; }',
  ]);
  assert.deepEqual([...u].sort(), ['realDr', 'realSg']);
});

test('W4 合并 universe 下 SG/DR 私有成员触达被回收（扩面=执法加强实证：单 gateway universe 逃逸→合并 universe 违规）', () => {
  const line = 'expect((gateway as any).sweepKickPending).toBe(true);';
  const gwOnly = new Set(parsePrivateMembers('class G { private collabState = 1; }'));
  assert.equal(detect(line, gwOnly).length, 0, '扩面前：SG 成员不在 gateway universe=逃逸（空心化实锤）');
  const merged = buildUniverseFromFiles([
    'class G { private collabState = 1; }',
    'class SG { private sweepKickPending = false; }',
  ]);
  const v = detect(line, merged);
  assert.equal(v.length, 1, '扩面后：同一触达点回收为违规');
  assert.equal(v[0].member, 'sweepKickPending');
  assert.equal(v[0].kind, 'cast');
});

test('W4 UNIVERSE_FILES_REL：恰三文件=gateway+SG+DR（偏离 71 写死清单——防漂移钉）', () => {
  assert.deepEqual(UNIVERSE_FILES_REL, [
    'apps/api/src/modules/collab/collab.gateway.ts',
    'apps/api/src/modules/collab/collab-session-guard.service.ts',
    'apps/api/src/modules/collab/collab-doc-registry.service.ts',
  ]);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const r of UNIVERSE_FILES_REL) {
    assert.ok(fs.existsSync(path.join(root, r)), `${r} 应存在于仓库（清单≡磁盘对账）`);
  }
});
