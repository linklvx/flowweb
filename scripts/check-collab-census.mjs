#!/usr/bin/env node
// Y0b-4 T14（plan TDD 纪律节 census 十组+⑪ readOnly 直写点）：collab 面生产代码普查脚本。
// 形态=check-spec-consistency.mjs 同族（grep 语义 + PASS/FAIL 明细 + exit 1）。词表按 2026-10-11
// HEAD 实际落地形态写就（先 grep 实况再写断言）——白名单④逐点列名，新增编码/桶/直写点必须同批补注。
// 退出码：0=全 PASS；1=任一 FAIL；2=结构性错误。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// ⑬detail 白名单锚单源：schema 从 shared dist 导入（TS 源不可直接 import .ts——verify 链
// shared-build 步在前，dist 恒新；standalone 跑依赖 dist 已构建——与 check-shared-dist 同前提）。
import { TELEMETRY_DETAIL_SCHEMA } from '../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 生产文件面：apps 两端 src 下 ts/tsx，排除测试（.spec./.test.）与 test-utils 装置。 */
export function collectProductionFiles() {
  const bases = [path.join(ROOT, 'apps/api/src'), path.join(ROOT, 'apps/web/src')];
  const out = [];
  for (const base of bases) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return p.includes('test-utils') ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) && !/\.(spec|test)\./.test(e.name) ? [p] : [];
    });
    out.push(...walk(base));
  }
  return out.sort();
}

/** 剥注释与字符串内容（保换位——报错行号可跳转）：行/块注释、'…'/"…"/`…`（含 ${} 嵌套）。
 *  正则字面量不处理（本脚本词表无 `/close(nn/` 形态，误伤面为零）。 */
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  let mode = 'code';                       // code | line | block | single | double | template
  const tplStack = [];                     // template ${} 嵌套深度栈
  let quote = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { out += '  '; i += 2; mode = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i += 2; mode = 'block'; continue; }
      if (c === "'" || c === '"') { out += c; i += 1; mode = c === "'" ? 'single' : 'double'; quote = c; continue; }
      if (c === '`') { out += c; i += 1; mode = 'template'; tplStack.push(0); continue; }
      out += c; i += 1;
    } else if (mode === 'line') {
      if (c === '\n') { out += '\n'; mode = 'code'; } i += 1;
    } else if (mode === 'block') {
      if (c === '*' && n === '/') { out += '  '; i += 2; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    } else if (mode === 'single' || mode === 'double') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) { out += quote; i += 1; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    } else {                                // template（栈帧=0 模板文本/＞0 插值花括号深度）
      const frame = tplStack[tplStack.length - 1];
      if (frame === 0) {                    // 模板文本：内容剥为空格（`${` 入插值、反引号出栈）
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (c === '`') { out += '`'; i += 1; tplStack.pop(); if (!tplStack.length) mode = 'code'; continue; }
        if (c === '$' && n === '{') { out += '  '; i += 2; tplStack[tplStack.length - 1] = 1; continue; }
        out += c === '\n' ? '\n' : ' '; i += 1;
      } else {                              // 插值体：代码按原文透传（嵌套字符串/行注释/模板局部处理）
        if (c === '{') { tplStack[tplStack.length - 1] += 1; out += c; i += 1; continue; }
        if (c === '}') { tplStack[tplStack.length - 1] -= 1; out += c; i += 1; continue; }
        if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; } continue; }
        if (c === "'" || c === '"') {       // 插值内字符串：剥内容保换位
          const q = c; out += q; i += 1;
          while (i < src.length && src[i] !== q) { out += src[i] === '\n' ? '\n' : ' '; if (src[i] === '\\') { out += ' '; i += 1; } i += 1; }
          out += q; i += 1; continue;
        }
        if (c === '`') { out += '`'; i += 1; tplStack.push(0); continue; }   // 嵌套模板新帧
        out += c; i += 1;
      }
    }
  }
  return out;
}

