#!/usr/bin/env node
// Y0c T39b B0（plan T39b 行 v4=Z140 全面改写；控制方裁决 RB0 门禁+枚举一体）：
// collab 测试面「只能经 façade 访问 gateway 内部状态」门禁 + 步骤 0 枚举报告双模式脚本。
//
// ── 违规定义（计数口径写死——Z140②「全形态」非单一拼写正则；Z43「符号级非语法级」同教训）──
// 违规 = 绕过类型系统访问 gateway 内部状态 = cast 形态 ∧ gateway 私有成员触达（合取语义）：
//   cast 形态 ∈ { `as any`, `as unknown as`, `@ts-expect-error` }；
//   私有成员 universe = 本脚本从 collab.gateway.ts 现场解析（private 字段+私有方法+static 常量
//   +构造器参数属性——解析逻辑写死，gateway 演进自动跟随，无人工名单漂移面）。
// 检测规则四则（每触达点计 1；kind 标注来源规则）：
//   R1 cast：stripped 源 `as any`/`as unknown as` token occurrence，其后成员链（跨行、`?.`、
//      平衡 {}[]<>、类型名标识符跳过 ≤1 次）任一成员 ∈ universe ⇒ 违规。类型名跳过限 1 次=
//      防 ASI 无分号跨语句漂移（本仓风格恒分号结尾；已知近似边界，自测钉行为）。
//   R2 别名：`const g = <RHS 含 gateway 词> as any` / `const gw: any = <RHS 含 gateway 词>`
//      定义的文件级别名集（文件级近似=不做作用域分析——同名遮蔽场景由基线登记红人工复核吸收；
//      二级别名 `const h = g` 不传播，现状零出现），后续 `alias.member`（member ∈ universe）
//      逐处违规。RHS 无 gateway 词的 any 别名（mock/spool/payload）不入集=非 gateway 对象
//      的 as any 不违规（Z140② 合取语义）。
//   R3 spyOn 字符串成员：`vi.spyOn(<cast 形态|别名|gateway 词>, '<member>')`——member 是字符串
//      字面量（stripped 剥串结构性消失⇒raw 行消费，census 组⑦同则）。arg1 含逗号形态不支持
//      （现状零出现）。
//   R4 @ts-expect-error：指令注释行（raw 检测）的下一行 stripped 触达 universe 成员 ⇒ 违规；
//      下一行已被 R1/R2/R3 命中则不重复计（同一触达点去重——口径写死）。
// 非违规面（合取语义的另一半）：payload cast（`} as any)`）、mock 链（`(repo.append as any).mock`）、
//   非 gateway 对象成员（`(kit.spool as any).ioBroken`——spool 私有成员不在本门禁 universe，
//   B 波后续任务面）、gateway 公有成员 cast（`(gateway as any).server`——冗余但非内部状态）。
//
// ── 范围（自定义写死）──
// 执法面 = apps/api/src/modules/collab/*.spec.ts（顶层 75 文件，*.int.spec.ts 被 *.spec.ts 后缀
// 覆盖）。理由：B 波=gateway 领域 service 化，façade 门禁执法面=collab 域 spec；collab 域外
// spec 经 grep 实证零 gateway 私有成员触达（worker-metrics-server.spec/di-smoke.int.spec 仅
// 类型引用）。扩面时机=B 波出口复验（T43）。
// 豁免面 = collab-gateway-test-facade.ts 本体（唯一 sanctioned 绕点——受控 cast 集中地）：
//   非 .spec.ts 后缀⇒天然不在扫描面（结构性豁免，脚本内 assert 自证不进扫描清单）。
//
// ── 双模式 ──
// 默认=门禁：违规计数（file×'facade-bypass'）与 REGISTERED_RED 经 reconcileRegisteredRed
//   （census :267 复用）三向对账——unregistered/drift/stale 任一非空=FAIL exit 1。基线登记红
//   until='T39b-2'：波 2 机械替换推进时计数下降=drift 红⇒强制同步降登记；文件清零=stale 红⇒
//   强制移除登记；终态登记空=全绿。
// --report=步骤 0 枚举（plan T39b「清单由脚本产出非人估」）：三列清单（成员→所属目标 service
//   〔Z24 归属地图——MEMBER_OWNERSHIP 写死，未列成员标 UNMAPPED 待人工补〕→访问形态分布）
//   + 触达统计双口径（M1=触达处数〔.member 出现逐处——spec 内私有名触达必经 any 型对象，
//   名字级近似含非 gateway 对象同名人，report 输出 member×file 明细供人工复核〕；M2=distinct
//   成员数）+ 违规基线表（file×count×kind）+ top 触达表。重跑命令=
//   `node scripts/check-collab-test-facade.mjs --report`。
// 退出码：0=PASS；1=FAIL；2=结构性错误（gateway 文件缺失/universe 空/spec 面为空）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsAndStrings, reconcileRegisteredRed } from './check-collab-census.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

