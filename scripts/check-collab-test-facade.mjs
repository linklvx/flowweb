#!/usr/bin/env node
// Y0c T39b B0（plan T39b 行 v4=Z140 全面改写；控制方裁决 RB0 门禁+枚举一体）：
// collab 测试面「只能经 façade 访问 gateway 内部状态」门禁 + 步骤 0 枚举报告双模式脚本。
//
// ── 违规定义（计数口径写死——Z140②「全形态」非单一拼写正则；Z43「符号级非语法级」同教训）──
// 违规 = 绕过类型系统访问 gateway 内部状态 = cast 形态 ∧ gateway 私有成员触达（合取语义）：
//   cast 形态 ∈ { `as any`, `as unknown as`, `@ts-expect-error`, `@ts-ignore`（M-1 波 1 评审：
//   同族绕过形态入集——Z140② 原文只列 ts-expect-error=spec 级缺口，正向加强；eslint 无
//   ban-ts-comment 兜底） }；
//   私有成员 universe = 本脚本从 UNIVERSE_FILES_REL 三文件现场解析合并（private 字段+私有方法
//   +static 常量+构造器参数属性+get/set 访问器名〔修饰词跳过——M-2〕——解析逻辑写死，源文件演进
//   自动跟随，无人工名单漂移面）。T41 W4 扩面（偏离 71/RC6-a）：B2 切出后 gateway 单文件
//   universe 150→31 缩至空心，扩为 gateway+SG+DR 三文件——执法加强非放松：违规定义/计数口径/
//   façade 豁免面（三单点）不变，SG/DR 私有成员触达同规则回收。
// 检测规则（每触达点计 1；kind 标注来源规则）：
//   R1 cast：stripped 源 `as any`/`as unknown as` token occurrence，**受体限定（I-1 波 1 评审，
//      词面=实测裁决扩面）**=cast 链受体须含 gateway 对象词面（`/gateway|\bgw/i`——覆盖
//      gateway/kit.gateway/CollabGateway 类名静态/buildGateway 工厂/gw2 变体）∨ 含 gateway
//      别名/型化局部名（词边界）；评审原案窄词面 `\bgw\b|\bgateway\b` 丢 6 真阳性实锤（类名
//      静态 ×2/gw2 ×2/别名受体 ×2）。universe 含 logger/repo/transition/quota 等通用名，
//      对象无关检测=非 gateway 对象同名单词假阳性（reaper/ready/telemetry 8 处实锤）。
//      其后成员链（跨行、`?.`、`['member']` 计算访问〔I-3①——字符串名 raw 同偏移读取〕、
//      平衡 {}[]<>、类型名标识符跳过 ≤1 次）任一成员 ∈ universe ⇒ 违规。类型名跳过限 1 次=
//      防 ASI 无分号跨语句漂移（本仓风格恒分号结尾；已知近似边界，自测钉行为）。
//   R2 别名：`const g = <RHS 头部 gateway 词面> as any` / `const gw: any = <RHS 头部 gateway 词面>` /
//      `g = <RHS 头部 gateway 词面> as any`（赋值语句——I-3③ 先声明后赋值形态）定义的文件级别名集。
//      RHS 资格=表达式**头部**标识符链含 gateway 词面（RECEIVER_GATEWAY_RE=`/gateway|\bgw/i`
//      同源——camelCase 工厂 makeGateway/buildGateway/gw2 亦入集；深层词面不算=构造参数里的
//      gatewayMock 不构成资格，重基线实测裁决）∧（cast token ∨ `: any` 注解）——免 cast 纳入
//      会把公有方法 DTO/façade 转发对象同名字段裸读误计（degraded ×7/试点 ×9 实锤⇒cast 要求
//      保留）。文件级近似=不做作用域分析——同名遮蔽场景由基线登记红人工复核吸收；二级别名
//      `const h = g` 不传播，现状零出现。后续 `alias.member`（member ∈ universe）逐处违规。
//      RHS 无 gateway 词面的 any 别名（mock/spool/payload）不入集=非 gateway 对象的 as any
//      不违规（Z140② 合取语义）。
//      型化局部第二集（免 cast、仅 R1 受体判定消费）：`const g2 = makeBareGateway()` 型化
//      gateway 变量 + 使用点 `(g2 as any).member` 形态经受体判定回收（旧 gateway.spec :1691
//      逃逸实锤）；DTO/façade 裸读无 cast 不进 R1⇒假阳性结构性排除。
//      R2b 解构（I-3②）：`const { member } = <RHS 含 gateway 词 + cast>`——解构属性键 ∈ universe
//      逐处计（kind=alias）。
//      已知边界（I-3④）：函数参数别名 `function f(g: any) { g.pendingQueues }` + 调用点传入
//      gateway=已知逃逸面——行级符号检测不可行（需数据流分析），由波 2 全量替换纪律+评审承担，
//      自测钉逃逸实证。
//   R3 spyOn 字符串成员：`vi.spyOn(<cast 形态|别名|gateway 词>, '<member>')`——member 是字符串
//      字面量（stripped 剥串结构性消失⇒raw 行消费，census 组⑦同则）。arg1 含逗号形态不支持
//      （现状零出现）。
//   R4 ts 指令（@ts-expect-error/@ts-ignore）：指令注释行（raw 检测）的下一行 stripped 触达
//      universe 成员 ⇒ 违规（kind=ts-directive）；下一行已被 R1/R2/R3 命中则不重复计（同一
//      触达点去重——口径写死）。
// 非违规面（合取语义的另一半）：payload cast（`} as any)`）、mock 链（`(repo.append as any).mock`）、
//   非 gateway 受体对象成员（`(kit.spool as any).ioBroken`/`(fx.residency as any).logger`——受体
//   限定 I-1；spool/residency 私有成员不在本门禁 universe，B 波后续任务面）、gateway 公有成员
//   cast（`(gateway as any).server`——冗余但非内部状态）。
//
// ── 范围（自定义写死）──
// 执法面 = apps/api/src/modules/collab/*.spec.ts（顶层 75 文件，*.int.spec.ts 被 *.spec.ts 后缀
// 覆盖）。collectSpecFiles 非递归（M-6 结构边界披露）：collab 子目录 spec 现无（test-utils/ 仅
// façade+stub 非 spec 后缀）；子目录 spec 出现时执法面需同步扩——与偏离 62① 口径一致。
// 理由：B 波=gateway 领域 service 化，façade 门禁执法面=collab 域 spec；collab 域外
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