/** ①裸 close 码命中（1008/1011/4404——backoff/终态码禁裸字面量，必须走 CollabCloseCode）。 */
export function classifyCloseLiteral(line) {
  return /close\(\s*(?:1008|1011|4404)\s*[,)]/.test(line) ? 'bare close code' : null;
}

/** ⑨.consume( 全显式 cost 纪律：省参（默认 cost=1）在生产调用面禁止——显式 `, 1)`/`, bytes)` 形态。 */
export function classifyConsumeCall(line) {
  const m = line.match(/\.consume\(([^)]*)\)/);
  if (!m) return null;
  const args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return args.length >= 2 ? null : '省参 cost（生产调用必须显式 `, 1`/按量——禁默认参形态）';
}

/** ⑬recordCollabDiag/recordRingOnlyCollabDiag 调用点静态提取（组⑬ detail 白名单锚输入面）。
 *  raw 源扫描——type 与 detail 值均字符串字面量，stripCommentsAndStrings 会结构性剥掉（组⑦同则）；
 *  行首注释行/定义行（function recordCollabDiag(）排除；import 语句无 `(` 天然不命中。
 *  返回 { channel: 'batch'|'ring-only', type, keys, literals, line, problem }——
 *  keys=对象首层键（花括号深度 1）；简写键按变量名解析（裁定 25⑵）；展开（…）problem 报红禁入；
 *  literals=值表达式内全部字符串字面量（三元两支等静态可比面；动态值归运行时 sanitize 单源）。 */
export function extractDiagCalls(src) {
  const calls = [];
  const re = /\brecord(?:CollabDiag|RingOnlyCollabDiag)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 16), m.index))) continue;
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineEnd = src.indexOf('\n', m.index);
    if (/^\s*(?:\/\/|\*|\/\*)/.test(src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd))) continue;
    const entry = {
      channel: m[0].startsWith('recordRingOnly') ? 'ring-only' : 'batch',
      type: null,
      keys: [],
      literals: {},
      line: src.slice(0, m.index).split('\n').length,
      problem: null,
    };
    let i = m.index + m[0].length;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i += 1; };
    /** 值表达式扫描：跨到首层 `,`/`}`（嵌套 ()[]{ } 计深；字符串字面量整体跳过并可选收集；模板串跳过不收集） */
    const skipValue = (lits) => {
      let d = 0;
      while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
          const end = src.indexOf(c, i + 1);
          if (end === -1) { i = src.length; return; }
          if (lits && c !== '`') lits.push(src.slice(i + 1, end));
          i = end + 1;
          continue;
        }
        if (c === '(' || c === '[' || c === '{') { d += 1; i += 1; continue; }
        if (c === ')' || c === ']') { d -= 1; i += 1; continue; }
        if (c === '}') { if (d === 0) return; d -= 1; i += 1; continue; }
        if (c === ',' && d === 0) return;
        i += 1;
      }
    };
    ws();
    if (src[i] === "'" || src[i] === '"') {
      const end = src.indexOf(src[i], i + 1);
      entry.type = src.slice(i + 1, end);
      i = end + 1;
    } else {
      entry.problem = 'type 非字符串字面量（锚不可静态校验）';
    }
    ws();
    if (src[i] === ',') {
      i += 1;
      ws();
      if (src[i] !== '{') entry.problem = entry.problem ?? 'detail 非对象字面量（须 { … } 形态）';
      else {
        i += 1;
        for (;;) {
          ws();
          if (i >= src.length) { entry.problem = entry.problem ?? 'detail 对象未闭合'; break; }
          if (src[i] === '}') { i += 1; break; }
          if (src.startsWith('...', i)) {
            entry.problem = 'detail 展开禁入（裁定 25⑵——键集不可静态校验）';
            i += 3;
            skipValue();
            continue;
          }
          let key = null;
          if (src[i] === "'" || src[i] === '"') {
            const end = src.indexOf(src[i], i + 1);
            key = src.slice(i + 1, end);
            i = end + 1;
          } else {
            const km = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
            if (km) { key = km[0]; i += km[0].length; }
          }
          if (key === null) { entry.problem = entry.problem ?? 'detail 键不可解析'; skipValue(); continue; }
          entry.keys.push(key);
          ws();
          if (src[i] === ':') {
            i += 1;
            const lits = [];
            skipValue(lits);
            if (lits.length) entry.literals[key] = lits;
          }
          ws();
          if (src[i] === ',') { i += 1; continue; }
          if (src[i] === '}') { i += 1; break; }
          // 既非分隔符——顺推防死循环
          skipValue();
        }
      }
    }
    calls.push(entry);
  }
  return calls;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** ④encodeStateAsUpdate 生产白名单（现行清单——2026-10-11 实况逐点列名+Y0b-5 T6 增补；新增编码点必须同批补注）：
 *  gate-canvas-state ×1=A0-0 门禁画布种子构造（种子编码非测量）；
 *  canvas-doc-update.repository ×2=compact 快照重编码+tombstone delete set 余量测量（Y0b-5 T10——
 *   全 SV 滤零 structs 段的近似编码，compact ≥60s 时间门内成本有界）；
 *  collab-shrink.service ×5=export-fresh 落地校验/shrink 影子预演（apply 进 scratch+预演结果编码）
 *   /shrink 写后校准（recalibrate truth）/vacuum 真空编码（newDoc 落库快照——T9a）；
 *  collab.gateway ×3=装载真值（cheap≥soft 才实测）/vacuum residue 评估（全根真空重建编码）
 *   /over 检查 measureTruth（冷却窗外实测）；
 *  project.service ×1=项目创建种子快照；
 *  web canvasCollabRuntime ×3=客户端漂移 idle 实测自校准/measureLocalDocNow 同步实测（判据④超大兜底）
 *   /buildCacheRecord 本地缓存快照编码（Y0b-5 T8——去抖/到期/隐藏强制三触发共用单点）；
 *  web canvas-local-backup ×1=本地备份双产物导出编码（Y0b-5 T6——.yjs 可回灌产物）。 */
