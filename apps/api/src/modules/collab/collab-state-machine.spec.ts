// apps/api/src/modules/collab/collab-state-machine.spec.ts
// Y0c T41 W2（片 B·B2 前置穷举单测——设计报告 t41-b2-design.md §6.1/§6.3-1）：collabState 七态
// 全矩阵语义钉住（GW 域——collabState 状态机单一所有者=gateway，V33 迁移单点 transition()，B2 不迁）。
// 覆盖缺口实证（设计 §6.1）：LEGAL_TRANSITIONS/collab_illegal_transition 于全部既有 spec 文件 0 命中
// ⇒ 全矩阵无覆盖=B2 新增。矩阵程序化生成：单源=collab.gateway.ts :263-271 现场解析（禁人估——
// Z140① 教训；「源码锚」用例钉解析结果===规格字面拷贝，任一侧漂移即红）。
// 钉死语义三条（V33 :272-280 现行——防 B2/B3「顺手改成拦截/去副作用」=行为变化）：
// ① 合法边：无 ERROR+跃迁后状态=to+collab_state 日志恰一条；
// ② 非法对：ERROR 点名 collab_illegal_transition（from/to/cause 全量）**但仍置位**（日志非拦截）
//    +collab_state 日志照发+serving 汇点副作用照常（onServingTransition 在 next==='serving' 无条件 :279）；
// ③ 自环 7 态：无 ERROR（next===current 跳过合法性检查 :273）+状态不变+collab_state 日志恰一条
//    +onServingTransition 恰在 next==='serving' 触发（serving 自环清 refusalCache、其余六态不清）。
// 分歧披露（纪律：设计报告与源码实测不符以源码为准）：设计 §6.1 记「15 条合法有向边/27 非法对」
// （49−15−7=27），源码 :263-271 实测 **18 条合法有向边/24 非法对**（49=18+7+24）——报告计数笔误，
// 本 spec 按源码现场解析生成矩阵并落数（上报控制方复核，禁自行改设计文档）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // 内部状态访问一律经 façade（check-collab-test-facade 门禁——本 spec 零违规）
import { CollabAuthReason } from '@flowweb/shared';

type CollabStateName = CollabGateway['collabState'];   // 联合型单源=collab.gateway.ts CollabState（façade forceCollabState 入参同型——typo 即编译红）

const STATES: CollabStateName[] = ['initializing', 'acquiring', 'starting', 'serving', 'draining', 'isolated', 'start-failed'];