// ── universe 源文件清单（T41 W4 扩面——偏离 71/RC6-a，写死三文件；B2 切出的两 service 私有
//    成员与 gateway 同规则入 universe。B3 收敛/新 service 切出时本清单同步扩=执法面只增不减） ──
export const UNIVERSE_FILES_REL = [
  GATEWAY_REL,
  'apps/api/src/modules/collab/collab-session-guard.service.ts',
  'apps/api/src/modules/collab/collab-doc-registry.service.ts',
];

/** 多文件 universe 合并（入参=raw 源文本数组——剥离器逐文件前置消费，单文件解析规则同源）。
 *  跨文件重名成员 Set 自然去重；返回 Set（findFacadeViolations 消费面不变）。 */
export function buildUniverseFromFiles(srcTexts) {
  const universe = new Set();
  for (const t of srcTexts) {
    for (const n of parsePrivateMembers(stripCommentsAndStrings(t))) universe.add(n);
  }
  return universe;
}

// ── universe 解析（写死——gateway 演进自动跟随） ──

/** private 成员名解析：字段/方法/static/构造器参数属性，修饰符组合宽松序。
 *  输入=stripped 源（注释/字符串里的 private 字样结构性消失——自测钉）。
 *  M-2（波 1 评审）：get/set 入修饰词跳过组——`private get x()` 若把 `get` 捕入 universe，
 *  所有 `.get(` cast 链将误报（`get` 入集=Map/Set 读面全命中）。 */