export const GATEWAY_REL = 'apps/api/src/modules/collab/collab.gateway.ts';
export const FACADE_REL = 'apps/api/src/modules/collab/test-utils/collab-gateway-test-facade.ts';
export const SPEC_DIR_REL = 'apps/api/src/modules/collab';

// ── universe 解析（写死——gateway 演进自动跟随） ──

/** private 成员名解析：字段/方法/static/构造器参数属性，修饰符组合宽松序。
 *  输入=stripped 源（注释/字符串里的 private 字样结构性消失——自测钉）。 */
export function parsePrivateMembers(strippedSrc) {
  const names = new Set();
  const re = /\bprivate\s+(?:(?:static|readonly|abstract|override|async)\s+)*([A-Za-z_$][\w$]*)/g;
  for (const m of strippedSrc.matchAll(re)) names.add(m[1]);
  return [...names].sort();
}

/** gateway 别名的 any 别名定义收集（R2 前置）：行级两形态——
 *  `const X = <RHS 含 \bgateway\b> as any` / `const X: any = <RHS 含 \bgateway\b>`。 */
export function collectGatewayAliases(strippedSrc) {
  const aliases = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*any\s*)?=\s*([^;\n]*)/g;
  for (const m of strippedSrc.matchAll(re)) {
    const rhs = m[2];
    if (!/\bgateway\b/.test(rhs)) continue;
    if (/\bas\s+(?:any|unknown\s+as)\b/.test(rhs) || /:\s*any\s*=/.test(m[0])) aliases.add(m[1]);
  }
  return aliases;
}

// ── R1 cast 成员链扫描 ──

const CAST_TOKEN_RE = /\bas\s+any\b|\bas\s+unknown\s+as\b/g;

/** 从 cast token 结束位向前扫成员链：跳过空白（含换行）/`)`/`?`/平衡 {}[]<>；标识符跳过
 *  ≤1 次（as unknown as 的类型名）；`.` 后 ident 收集；其他字符停。返回成员名数组。 */
export function scanMemberChainAfter(src, fromIndex) {
  const chain = [];
  let i = fromIndex;
  let identSkips = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === ')' || c === '?') { i += 1; continue; }
    if (c === '{' || c === '[' || c === '<') {           // 类型表达式平衡跳过
      const close = c === '{' ? '}' : c === '[' ? ']' : '>';
      let d = 1; i += 1;
      while (i < src.length && d > 0) {
        if (src[i] === c) d += 1;
        else if (src[i] === close) d -= 1;
        i += 1;
      }
      continue;
    }
    if (c === '.') {
      const m = /^\.?\s*([A-Za-z_$][\w$]*)/.exec(src.slice(i));
      if (!m) return chain;
      chain.push(m[1]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {                            // 类型名标识符（限 1 次）
      if (identSkips >= 1) return chain;
      identSkips += 1;
      while (i < src.length && /[\w$]/.test(src[i])) i += 1;
      continue;
    }
    return chain;                                          // `;` `,` `(` `=` 等——表达式边界
  }
  return chain;
}