const ENCODE_WHITELIST = {
  'apps/api/src/gate-canvas-state.ts': 1,
  'apps/api/src/modules/collab/canvas-doc-update.repository.ts': 2,
  'apps/api/src/modules/collab/collab-shrink.service.ts': 5,
  'apps/api/src/modules/collab/collab.gateway.ts': 3,
  'apps/api/src/modules/project/project.service.ts': 1,
  'apps/web/src/stores/canvasCollabRuntime.ts': 3,
  'apps/web/src/collab/canvas-local-backup.ts': 1,
};

const results = [];
function report(id, title, pass, details) {
  results.push({ id, title, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${title}`);
  for (const d of details) console.log(`      - ${d}`);
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  const files = collectProductionFiles();
  if (!files.length) { console.error('check-collab-census: 结构性错误（exit 2）——生产文件面为空'); process.exit(2); }
  const byFile = new Map(files.map((p) => {
    const src = fs.readFileSync(p, 'utf8');
    return [p, { raw: src, stripped: stripCommentsAndStrings(src) }];
  }));
  const relOf = (p) => rel(p);
  const scanLines = (p, use, fn) => {
    const hits = [];
    (use === 'stripped' ? byFile.get(p).stripped : byFile.get(p).raw).split('\n').forEach((l, idx) => {
      const r = fn(l, p);
      if (r) hits.push({ file: relOf(p), line: idx + 1, text: l.trim(), why: r });
    });
    return hits;
  };

  // ①close(1008|1011|4404) 裸字面量清零（生产——注释/字符串/help 文本不拦）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) => classifyCloseLiteral(l)));
    report('①', 'close(1008|1011|4404) 裸字面量清零（须走 CollabCloseCode+hardClose）', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}`));
  }
  // ②Connection.close( 应用侧清零（P7：库 Connection.close 丢 code——须 webSocket.close 先行）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) =>
      /(?:connection|conn|directConn\w*)\.close\(/.test(l) ? 'Connection.close( 应用侧调用（P7：webSocket.close 先行）' : null));
    report('②', 'Connection.close( 应用侧清零（库内部调用不在此面）', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}`));
  }
  // ③frame[0]/update[0] 字节猜型清零（判型=readFrameType 库解析单源）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) =>
      /(?:frame|update)\[0\]/.test(l) ? '字节猜型（禁 frame[0]/update[0]——readFrameType 单源）' : null));
    report('③', 'frame[0]|update[0] 字节猜型清零', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}`));
  }
  // ④encodeStateAsUpdate 生产白名单外清零（白名单逐点列名见 ENCODE_WHITELIST 注释）
  {
    const details = [];
    const counts = new Map();
    for (const p of files) {
      const n = (byFile.get(p).stripped.match(/encodeStateAsUpdate/g) ?? []).length;
      if (n) counts.set(relOf(p), n);
    }
    for (const [f, n] of counts) {
      const want = ENCODE_WHITELIST[f];
      if (want === undefined) details.push(`白名单外命中 ${f} ×${n}`);
      else if (want !== n) details.push(`白名单计数漂移 ${f}: 期望 ${want} 实际 ${n}`);
    }
    for (const f of Object.keys(ENCODE_WHITELIST)) if (!counts.has(f)) details.push(`白名单点消失 ${f}（清单需同步）`);
    report('④', `encodeStateAsUpdate 生产白名单外清零（现行 ${Object.values(ENCODE_WHITELIST).reduce((a, b) => a + b, 0)} 点/7 文件）`, details.length === 0, details);
  }
  // ⑤.bufferedAmount 仅 collab.gateway.ts 背压段（生产读点唯一——spec 装置除外）
  {
    const filesHit = files.filter((p) => byFile.get(p).stripped.includes('bufferedAmount')).map(relOf);
    report('⑤', '.bufferedAmount 生产读点唯一=collab.gateway.ts（wrapBackpressure）', filesHit.length === 1 && filesHit[0] === 'apps/api/src/modules/collab/collab.gateway.ts',
      filesHit.map((f) => `命中文件 ${f}`));
  }
  // ⑥new TokenBucket gateway 内恰四处定义点（upgrade/msg/bytes/aware——参数不同不可共实例）
  {
    const gw = files.find((p) => relOf(p) === 'apps/api/src/modules/collab/collab.gateway.ts');
    const lines = scanLines(gw, 'stripped', (l) => /new TokenBucket/.test(l) ? 'def' : null);
    const fields = lines.map((h) => (h.text.match(/this\.(\w+)\s*=\s*new TokenBucket/) ?? [])[1]).filter(Boolean);
    const want = ['upgradeBucket', 'msgBuckets', 'bytesBuckets', 'awareBuckets'];
    const stray = files.filter((p) => p !== gw && byFile.get(p).stripped.includes('new TokenBucket')).map(relOf);
    const pass = fields.length === 4 && want.every((w) => fields.includes(w)) && stray.length === 0;
    report('⑥', 'new TokenBucket 恰四处定义点（upgrade/msg/bytes/aware）且无库外实例', pass,
      [...(fields.length !== 4 || !want.every((w) => fields.includes(w)) ? [`实得字段集 [${fields.join(', ')}]（期望 [${want.join(', ')}]）`] : []), ...stray.map((f) => `gateway 外命中 ${f}`)]);
  }
  // ⑦web setSelection(/setAwarenessField('selection' 仅 awareness.ts 去抖单点（CanvasView 经桥调用）。
  //  raw 行扫描+注释行过滤：词表本身是字符串字面量实参——字符串内容剥离后会结构性消失（⑦特例）。
  {
    const aware = 'apps/web/src/collab/awareness.ts';
    const view = 'apps/web/src/pages/canvas/components/CanvasView.tsx';
    const isCommentLine = (l) => /^\s*(?:\/\/|\*|\/\*)/.test(l);
    const fieldHits = files.filter((p) => byFile.get(p).raw.split('\n').some((l) => !isCommentLine(l) && /setAwarenessField\(\s*['"]selection['"]/.test(l))).map(relOf);
    const selHits = files.filter((p) => byFile.get(p).raw.split('\n').some((l) => !isCommentLine(l) && /setSelection\(/.test(l))).map(relOf);
    const pass = fieldHits.length === 1 && fieldHits[0] === aware && selHits.every((f) => f === aware || f === view);
    report('⑦', "setAwarenessField('selection') 仅 awareness.ts；setSelection( 仅 awareness.ts+CanvasView.tsx（经桥去抖）", pass,
      [...(fieldHits.filter((f) => f !== aware).map((f) => `selection 直写越面 ${f}`)), ...(selHits.filter((f) => f !== aware && f !== view).map((f) => `setSelection 越面 ${f}`))]);
  }
  // ⑧write-frozen 服务端清零（Y0b-4 T5 起并入 doc-status〔writeFrozen 维度〕——spec 史档注释除外=剥离面）
  {
    const hits = files.filter((p) => relOf(p).startsWith('apps/api/') && byFile.get(p).stripped.includes('write-frozen')).map(relOf);
    report('⑧', "'write-frozen' 服务端生产清零（已并入 doc-status writeFrozen 维度）", hits.length === 0, hits.map((f) => `命中 ${f}`));
  }
  // ⑨.consume( 生产调用全显式 cost（msg/aware=1、bytes=帧字节、upgrade=1——禁默认参形态）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) => classifyConsumeCall(l)));
    report('⑨', '.consume( 生产调用全显式 cost 参数', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}——${h.why}`));
  }
  // ⑩pendingStructs 装载断言存在性（Q-O 双查——存在性检查非清零）
  {
    const gw = byFile.get(files.find((p) => relOf(p) === 'apps/api/src/modules/collab/collab.gateway.ts')).stripped;
    const hasStructs = /pendingStructs\s*!==\s*null/.test(gw);
    const hasDs = /pendingDs\s*!==\s*null/.test(gw);
    report('⑩', 'pendingStructs&&pendingDs 装载双查断言存在（loadDocument 降级可观测——Q-O）', hasStructs && hasDs,
      [...(hasStructs ? [] : ['缺 pendingStructs !== null 断言']), ...(hasDs ? [] : ['缺 pendingDs !== null 断言'])]);
  }
  // ⑪readOnly 生产直写点清单（Q-A 单源：applyWriteFreeze 唯一出口+auth connectionConfig 两点；
  // Y0b-5 T16：viewer 改 auth 期意图+connected 登记=直写 3→2）
  {
    const gwPath = files.find((p) => relOf(p) === 'apps/api/src/modules/collab/collab.gateway.ts');
    const gwLines = byFile.get(gwPath).stripped.split('\n');
    const configWrites = [];
    const connWrites = [];
    const strayWrites = [];
    gwLines.forEach((l, idx) => {
      for (const m of l.matchAll(/([A-Za-z_$][\w$]*)\.readOnly\s*=/g)) {
        const lhs = m[1];
        if (lhs === 'connectionConfig') configWrites.push(idx + 1);
        else if (lhs === 'conn') connWrites.push(idx + 1);
        else strayWrites.push(`${idx + 1}: ${l.trim()}`);
      }
    });
    const methodStart = gwLines.findIndex((l) => l.includes('private') && l.includes('applyWriteFreeze('));
    const applyEnd = methodStart < 0 ? -1 : gwLines.slice(methodStart + 1).findIndex((l) => /^  (?:private|public|protected|readonly|async) /.test(l)) + methodStart + 1;
    const inApply = connWrites.length === 1 && methodStart >= 0 && connWrites[0] > methodStart && connWrites[0] < (applyEnd < 0 ? Infinity : applyEnd);
    const literalBans = files.filter((p) => /readOnly:\s*true/.test(byFile.get(p).stripped) && relOf(p).startsWith('apps/api/')).map(relOf);   // doc-status 快照 readOnly 字段防回潮（Q-A）
    const pass = configWrites.length === 2 && inApply && strayWrites.length === 0 && literalBans.length === 0;
    report('⑪', 'readOnly 直写=auth connectionConfig×2（spool 降级/quotaFrozen——viewer 走意图+connected 登记）+applyWriteFreeze×1（唯一出口）；readOnly:true 字面量清零', pass,
      [...(configWrites.length !== 2 ? [`connectionConfig.readOnly 直写 ${configWrites.length} 处（期望 2——spool 降级/quotaFrozen）`] : []),
       ...(inApply ? [] : [`conn.readOnly 直写 ${connWrites.length} 处且须恰 1 处位于 applyWriteFreeze 体内`]),
       ...strayWrites.map((s) => `越面直写 gateway:${s}`),
       ...literalBans.map((f) => `readOnly: true 字面量命中 ${f}`)]);
  }

  // ⑫裸 location.reload() 白名单（Y0b-5 T6 safeReload 九处收敛——唯一裸 reload 点=safeReload 内部；
  //  其余 reload 面一律经 safeReload(reason)：unsyncedDirty 真→导出对话框不刷新。新增越权点即红）。
  {
    const RELOAD_WHITELIST = {
      'apps/web/src/stores/canvasCollabRuntime.ts': 1,   // safeReload 内部唯一裸点
    };
    const details = [];
    const counts = new Map();
    for (const p of files) {
      const n = (byFile.get(p).stripped.match(/location\.reload\(\)/g) ?? []).length;
      if (n) counts.set(relOf(p), n);
    }
    for (const [f, n] of counts) {
      const want = RELOAD_WHITELIST[f];
      if (want === undefined) details.push(`白名单外裸 location.reload() ${f} ×${n}——改道 safeReload(reason)`);
      else if (want !== n) details.push(`reload 白名单计数漂移 ${f}: 期望 ${want} 实际 ${n}`);
    }
    for (const f of Object.keys(RELOAD_WHITELIST)) if (!counts.has(f)) details.push(`reload 白名单点消失 ${f}（清单需同步）`);
    report('⑫', `裸 location.reload() 白名单=safeReload 内部唯一点（现行 ${Object.values(RELOAD_WHITELIST).reduce((a, b) => a + b, 0)} 点——9 处收敛锚）`, details.length === 0, details);
  }

  // ⑬detail 白名单锚（Y0b-5 T18 ㉒）：生产面每个 recordCollabDiag(type,detail) 调用点
  //  键集⊆TELEMETRY_DETAIL_SCHEMA[type] 允许键集 ∧ 枚举键字面量值⊆受控值域（动态值归运行时
  //  sanitize 单源——静态只判字面量）；type∈12 值封闭集两通道同判；ring-only 通道结构性永不
  //  触达服务端 sanitize 面——键域不受 schema 约束（容量预警等本地诊断自由键），仅判 type。
  //  表=shared dist 单源导入；无清单白名单——新增调用点自动生效。
  {
    const schema = TELEMETRY_DETAIL_SCHEMA;
    const details = [];
    let nBatch = 0;
    let nRing = 0;
    for (const p of files) {
      for (const c of extractDiagCalls(byFile.get(p).raw)) {
        if (c.channel === 'batch') nBatch += 1; else nRing += 1;
        const at = `${relOf(p)}:${c.line}`;
        if (c.problem) { details.push(`${at} ${c.problem}`); continue; }
        if (!(c.type in schema)) { details.push(`${at} type '${c.type}' ∉ 12 值封闭集`); continue; }
        if (c.channel !== 'batch') continue;
        const allowed = schema[c.type];
        for (const k of c.keys) if (!(k in allowed)) details.push(`${at} detail 键 '${k}' ∉ ${c.type} 允许键集`);
        for (const [k, lits] of Object.entries(c.literals)) {
          const spec = allowed[k];
          if (spec?.values) for (const v of lits) if (!spec.values.includes(v)) details.push(`${at} ${c.type}.${k} 字面量 '${v}' ∉ 受控值域`);
        }
      }
    }
    report('⑬', `detail 白名单锚：recordCollabDiag 键集⊆schema∧字面量值域⊆枚举（现行 ${nBatch} 批量点+${nRing} ring-only 点——新增调用点自动生效）`, details.length === 0, details);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\ncheck-collab-census: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.error(`check-collab-census FAIL: ${failed.map((f) => f.id).join(' ')}`); process.exit(1); }
}