/** LEGAL_TRANSITIONS 源码现场解析（矩阵生成单源——:263-271；定位失败=源码形态漂移即抛红） */
function parseLegalTransitionsFromSource(): Record<string, string[]> {
  const src = readFileSync(resolve(__dirname, 'collab.gateway.ts'), 'utf8');
  const m = /LEGAL_TRANSITIONS:\s*Record<string, string\[\]>\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(src);
  if (!m) throw new Error('LEGAL_TRANSITIONS 源码锚定位失败（改名/形态漂移——本 spec 生成器须同步核对）');
  const out: Record<string, string[]> = {};
  for (const em of m[1].matchAll(/'?([A-Za-z-]+)'?\s*:\s*\[([^\]]*)\]/g)) {
    out[em[1]] = em[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  return out;
}

/** 规格字面拷贝=collab.gateway.ts :263-271 逐行对照（2026-10-17 现场核实）——源码锚用例断言
 *  解析结果===本字面：源码演进未同步规格 ⇒ 红；解析器坏 ⇒ 红（双向判别力）。 */
const EXPECTED_LEGAL: Record<string, string[]> = {
  initializing: ['acquiring', 'starting'],
  acquiring: ['starting', 'draining', 'isolated'],
  starting: ['serving', 'start-failed', 'draining', 'isolated'],
  serving: ['draining', 'isolated'],
  draining: ['serving', 'isolated'],
  isolated: ['starting', 'draining'],   // rejoin 经 startCollabAfterLease→starting
  'start-failed': ['starting', 'draining', 'isolated'],
};

// ── 矩阵程序化生成（49 对全枚举三分：合法边/自环/非法对——穷举无遗漏由构造保证） ──
const LEGAL = parseLegalTransitionsFromSource();
const legalEdges: [CollabStateName, CollabStateName][] = [];
const illegalPairs: [CollabStateName, CollabStateName][] = [];
for (const from of STATES) {
  for (const to of STATES) {
    if (from === to) continue;   // 自环 7 对单列（transition :273 next===current 跳过合法性检查）
    if ((LEGAL[from] ?? []).includes(to)) legalEdges.push([from, to]);
    else illegalPairs.push([from, to]);
  }
}

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
let gateway: CollabGateway;
let gf: ReturnType<typeof gatewayFacade>;

beforeEach(async () => {
  const d = await makeSpoolDir('y0c-t41-statemachine-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  // 直构单元组（collab-degraded/collab-auth-defense 先例）——不 listen；矩阵只消费 transition/getCollabState/logger
  gateway = new CollabGateway(
    {} as any, new EventEmitter2() as any, createMockRepo() as any, createLeaseStub() as any,
    {} as any, 49000 + Math.floor(Math.random() * 1000),
    undefined, undefined, undefined, spool,
  );
  gf = gatewayFacade(gateway);
});
afterEach(async () => { vi.restoreAllMocks(); await spoolCleanup(); });

describe('T41 W2 源码锚：LEGAL_TRANSITIONS 现场解析=矩阵生成单源', () => {
  it('解析结果===规格字面拷贝（:263-271 逐行对照）+计数落数：18 合法有向边/7 自环/24 非法对（设计 §6.1 记 15/27 系笔误——头注披露，源码为准）', () => {
    expect(LEGAL).toEqual(EXPECTED_LEGAL);
    expect(Object.keys(LEGAL)).toHaveLength(7);   // 七态全在表（键集=STATES 同集）
    expect(new Set(Object.keys(LEGAL))).toEqual(new Set(STATES as string[]));
    expect(legalEdges).toHaveLength(18);
    expect(illegalPairs).toHaveLength(24);
  });

  it('全矩阵穷举划分：49 对 = 18 合法 + 7 自环 + 24 非法（无第四类——穷举完备性自证）', () => {
    expect(legalEdges.length + STATES.length + illegalPairs.length).toBe(49);
    expect(STATES).toHaveLength(7);
  });
});

describe('T41 W2 合法边 18 条逐条：跃迁生效+collab_state 日志恰一条+零 ERROR', () => {
  it.each(legalEdges)('%s→%s：置位 to+日志 from/to/cause 全量+无非法点名', (from, to) => {
    gf.forceCollabState(from);
    const errSpy = gf.spyLogger('error');
    const logSpy = gf.spyLogger('log');
    gf.transitionState(to, 'w2-legal');
    expect(gateway.getCollabState()).toBe(to);
    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);   // 恰一条（无重复副作用面）
    const payload = String(logSpy.mock.calls[0][0]);
    expect(payload).toContain('"event":"collab_state"');
    expect(payload).toContain(`"from":"${from}"`);
    expect(payload).toContain(`"to":"${to}"`);
    expect(payload).toContain('"cause":"w2-legal"');
  });
});

describe('T41 W2 非法对 24 对逐条：ERROR 点名 collab_illegal_transition+**仍置位**（日志非拦截——改成拦截即红）', () => {
  it.each(illegalPairs)('%s→%s：点名 from/to/cause+状态仍=to+collab_state 日志照发', (from, to) => {
    gf.forceCollabState(from);
    const errSpy = gf.spyLogger('error');
    const logSpy = gf.spyLogger('log');
    gf.transitionState(to, 'w2-illegal');
    expect(gateway.getCollabState()).toBe(to);   // 仍置位语义钉死（V33：点名是日志非拦截）
    expect(errSpy).toHaveBeenCalledTimes(1);
    const payload = String(errSpy.mock.calls[0][0]);
    expect(payload).toContain('"event":"collab_illegal_transition"');
    expect(payload).toContain(`"from":"${from}"`);
    expect(payload).toContain(`"to":"${to}"`);
    expect(payload).toContain('"cause":"w2-illegal"');
    expect(logSpy).toHaveBeenCalledTimes(1);   // collab_state 日志不因非法豁免（置位动作照常发生）
  });

  it('非法对→serving（恰 4 对）：onServingTransition 照常执行（:279 next===serving 无条件——副作用不因非法跳过=日志非拦截第二证据）', () => {
    const toServing = illegalPairs.filter(([, t]) => t === 'serving');
    expect(toServing.map(([f]) => f).sort()).toEqual(['acquiring', 'initializing', 'isolated', 'start-failed']);   // 恰 4 对（draining→serving 合法/serving 自环另列）
    for (const [from] of toServing) {
      gf.seedRefusal(`k-${from}`, CollabAuthReason.DRAINING, Date.now());
      expect(gf.refusalCacheSize()).toBe(1);
      gf.forceCollabState(from);
      gf.transitionState('serving', 'w2-illegal-serving');
      expect(gateway.getCollabState()).toBe('serving');
      expect(gf.refusalCacheSize()).toBe(0);   // refusalCache 清空照常（P-Q 清空单点副作用执行）
    }
  });
});

describe('T41 W2 自环 7 态逐条：无 ERROR（:273 跳过合法性检查）+状态不变+onServingTransition 恰在 next===serving', () => {
  it.each(STATES.map((s) => [s] as const))('%s→%s：零 ERROR+日志恰一条+serving 清 refusalCache/其余六态不清', (s) => {
    gf.seedRefusal('k-self', CollabAuthReason.DRAINING, Date.now());
    gf.forceCollabState(s);   // 直接置位（façade 白盒装置——非 transition，不产生清空副作用）
    const errSpy = gf.spyLogger('error');
    const logSpy = gf.spyLogger('log');
    gf.transitionState(s, 'w2-self');
    expect(errSpy).not.toHaveBeenCalled();   // 自环非非法（next===current 分支不查表）
    expect(gateway.getCollabState()).toBe(s);
    expect(logSpy).toHaveBeenCalledTimes(1);   // 不重复——每次跃迁恰一条 collab_state
    if (s === 'serving') expect(gf.refusalCacheSize()).toBe(0);   // serving 自环触发 onServingTransition
    else expect(gf.refusalCacheSize()).toBe(1);   // 其余六态不触发（「恰在 next===serving」双向钉死）
  });

  it('serving 汇点单点正证：draining→serving 合法跃迁 → refusalCache 全清+日志恰一条（不重复触发）', () => {
    gf.seedRefusal('k1', CollabAuthReason.DRAINING, Date.now());
    gf.seedRefusal('k2', CollabAuthReason.LEASE_NOT_READY, Date.now());
    gf.forceCollabState('draining');
    const logSpy = gf.spyLogger('log');
    gf.transitionState('serving', 'drain-auto-release');
    expect(gf.refusalCacheSize()).toBe(0);   // 两条全清（清空单点 P-Q）
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