// ── 违规检测（四则合一；每触达点计 1） ──

/** 返回 [{ line, kind: 'cast'|'alias'|'spyOn'|'ts-expect-error', member, text }]（line 升序）。 */
export function findFacadeViolations({ raw, stripped, universe }) {
  const out = [];
  const lineOf = (idx) => stripped.slice(0, idx).split('\n').length;
  const rawLines = raw.split('\n');
  const stLines = stripped.split('\n');

  // R1 直接 cast
  for (const m of stripped.matchAll(CAST_TOKEN_RE)) {
    const chain = scanMemberChainAfter(stripped, m.index + m[0].length);
    const hit = chain.find((id) => universe.has(id));
    if (hit) {
      const ln = lineOf(m.index);
      out.push({ line: ln, kind: 'cast', member: hit, text: (stLines[ln - 1] ?? '').trim() });
    }
  }

  // R2 别名成员触达
  const aliases = collectGatewayAliases(stripped);
  if (aliases.size) {
    const aliasRe = new RegExp(`\\b(${[...aliases].join('|')})\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    stLines.forEach((l, idx) => {
      for (const m of l.matchAll(aliasRe)) {
        if (universe.has(m[2])) out.push({ line: idx + 1, kind: 'alias', member: m[2], text: l.trim() });
      }
    });
  }

  // R3 spyOn 字符串成员（raw 行级——字符串内容 stripped 结构性消失）
  const spyRe = /spyOn\s*\(\s*([^,]+?)\s*,\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  rawLines.forEach((l, idx) => {
    for (const m of l.matchAll(spyRe)) {
      const [, arg1, member] = m;
      if (!universe.has(member)) continue;
      const bypass = /\bas\s+(?:any|unknown)\b/.test(arg1) || /\bgateway\b/.test(arg1)
        || [...aliases].some((a) => new RegExp(`^\\s*${a}\\b`).test(arg1));
      if (bypass) out.push({ line: idx + 1, kind: 'spyOn', member, text: l.trim() });
    }
  });

  // R4 @ts-expect-error（raw 指令注释行检测；下一行 stripped 成员触达——与同行 R1/R2/R3 去重）
  rawLines.forEach((l, idx) => {
    if (!/(?:\/\/|\/\*|^\s*\*).*@ts-expect-error/.test(l)) return;
    const nextIdx = idx + 1;
    if (nextIdx >= rawLines.length) return;
    if (out.some((v) => v.line === nextIdx + 1)) return;   // 去重：下一行已被 cast/alias/spyOn 计
    const nextStripped = stLines[nextIdx] ?? '';
    for (const m of nextStripped.matchAll(/\.([A-Za-z_$][\w$]*)/g)) {
      if (universe.has(m[1])) {
        out.push({ line: nextIdx + 1, kind: 'ts-expect-error', member: m[1], text: nextStripped.trim() });
      }
    }
  });

  return out.sort((a, b) => a.line - b.line);
}

// ── 触达形态分类（三列清单第三列原料） ──

/** 触达点访问形态启发式分类：行文本内 `.member` 后续 token 判定。
 *  直调=member(…)｜赋值写=member = …｜写=.set/.delete/.add/.clear/.unshift/.push/.splice(…)
 *  ｜读=.get/.has/.size/.length/.peek｜引用=其他（含身份引用——数组身份断言由 toBe 行承担）。
 *  spyOn 违规点成员是字符串实参形态（无 `.member` 链）——单独归 'spyOn直调'。 */
export function classifyTouch(lineText, member) {
  const re = new RegExp(`\\.${member}\\b`, 'g');
  const cats = [];
  for (const m of lineText.matchAll(re)) {
    const after = lineText.slice(m.index + m[0].length);
    if (/^\s*\(/.test(after)) cats.push('直调');
    else if (/^\s*=([^=])/.test(after)) cats.push('赋值写');
    else if (/^\s*\.\s*(?:set|delete|add|clear|unshift|push|splice)\s*\(/.test(after)) cats.push('写');
    else if (/^\s*\.\s*(?:get|has|size|length|peek)\b/.test(after)) cats.push('读');
    else cats.push('引用');
  }
  return cats;
}

// ── Z24 归属地图（成员→目标 service——三列清单第二列；勘察 :234-346 区段地图+源码核读。
//    未列成员=UNMAPPED（report 输出待人工补——不执法）。B1/B2/B3 切分地图原料。 ──
export const MEMBER_OWNERSHIP = {
  // Persistence=store/spool/drain/pending 持久化态
  pendingQueues: 'Persistence', docProject: 'Persistence', docListeners: 'Persistence',
  flushScheduled: 'Persistence', pendingSince: 'Persistence', lastCompactAt: 'Persistence',
  persistUnhealthy: 'Persistence', persistRetry: 'Persistence', persistStatusPushed: 'Persistence',
  retryingPersistDocs: 'Persistence', inFlightProjects: 'Persistence', deletedProjects: 'Persistence',
  replaying: 'Persistence', spool: 'Persistence', repo: 'Persistence',
  storeDocumentSerialized: 'Persistence', storeDocumentUnlocked: 'Persistence',
  handoffPendingToSpool: 'Persistence', computePending: 'Persistence', splitPersistChunks: 'Persistence',
  rearmQueues: 'Persistence', retryPersist: 'Persistence', schedulePersistRetry: 'Persistence',
  cancelPersistRetry: 'Persistence', reconcileSpool: 'Persistence', pollPendingDrained: 'Persistence',
  discardForGoneProject: 'Persistence', enterInFlight: 'Persistence', leaveInFlight: 'Persistence',
  oldestUnflushedAt: 'Persistence', oldestUnflushedAgeSeconds: 'Persistence', writesSettled: 'Persistence',
  peekSpoolFrames: 'Persistence', setPersistStatus: 'Persistence', pushPersistStatus: 'Persistence',
  spoolStateForAuth: 'Persistence', lastSpoolState: 'Persistence', maybeCompact: 'Persistence',
  scheduleSoftFlush: 'Persistence', spoolReconcilerTimer: 'Persistence', startSpoolReconciler: 'Persistence',
  drainAllDocuments: 'Persistence',
  // SessionGuard=连接鉴权/限流/awareness 判定
  upgradeBucket: 'SessionGuard', msgBuckets: 'SessionGuard', bytesBuckets: 'SessionGuard',
  awareBuckets: 'SessionGuard', refusalCache: 'SessionGuard', authInflight: 'SessionGuard',
  authInflightPeak: 'SessionGuard', authAttemptBuckets: 'SessionGuard', connEstablishedAt: 'SessionGuard',
  connectionIds: 'SessionGuard', clientIdOwner: 'SessionGuard', ownedClientIds: 'SessionGuard',
  ownedClientIdsOf: 'SessionGuard', socketIdentity: 'SessionGuard', socketIdOf: 'SessionGuard',
  serverIdentityOf: 'SessionGuard', awarenessDriftLogged: 'SessionGuard', permCache: 'SessionGuard',
  permRecheckDue: 'SessionGuard', sweepGrace: 'SessionGuard', sweepRecheckFails: 'SessionGuard',
  sessionSweepTimer: 'SessionGuard', authMapsSweepTimer: 'SessionGuard', writeFreeze: 'SessionGuard',
  overPush: 'SessionGuard', recheckRounds: 'SessionGuard', freezeReasons: 'SessionGuard',
  authenticate: 'SessionGuard', authenticateInner: 'SessionGuard', denyAuth: 'SessionGuard',
  guardMessageFrame: 'SessionGuard', guardAwareness: 'SessionGuard', guardAwarenessRate: 'SessionGuard',
  guardSyncFrame: 'SessionGuard', recheckConnection: 'SessionGuard', sweepSessions: 'SessionGuard',
  scheduleImmediateSweep: 'SessionGuard', scheduleSweepClose: 'SessionGuard', startSessionSweep: 'SessionGuard',
  sweepStaleAuthMaps: 'SessionGuard', startAuthMapsSweeper: 'SessionGuard', applyWriteFreeze: 'SessionGuard',
  rewriteAwarenessRole: 'SessionGuard', wirePermChangedEvents: 'SessionGuard', perm: 'SessionGuard',
  sessionSvc: 'SessionGuard', authAttemptsPerMin: 'SessionGuard', authInflightMax: 'SessionGuard',
  refusalTtlMs: 'SessionGuard', allowedOrigins: 'SessionGuard', trustedProxyEnabled: 'SessionGuard',
  clientIpOf: 'SessionGuard', withAuthDeadline: 'SessionGuard', onServingTransition: 'SessionGuard',
  sweepIntervalMs: 'SessionGuard', sweepKickPending: 'SessionGuard', connMaxLifetimeMs: 'SessionGuard',
  enforceConnMaxLifetime: 'SessionGuard', hardClose: 'SessionGuard', hardCloseWs: 'SessionGuard',
  disconnect: 'SessionGuard', closeAllConnections1012: 'SessionGuard', graceDirectConnections: 'SessionGuard',
  handleUpgrade: 'SessionGuard', rejectUpgrade: 'SessionGuard', isPortError: 'SessionGuard',
  wrapBackpressure: 'SessionGuard', backpressureWrapped: 'SessionGuard',
  // DocRegistry=doc 生命周期账目+常驻表
  docTruth: 'DocRegistry', docDelta: 'DocRegistry', truthMeasuredAt: 'DocRegistry',
  degradedDocs: 'DocRegistry', unloadHeapAnchors: 'DocRegistry', docEpoch: 'DocRegistry',
  docGeneration: 'DocRegistry', docResidue: 'DocRegistry', docStatusRev: 'DocRegistry',
  docStatusState: 'DocRegistry', vacuumingDocs: 'DocRegistry', preVacuumSvCache: 'DocRegistry',
  autoVacuumLastAt: 'DocRegistry', quotaFrozenDocs: 'DocRegistry', freezePending: 'DocRegistry',
  freezePendingTimers: 'DocRegistry', thawCooldown: 'DocRegistry', truthBudgetState: 'DocRegistry',
  docStuckRounds: 'DocRegistry', stuckDocsSeen: 'DocRegistry', heapObserverTimer: 'DocRegistry',
  docTopNLogTimer: 'DocRegistry', vacuumRunner: 'DocRegistry', residentSessionReleaser: 'DocRegistry',
  residentSessionsProbe: 'DocRegistry', loadDocument: 'DocRegistry', measureTruth: 'DocRegistry',
  updateResidue: 'DocRegistry', broadcastDocStatus: 'DocRegistry', buildDocStatus: 'DocRegistry',
  observeDocBytes: 'DocRegistry', observeIdleDocs: 'DocRegistry', logDocTopN: 'DocRegistry',
  freezeQuota: 'DocRegistry', thawQuota: 'DocRegistry', recheckFrozenDocs: 'DocRegistry',
  scheduleFreezePending: 'DocRegistry', startFrozenRecheckTimer: 'DocRegistry', frozenRecheckTimer: 'DocRegistry',
  truthBudgetRecord: 'DocRegistry', truthBudgetTryTake: 'DocRegistry', quotaStateOf: 'DocRegistry',
  handleProjectsGone: 'DocRegistry', drainDetachedProject: 'DocRegistry', heapPressureSample: 'DocRegistry',
  heapUsedNow: 'DocRegistry', overloadTripped: 'DocRegistry', syncOverloadGauge: 'DocRegistry',
  startHeapObserver: 'DocRegistry', quota: 'DocRegistry', pgBreaker: 'DocRegistry',
  isEmptyState: 'DocRegistry', raceDeadline: 'DocRegistry', stripTransientFields: 'DocRegistry',
  // 不搬=钩子编排/协议适配/进程状态机留 gateway 本体
  hooks: '不搬', collabState: '不搬', transition: '不搬', LEGAL_TRANSITIONS: '不搬',
  initDone: '不搬', startInFlight: '不搬', shuttingDown: '不搬', listenerClosed: '不搬',
  listenRetries: '不搬', watchdogFired: '不搬', watchdogTimer: '不搬', listenCollab: '不搬',
  listenServer: '不搬', startCollabAfterLease: '不搬', selfIsolate: '不搬',
  startServingWatchdog: '不搬', logger: '不搬', eventEmitter: '不搬', prisma: '不搬',
  lease: '不搬', afterStoreDocument: '不搬', afterUnloadDocument: '不搬', unloadDocument: '不搬',
  broadcastSpoolDegraded: '不搬', clearDrainTimer: '不搬', drainAutoReleaseTimer: '不搬',
  REFUSAL_CACHEABLE: 'SessionGuard', AUTH_DB_DEADLINE_MS: 'SessionGuard',
  PERM_RECHECK_TTL_MS: 'SessionGuard', AWARENESS_CLIENT_ID_LIMIT: 'SessionGuard',
  PERSIST_MERGE_MAX_BYTES: 'Persistence',
};

// ── 基线登记红（元纪律⑥：现状违规数按文件登记——2026-10-16 T39b B0 步骤 0 实测回填，空登记
//    跑出真红 exit 1 后落表；reconcileRegisteredRed 复用 census :267。until='T39b-2'=波 2 机械
//    替换；计数下降 drift 红⇒强制同步降登记、清零 stale 红⇒强制移除登记、终态登记空。
//    key 固定 'facade-bypass'（文件级粒度——控制方 RB0）。总计 534 处/31 文件。 ──
const REGISTERED_RED = {
  'apps/api/src/modules/collab/collab-auth-defense.spec.ts': { 'facade-bypass': { n: 30, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-awareness-guard.spec.ts': { 'facade-bypass': { n: 12, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-backpressure.spec.ts': { 'facade-bypass': { n: 1, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-degraded.spec.ts': { 'facade-bypass': { n: 4, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-heap-gate.spec.ts': { 'facade-bypass': { n: 9, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-metrics-observability.spec.ts': { 'facade-bypass': { n: 32, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-perm-chain.spec.ts': { 'facade-bypass': { n: 1, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-perm-events.spec.ts': { 'facade-bypass': { n: 29, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-pg-breaker.int.spec.ts': { 'facade-bypass': { n: 4, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-pg-breaker.service.spec.ts': { 'facade-bypass': { n: 9, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-quota-gate.spec.ts': { 'facade-bypass': { n: 25, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-quota-truth.spec.ts': { 'facade-bypass': { n: 41, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-rate-gate.spec.ts': { 'facade-bypass': { n: 6, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-ready.controller.spec.ts': { 'facade-bypass': { n: 1, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-reconnect-storm.spec.ts': { 'facade-bypass': { n: 3, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-residency-reaper.spec.ts': { 'facade-bypass': { n: 6, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-runtime-metrics.spec.ts': { 'facade-bypass': { n: 4, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-sentry.spec.ts': { 'facade-bypass': { n: 9, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-shrink.spec.ts': { 'facade-bypass': { n: 67, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-t20-ripples.spec.ts': { 'facade-bypass': { n: 9, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-upgrade.spec.ts': { 'facade-bypass': { n: 8, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-version-gate.spec.ts': { 'facade-bypass': { n: 1, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab-write-endpoint.int.spec.ts': { 'facade-bypass': { n: 2, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab.gateway.auth-reason.spec.ts': { 'facade-bypass': { n: 2, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab.gateway.persist-status.spec.ts': { 'facade-bypass': { n: 27, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab.gateway.project-gone.spec.ts': { 'facade-bypass': { n: 15, until: 'T39b-2' } },
  'apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts': { 'facade-bypass': { n: 14, until: 'T39b-2' } },
  // collab.gateway.spec.ts 登记已移除——T39b B0 波 1 试点替换全文件 façade 化（135→0，stale 机制强制核销）
  'apps/api/src/modules/collab/collab.gateway.sweep.spec.ts': { 'facade-bypass': { n: 26, until: 'T39b-2' } },
  'apps/api/src/modules/collab/telemetry.controller.spec.ts': { 'facade-bypass': { n: 1, until: 'T39b-2' } },
  'apps/api/src/modules/collab/write-frozen-chain.int.spec.ts': { 'facade-bypass': { n: 1, until: 'T39b-2' } },
};

function collectSpecFiles() {
  const dir = path.join(ROOT, SPEC_DIR_REL);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((f) => path.join(dir, f));
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  const gatewayPath = path.join(ROOT, GATEWAY_REL);
  if (!fs.existsSync(gatewayPath)) { console.error('check-collab-test-facade: 结构性错误（exit 2）——collab.gateway.ts 缺失'); process.exit(2); }
  const gatewayStripped = stripCommentsAndStrings(fs.readFileSync(gatewayPath, 'utf8'));
  const universe = new Set(parsePrivateMembers(gatewayStripped));
  if (!universe.size) { console.error('check-collab-test-facade: 结构性错误（exit 2）——私有成员 universe 解析为空'); process.exit(2); }
  const specFiles = collectSpecFiles();
  if (!specFiles.length) { console.error('check-collab-test-facade: 结构性错误（exit 2）——spec 面为空'); process.exit(2); }
  // 豁免面自证：façade 本体非 spec 后缀——不在扫描清单（结构性豁免）
  if (specFiles.some((p) => rel(p) === FACADE_REL)) { console.error('check-collab-test-facade: 结构性错误（exit 2）——façade 本体混入 spec 扫描面'); process.exit(2); }

  const report = process.argv.includes('--report');
  const perFile = specFiles.map((p) => {
    const raw = fs.readFileSync(p, 'utf8');
    const stripped = stripCommentsAndStrings(raw);
    return { file: rel(p), raw, stripped, violations: findFacadeViolations({ raw, stripped, universe }) };
  });

  if (report) {
    // ── 步骤 0 枚举输出（--report）──
    // 触达口径=执法口径单源（violations——cast∧私有成员合取）。名字级 `.member` 裸计数已废弃：
    // universe 含 repo/spool/disconnect 等与 kit 公有夹具/库对象同名的成员，名字级口径混入
    // kit.repo/provider.disconnect 噪声（实测 658 vs 执法 534）；执法口径带对象上下文限定=准确面。
    console.log(`# check-collab-test-facade --report（步骤 0 枚举——重跑命令：node scripts/check-collab-test-facade.mjs --report）`);
    console.log(`# universe：collab.gateway.ts 私有成员 ${universe.size} 个（脚本现场解析——gateway 演进自动跟随）`);
    console.log(`# 执法面：${SPEC_DIR_REL}/*.spec.ts ${specFiles.length} 文件；豁免面：${FACADE_REL}（唯一 sanctioned 绕点，非 spec 后缀天然出圈）\n`);

    // 触达统计（M 双口径——执法口径单源）
    const all = perFile.flatMap((f) => f.violations.map((v) => ({ ...v, file: f.file })));
    const byMember = {};                                    // member → [violation]
    for (const v of all) (byMember[v.member] ??= []).push(v);
    const m1 = all.length;
    const m2 = Object.keys(byMember).length;
    console.log(`## 触达统计（M 双口径=执法口径单源）`);
    console.log(`M1（触达处数=违规点数）= ${m1}`);
    console.log(`M2（distinct 触达成员数）= ${m2}`);
    console.log(`触达文件数 = ${perFile.filter((f) => f.violations.length).length}/${specFiles.length}\n`);

    // 三列清单：成员 → 归属 → 访问形态分布（+top 文件）
    console.log(`## 三列清单（成员 → 所属目标 service〔Z24〕 → 访问形态）`);
    console.log(`| 成员 | 归属 | 触达数 | 形态分布 | 触达文件（top3） |`);
    console.log(`|---|---|---|---|---|`);
    const byMemberFile = (vs) => {
      const c = {};
      for (const v of vs) c[v.file] = (c[v.file] ?? 0) + 1;
      return c;
    };
    for (const m of Object.keys(byMember).sort((a, b) => byMember[b].length - byMember[a].length)) {
      const vs = byMember[m];
      const owner = MEMBER_OWNERSHIP[m] ?? 'UNMAPPED（待人工归属）';
      const shapes = {};
      for (const v of vs) {
        const cats = v.kind === 'spyOn' ? ['spyOn直调'] : classifyTouch(v.text, m);
        for (const c of (cats.length ? cats : ['引用'])) shapes[c] = (shapes[c] ?? 0) + 1;
      }
      const topFiles = Object.entries(byMemberFile(vs)).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([f, n]) => `${f.replace('apps/api/src/modules/collab/', '')}:${n}`).join(', ');
      console.log(`| ${m} | ${owner} | ${vs.length} | ${Object.entries(shapes).map(([k, n]) => `${k}${n}`).join('/')} | ${topFiles} |`);
    }

    // 违规基线表（file×count×kind——登记红回填原料）
    console.log(`\n## 违规基线（执法口径=cast∧私有成员合取；file×count×kind）`);
    for (const f of perFile) {
      if (!f.violations.length) continue;
      const kinds = {};
      for (const v of f.violations) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
      console.log(`${f.file}  ×${f.violations.length}  (${Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(' ')})`);
    }
    console.log(`违规总数 = ${m1}（${perFile.filter((f) => f.violations.length).length} 文件）`);
    process.exit(0);
  }

  // ── 默认=门禁模式 ──
  const hits = {};
  for (const f of perFile) {
    if (f.violations.length) hits[f.file] = { 'facade-bypass': f.violations.length };
  }
  const { unregistered, drift, stale } = reconcileRegisteredRed(hits, REGISTERED_RED);
  const nTotal = Object.values(hits).reduce((a, s) => a + s['facade-bypass'], 0);
  const nFiles = Object.keys(hits).length;
  const nReg = Object.keys(REGISTERED_RED).length;
  const pass = unregistered.length === 0 && drift.length === 0 && stale.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ⑲ 测试 façade 门禁（Z140②——cast∧gateway 私有成员合取违规定义；universe ${universe.size} 成员现场解析；执法面 ${specFiles.length} spec 文件；现状违规 ${nTotal} 处/${nFiles} 文件；登记红 ${nReg} 项 until=T39b-2）`);
  for (const h of unregistered) console.log(`      - 未登记违规 ${h.file} ×${h.n}（façade 替换或登记红 until=任务号）`);
  for (const d of drift) console.log(`      - 登记计数漂移 ${d.file}: 登记 ${d.want} 实际 ${d.n}（替换推进须同步降登记）`);
  for (const s of stale) console.log(`      - 登记项已清零——转绿达成请移除登记（until=${s.until}）${s.file}`);
  for (const [f, syms] of Object.entries(REGISTERED_RED)) {
    console.log(`      - 登记红（until=${syms['facade-bypass'].until}）${f} ×${syms['facade-bypass'].n}`);
  }
  if (!pass) { console.error('check-collab-test-facade FAIL'); process.exit(1); }
}