export function parsePrivateMembers(strippedSrc) {
  const names = new Set();
  const re = /\bprivate\s+(?:(?:static|readonly|abstract|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)/g;
  for (const m of strippedSrc.matchAll(re)) names.add(m[1]);
  return [...names].sort();
}

/** RHS 资格判定（波 1 评审重基线实测裁决）：RHS 表达式**头部**标识符链（可带 `new`）含
 *  gateway 词面。深层词面不算——`controller = new CollabReadyController(…gatewayMock as any…)`
 *  构造参数词面曾把 controller 误入别名集（ready.controller :187 假阳性复活实锤⇒头部限定根修）。
 *  头部词面覆盖：gateway/kit.gateway/this.gateway/CollabGateway/buildGateway()/makeBareGateway()。 */
function rhsHeadIsGateway(rhs) {
  const h = /^\s*(?:new\s+)?([A-Za-z_$][\w$.]*)/.exec(rhs);
  return h !== null && RECEIVER_GATEWAY_RE.test(h[1]);
}

/** 别名/型化局部定义扫描（声明 + I-3③ 赋值语句两形态；`==`/`=>` 排除，形态不重叠）。 */
function scanAliasDefs(strippedSrc) {
  const defs = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*any\s*)?=\s*([^;\n]*)/g;
  for (const m of strippedSrc.matchAll(re)) defs.push({ name: m[1], rhs: m[2], declText: m[0] });
  const assignRe = /(?:^|(?<=[;\n{]))\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*([^;\n]*)/gm;
  for (const m of strippedSrc.matchAll(assignRe)) defs.push({ name: m[1], rhs: m[2], declText: m[0] });
  return defs;
}

/** gateway 别名的 any 别名定义收集（R2 成员扫描/R3 消费）：RHS 头部 gateway 词面 ∧
 *  （RHS 含 cast token ∨ `: any` 注解）。cast 要求保留（重基线实测裁决）：免 cast 纳入把
 *  `gateway.computeDegraded()` DTO 同名字段裸读（degraded ×7）与 `gatewayFacade(gw)` 直调转发
 *  同名方法（试点 ×9）误计=公有访问非绕过（自测钉两实锤）。头部词面扩 camelCase 工厂
 *  （makeGateway/buildGateway/gw2 as any——窄词面 `\bgateway\b` 漏 shrink :471/
 *  read-canvas-routing :49 12 处真绕过逃逸实锤回收）。 */
export function collectGatewayAliases(strippedSrc) {
  const aliases = new Set();
  for (const d of scanAliasDefs(strippedSrc)) {
    if (!rhsHeadIsGateway(d.rhs)) continue;
    if (/\bas\s+(?:any|unknown\s+as)\b/.test(d.rhs) || /:\s*any\s*=/.test(d.declText)) aliases.add(d.name);
  }
  return aliases;
}

/** 型化 gateway 局部收集（头部词面、免 cast）——仅 R1 受体判定第二支消费（I-1 扩面）：
 *  `const g2 = makeBareGateway()` + 使用点 `(g2 as any).selfIsolate`（旧 gateway.spec :1688/:1691
 *  逃逸实锤）经受体判定回收；DTO/façade 裸读无 cast 不进 R1⇒假阳性结构性排除。 */
export function collectGatewayTypedLocals(strippedSrc) {
  const locals = new Set();
  for (const d of scanAliasDefs(strippedSrc)) {
    if (rhsHeadIsGateway(d.rhs)) locals.add(d.name);
  }
  return locals;
}

// ── R1 cast 成员链扫描 ──

const CAST_TOKEN_RE = /\bas\s+any\b|\bas\s+unknown\s+as\b/g;

/** I-1（波 1 评审）受体提取：从 cast token 起始位向后回溯 cast 链受体表达式——收集标识符/`.`，
 *  平衡跳过 `()`，其余字符（`=` `,` `(` 开括号 `:` 等）停。受体文本供 gateway 对象词判定。
 *  universe 含 logger/repo/transition/quota 等通用名，对象无关的 cast 链检测把非 gateway 对象
 *  同名单词误报（reaper/ready/telemetry 8 处假阳性实锤）⇒ 受体限定为违规合取的第二要素。
 *  词面（实测裁决扩面——评审原案 `\bgw\b|\bgateway\b` 窄词面丢 6 真阳性实锤：auth-defense
 *  `(CollabGateway as any).AUTH_DB_DEADLINE_MS` ×2 类名静态 + shrink `(gw2 as any).docTruth` ×2
 *  工厂变体 + `(g as any).freezeQuota` ×2 别名受体）：`/gateway|\bgw/i` 子串/前缀词面（覆盖
 *  gateway/kit.gateway/CollabGateway/buildGateway/gw2）∨ 受体含 R2 已收 gateway 别名（词边界）。 */
export function extractCastReceiver(src, castIndex) {
  let i = castIndex - 1;
  let depth = 0;
  let out = '';
  while (i >= 0) {
    const c = src[i];
    if (/\s/.test(c)) { i -= 1; continue; }
    if (/[\w$]/.test(c) || c === '.') { out = c + out; i -= 1; continue; }
    if (c === ')') { depth += 1; i -= 1; continue; }
    if (c === '(' && depth > 0) { depth -= 1; i -= 1; continue; }
    break;
  }
  return out;
}

const RECEIVER_GATEWAY_RE = /gateway|\bgw/i;

/** 从 cast token 结束位向前扫成员链：跳过空白（含换行）/`)`/`?`/平衡 {}[]<>；标识符跳过
 *  ≤1 次（as unknown as 的类型名）；`.` 后 ident 收集；I-3①（波 1 评审）`['member']` 计算
 *  访问收集（字符串内容 stripped 结构性剥空⇒raw 同偏移读取——剥离器长度保持契约）；
 *  其他字符停。返回成员名数组。 */
export function scanMemberChainAfter(src, fromIndex, raw = src) {
  const chain = [];
  let i = fromIndex;
  let identSkips = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === ')' || c === '?') { i += 1; continue; }
    if (c === '[') {
      const q = /^\[\s*(['"])/.exec(src.slice(i));          // I-3① 计算访问 ['member']
      if (q) {
        const close = src.indexOf(q[1], i + q[0].length);
        if (close !== -1) {
          const name = raw.slice(i + q[0].length, close).trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) chain.push(name);
          const rb = src.indexOf(']', close);
          if (rb !== -1) { i = rb + 1; continue; }
        }
        return chain;
      }
    }
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
      if (m) { chain.push(m[1]); i += m[0].length; continue; }
      const mb = /^\.\s*\[/.exec(src.slice(i));             // `?.['member']` 形态——点后进括号分支
      if (mb) { i += mb[0].length - 1; continue; }
      return chain;
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

/** 返回 [{ line, kind: 'cast'|'alias'|'spyOn'|'ts-directive', member, text }]（line 升序）。 */
export function findFacadeViolations({ raw, stripped, universe }) {
  const out = [];
  const lineOf = (idx) => stripped.slice(0, idx).split('\n').length;
  const rawLines = raw.split('\n');
  const stLines = stripped.split('\n');

  // 别名集前置收集（R2/R3 消费）+ 型化局部集（仅 R1 受体判定第二支——免 cast 纳入的假阳性
  // 面被结构性排除：DTO/façade 裸读无 cast 不进 R1）
  const aliases = collectGatewayAliases(stripped);
  const receiverNames = [...new Set([...aliases, ...collectGatewayTypedLocals(stripped)])];
  const receiverNameRes = receiverNames.map((a) => new RegExp(`\\b${a}\\b`));

  // R1 直接 cast（I-1 受体限定：cast 链受体须含 gateway 对象词面 ∨ gateway 别名/型化局部名
  // ——非 gateway 受体的 cast+universe 同名单词不违规）
  for (const m of stripped.matchAll(CAST_TOKEN_RE)) {
    const receiver = extractCastReceiver(stripped, m.index);
    if (!RECEIVER_GATEWAY_RE.test(receiver) && !receiverNameRes.some((re) => re.test(receiver))) continue;
    const chain = scanMemberChainAfter(stripped, m.index + m[0].length, raw);
    const hit = chain.find((id) => universe.has(id));
    if (hit) {
      const ln = lineOf(m.index);
      out.push({ line: ln, kind: 'cast', member: hit, text: (stLines[ln - 1] ?? '').trim() });
    }
  }

  // R2 别名成员触达
  if (aliases.size) {
    const aliasRe = new RegExp(`\\b(${[...aliases].join('|')})\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    stLines.forEach((l, idx) => {
      for (const m of l.matchAll(aliasRe)) {
        if (universe.has(m[2])) out.push({ line: idx + 1, kind: 'alias', member: m[2], text: l.trim() });
      }
    });
  }

  // R2b 解构形态（I-3②）：`const { member } = <RHS 头部 gateway 词面 + cast>`——解构属性键 ∈
  // universe 逐处计数（重命名 `{ member: x }` 取属性键=触达点；后续裸名使用无 `.member` 链
  // 不再另计——同一触达面计 1，口径与别名定义点一致。cast 保留要求=解构型化 gateway 不编译，
  // 现状唯一形态 `= buildGateway() as any`——sweep :172 perm 提取实锤）
  const destructRe = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*([^;\n]*)/g;
  for (const m of stripped.matchAll(destructRe)) {
    const rhs = m[2];
    if (!rhsHeadIsGateway(rhs)) continue;
    if (!/\bas\s+(?:any|unknown\s+as)\b/.test(rhs)) continue;
    const ln = lineOf(m.index);
    for (const part of m[1].split(',')) {
      const km = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(part);
      if (km && universe.has(km[1])) {
        out.push({ line: ln, kind: 'alias', member: km[1], text: (stLines[ln - 1] ?? '').trim() });
      }
    }
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

  // R4 @ts-expect-error/@ts-ignore（M-1 波 1 评审：@ts-ignore 同族入 cast 集——eslint 无
  // ban-ts-comment 兜底；raw 指令注释行检测；下一行 stripped 成员触达——与同行 R1/R2/R3 去重）
  rawLines.forEach((l, idx) => {
    if (!/(?:\/\/|\/\*|^\s*\*).*@ts-(?:expect-error|ignore)/.test(l)) return;
    const nextIdx = idx + 1;
    if (nextIdx >= rawLines.length) return;
    if (out.some((v) => v.line === nextIdx + 1)) return;   // 去重：下一行已被 cast/alias/spyOn 计
    const nextStripped = stLines[nextIdx] ?? '';
    for (const m of nextStripped.matchAll(/\.([A-Za-z_$][\w$]*)/g)) {
      if (universe.has(m[1])) {
        out.push({ line: nextIdx + 1, kind: 'ts-directive', member: m[1], text: nextStripped.trim() });
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
  handleProjectsGone: 'DocRegistry', drainDetachedProject: 'Persistence', heapPressureSample: 'DocRegistry',   // T40 B1 归属修正：drainDetachedProject=纯 spool 帧三段式（B0 误标 DocRegistry）
  heapUsedNow: 'DocRegistry', overloadTripped: 'DocRegistry', syncOverloadGauge: 'DocRegistry',
  startHeapObserver: 'DocRegistry', quota: 'DocRegistry', pgBreaker: 'DocRegistry',
  isEmptyState: 'DocRegistry', raceDeadline: 'Persistence', stripTransientFields: 'DocRegistry',   // T40 B1：raceDeadline=export 单源（service 模块——「双持」候选否，gateway 关停步骤 6 import 消费）
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
//    跑出真红 exit 1 后落表；reconcileRegisteredRed 复用 census :267。计数下降 drift 红⇒强制
//    同步降登记、清零 stale 红⇒强制移除登记。key 固定 'facade-bypass'（文件级粒度——控制方 RB0）。
//    until 语义两段（偏离 64——Z140④ 重裁闸裁决 (b) 波 2 范围收窄）：
//    - until='T39b-2'：波 2 机械替换进行中的过渡登记（字段/状态/splice/身份引用族+spy 族触达
//      ——façade 全量替换面，替换推进逐文件核销/降数）；
//    - until='B1-B3'：纯直调族保留 cast（私有方法直调——B1-B3 service 化公有化后 cast 消失
//      触发 stale 核销；为其造 1:1 转发 façade=短命垫片禁项）。
//    历史：波 1 评审勘正轮重基线（I-1 受体限定 8 处假阳性根修 + 词面扩面 12 处真绕过逃逸回收）
//    基线 534→538 处/29 文件、波 1 试点后 403 处/28 文件（全登记 until='T39b-2'）。 ──
const REGISTERED_RED = {
  // collab-auth-defense.spec.ts 登记已移除——T41 W3b 核销：startSessionSweep ×3+heapPressureSample ×2+withAuthDeadline ×2 改 gateway.sessionGuard.<public> 直调=cast 消失（SG 公有化，stale 机制强制核销；AUTH_DB_DEADLINE_MS 静态读已经 authDbDeadlineMs() 改指 CollabSessionGuardService）
  // collab-backpressure.spec.ts 登记已移除——T41 W3b 核销：wrapBackpressure ×1 改 gateway.sessionGuard 直调=cast 消失
  // collab-degraded.spec.ts 登记已移除——T41 W3a 核销：loadDocument ×1 改 gateway.docRegistry.<public> 直调=cast 消失（DR 公有化，stale 机制强制核销；下同）
  // collab-heap-gate.spec.ts 登记已移除——T41 W3a 核销：loadDocument ×2 改 gateway.docRegistry 直调=cast 消失
  // collab-metrics-observability.spec.ts 登记已移除——T41 W3a 核销：loadDocument ×4+logDocTopN ×1 改 gateway.docRegistry 直调=cast 消失（heapUsedNow spy 已经 façade spy 组替换——W3a 随域改道 docRegistryOf；T40 B1 核销沿革见旧注：maybeCompact/storeDocumentUnlocked/unloadDocument 改道）
  // collab-perm-events.spec.ts 登记已移除——T41 W3b 核销：sweepIntervalMs bind 读点 ×1（承接账④改 gw.sessionGuard.sweepIntervalMs.bind）+wirePermChangedEvents ×7+sweepSessions ×3+guardAwareness ×2 改 gateway.sessionGuard 直调=cast 消失（sweepSessions spy 已经 façade spy 组改道 sessionGuardOf）
  // collab-quota-gate.spec.ts 登记已移除——波 2 全量替换清零（25→0；freezeDoc(gw:any) 参数别名内
  // freezeQuota 直调=I-3④ 已知逃逸面——T41 W3a 承接账④兑现：freezeDoc 参数改型 CollabGateway+
  // gw.docRegistry.freezeQuota 公有直调，逃逸面闭合）
  // collab-quota-truth.spec.ts 登记已移除——T41 W3a 核销：loadDocument ×1 改 gateway.docRegistry 直调=cast 消失（T40 B1 核销沿革见旧注）
  // collab-runtime-metrics.spec.ts 登记已移除——T41 W3a 核销：loadDocument ×1 改 gateway.docRegistry 直调=cast 消失（T40 B1 核销沿革见旧注）
  // collab-shrink.spec.ts 登记已移除——T41 W3a 核销：freezeQuota ×3+scheduleFreezePending ×1+loadDocument ×2 改 gateway.docRegistry 直调=cast 消失（gw2 工厂变体同批消灭；repo mock 链经 repoRef 身份引用合法面不变）
  // collab-t20-ripples.spec.ts 登记已移除——T41 W3a 核销：recheckFrozenDocs ×3 改 gateway.docRegistry 直调=cast 消失（measureTruth/updateResidue spy 已经 façade spy 组替换——W3a 随域改道 docRegistryOf）
  // collab-upgrade.spec.ts 登记已移除——T41 W3b 核销：clientIpOf ×3+handleUpgrade ×2 改 gateway.sessionGuard 直调=cast 消失（handleUpgrade payload 侧 as any=夹具部分形状既有合法面，受体 gw.sessionGuard 公有非违规；upgradeBucket/allowedOrigins spy/logger spy 已替换）
  // 直调族——clearDrainTimer ×1（transition 已经 façade transitionState 替换；T40 B1「不搬」裁决：clearDrainTimer=drain 编排域留 gateway 私有——承接账②/设计 §9② until 改 B3，B3 收敛时裁公有化或 façade stub）
  'apps/api/src/modules/collab/collab-write-endpoint.int.spec.ts': { 'facade-bypass': { n: 1, until: 'B3' } },
  // collab.gateway.shutdown.spec.ts 登记已移除——T40 B1 核销：drainAllDocuments ×3 改 gateway.persistence 直调=cast 消失（stale 机制强制核销；storeDocumentSerialized/graceDirectConnections spy 已经 façade spy 组替换）
  // collab.gateway.spec.ts 登记已移除——T39b B0 波 1 试点替换全文件 façade 化（135→0，stale 机制强制核销）
  // collab.gateway.sweep.spec.ts 登记已移除——T41 W3b 核销：startSessionSweep ×10 改 gateway.sessionGuard 直调=cast 消失（closeTeamDocuments ×3 同批改 gw.sessionGuard 公有直调；sweepIntervalMs 赋值/stub 已经 stubSweepInterval 改道 sessionGuard）
  // write-frozen-chain.int.spec.ts 登记已移除——T41 W3a 核销：recheckFrozenDocs ×1 改 kit.gateway.docRegistry 直调=cast 消失
};

/** 非递归（M-6 披露——头注「范围」节口径）：只收顶层 *.spec.ts；collab 子目录 spec 现无、
 *  出现时执法面需扩（偏离 62① 同口径）。 */
function collectSpecFiles() {
  const dir = path.join(ROOT, SPEC_DIR_REL);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((f) => path.join(dir, f));
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  // universe 三文件现场解析（T41 W4 扩面——偏离 71/RC6-a）：任一源文件缺失=结构性错误 exit 2
  const universeSrcs = [];
  for (const r of UNIVERSE_FILES_REL) {
    const p = path.join(ROOT, r);
    if (!fs.existsSync(p)) { console.error(`check-collab-test-facade: 结构性错误（exit 2）——universe 源文件缺失 ${r}`); process.exit(2); }
    universeSrcs.push(fs.readFileSync(p, 'utf8'));
  }
  const universe = buildUniverseFromFiles(universeSrcs);
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
    console.log(`# universe：三文件私有成员合并 ${universe.size} 个（${UNIVERSE_FILES_REL.map((r) => r.split('/').pop()).join('+')} 脚本现场解析——源文件演进自动跟随，T41 W4 扩面/偏离 71）`);
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
  // until 值登记表现场聚合（偏离 64：波 2 推进期 T39b-2/B1-B3 双段并存——写死单值即谎报）
  const untils = [...new Set(Object.values(REGISTERED_RED).map((s) => s['facade-bypass'].until))].join('/') || '空';
  console.log(`${pass ? 'PASS' : 'FAIL'}  ⑲ 测试 façade 门禁（Z140②——cast∧gateway 私有成员合取违规定义；universe ${universe.size} 成员现场解析；执法面 ${specFiles.length} spec 文件；现状违规 ${nTotal} 处/${nFiles} 文件；登记红 ${nReg} 项 until=${untils}）`);
  for (const h of unregistered) console.log(`      - 未登记违规 ${h.file} ×${h.n}（façade 替换或登记红 until=任务号）`);
  for (const d of drift) console.log(`      - 登记计数漂移 ${d.file}: 登记 ${d.want} 实际 ${d.n}（替换推进须同步降登记）`);
  for (const s of stale) console.log(`      - 登记项已清零——转绿达成请移除登记（until=${s.until}）${s.file}`);
  for (const [f, syms] of Object.entries(REGISTERED_RED)) {
    console.log(`      - 登记红（until=${syms['facade-bypass'].until}）${f} ×${syms['facade-bypass'].n}`);
  }
  if (!pass) { console.error('check-collab-test-facade FAIL'); process.exit(1); }
}
