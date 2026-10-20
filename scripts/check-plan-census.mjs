#!/usr/bin/env node
// Y1a T3（plan v11.2 片 S0）：plan 契约 census 脚本——键集单源四处一致+DocNodeRecord 零残留+
// execSeq 裸比较禁令+compareExecSeq 定义唯一。形态=check-collab-census.mjs 同族（grep 语义+
// PASS/FAIL 明细+exit 1；纯 helper export 供 node:test 自测，生产文件面/剥离器复用同族模块）。
// 断言组按卡扩展（架构预留——头注释登记后续卡接入面）：
//   - T7/T10：media.create grep census（唯一编排器点）+NodeArtifact 写点枚举
//   - T11/T17：strip/guard 键集消费面（凡 import 键集处必用单源常量的 lexical 面）
// 退出码：0=全 PASS；1=任一 FAIL；2=结构性错误。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectProductionFiles, stripCommentsAndStrings } from './check-collab-census.mjs';
// 键集契约值单源锚：从 shared dist 导入（TS 源不可直接 import .ts——verify 链 shared-build 步在前，
// dist 恒新；standalone 跑依赖 dist 已构建——check-collab-census ⑬ 同前提）。
import { SERVER_WRITABLE_DATA_KEYS, CLIENT_FORBIDDEN_ON_UPDATE } from '../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** ②局部字面量键集重声明检测：raw 行含 ['fileId','result']（正/反序，引号单双皆认）＝绕开
 *  SERVER_WRITABLE_DATA_KEYS/CLIENT_FORBIDDEN_ON_UPDATE 单源的局部重抄。词表本身是字符串字面量
 *  ——stripCommentsAndStrings 会结构性剥掉，故 raw 面扫描+注释行过滤（check-collab-census 组⑦特例同则）。 */
export function findKeySetLiteralRedeclaration(rawLines) {
  const isComment = (l) => /^\s*(?:\/\/|\*|\/\*)/.test(l);
  const RE = /\[\s*['"]fileId['"]\s*,\s*['"]result['"]\s*\]|\[\s*['"]result['"]\s*,\s*['"]fileId['"]\s*\]/;
  return rawLines.flatMap((l, i) => (!isComment(l) && RE.test(l)) ? [i + 1] : []);
}

/** ④execSeq 裸比较检测：`execSeq <`/`>`（含 <=/>=）＝string 字典序/跨型裸比——代际判定必走
 *  compareExecSeq（数值比较+BigInt 精度）。`=>` 箭头天然不命中（= 先于 > 且 \s* 后直接比较符
 *  才匹配）；===/!== 相等比较不在此面（等值无字典序陷阱）。stripped 面。 */
export function findBareExecSeqComparison(strippedLines) {
  const RE = /\bexecSeq\s*(?:<=|>=|<|>)/;
  return strippedLines.flatMap((l, i) => (RE.test(l) ? [i + 1] : []));
}

/** ③DocNodeRecord 残留检测：T1 已改名 StoredNodeRecord——旧词面回潮即红（防漂移，\b 边界不误伤
 *  StoredNodeRecord）。stripped 面（注释提及不拦）。 */
export function findDocNodeRecordResidue(stripped) {
  const hits = [];
  const RE = /\bDocNodeRecord\b/g;
  let m;
  while ((m = RE.exec(stripped))) {
    hits.push(stripped.slice(0, m.index).split('\n').length);
  }
  return hits;
}

/** ⑤compareExecSeq 定义点提取：`function compareExecSeq`/`compareExecSeq =` 定义形态（调用/
 *  import 形态不命中）。stripped 面。 */
export function compareExecSeqDefinitionSites(strippedLines) {
  const RE = /function\s+compareExecSeq\b|compareExecSeq\s*=/;
  return strippedLines.flatMap((l, i) => (RE.test(l) ? [i + 1] : []));
}

/** ⑥/flowai 改写正则散抄检测（T6③）：正则字面量中 `\/flowai`（如 /^https?:\/\/[^/]+\/flowai/）
 *  ＝绕开 toFlowaiUrl 单点的局部重实现。stripped 面（字符串字面量内容被剥——'/flowai' 纯字符串
 *  不在此面；注释剥除；正则字面量按 check-collab-census 惯例保留原文）。 */
export function findFlowaiRewriteRedeclaration(strippedLines) {
  const RE = /\\\/flowai/;
  return strippedLines.flatMap((l, i) => (RE.test(l) ? [i + 1] : []));
}

/** ⑦跨端 TTL 常量提取（T6③ 双端 mediaContentUrl 单源锁）：web mediaApi.MEDIA_URL_CACHE_TTL_SEC
 *  与 api media-batch.MEDIA_CONTENT_URL_TTL_SEC 跨端无法共享类型——数值提取由 census 比对防漂移。 */
export function extractTtlConstValue(raw, constName) {
  const m = raw.match(new RegExp(`${constName}\\s*=\\s*([0-9][0-9_]*)`));
  return m ? Number(m[1].replace(/_/g, '')) : null;
}

const results = [];
function report(id, title, pass, details) {
  results.push({ id, title, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${title}`);
  for (const d of details) console.log(`      - ${d}`);
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  const files = collectProductionFiles();
  // ⑤ 专用扩面：单源定义点在 packages/shared（collectProductionFiles 只扫 apps 两端）——
  // ⑤ 断言面=apps 生产面+shared src 生产面（排除 .test.）合并。
  const sharedSrc = path.join(ROOT, 'packages', 'shared', 'src');
  const sharedFiles = (() => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.ts$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
    return walk(sharedSrc);
  })();
  if (!files.length) { console.error('check-plan-census: 结构性错误（exit 2）——生产文件面为空'); process.exit(2); }
  const byFile = [...files, ...sharedFiles].map((p) => {
    const src = fs.readFileSync(p, 'utf8');
    return { p, rel: rel(p), raw: src, stripped: stripCommentsAndStrings(src) };
  });

  // ①键集单源契约值（v11 架构定案：两常量同引用同集 {fileId,result}——值漂移即红）
  {
    const details = [];
    if (JSON.stringify([...SERVER_WRITABLE_DATA_KEYS]) !== JSON.stringify(['fileId', 'result'])) {
      details.push(`SERVER_WRITABLE_DATA_KEYS=${JSON.stringify([...SERVER_WRITABLE_DATA_KEYS])}（期望 ["fileId","result"]）`);
    }
    if (CLIENT_FORBIDDEN_ON_UPDATE !== SERVER_WRITABLE_DATA_KEYS) {
      details.push('CLIENT_FORBIDDEN_ON_UPDATE 非 SERVER_WRITABLE_DATA_KEYS 同引用（两集分叉=单源破坏——分化须改本断言为有意识动作）');
    }
    report('①', '键集单源契约值={fileId,result}（SERVER_WRITABLE_DATA_KEYS/CLIENT_FORBIDDEN_ON_UPDATE 同引用）', details.length === 0, details);
  }

  // ②局部字面量键集重声明清零（消费必 import 单源常量——四处一致的 lexical 防漂移面；本卡消费面零=纯防将来）。
  //   单源定义文件 canvas-doc-manifest.ts 豁免（定义处即字面量本体）。
  {
    const KEYSET_DEF_FILE = 'packages/shared/src/canvas/canvas-doc-manifest.ts';
    const details = [];
    for (const f of byFile) {
      if (f.rel === KEYSET_DEF_FILE) continue;
      for (const line of findKeySetLiteralRedeclaration(f.raw.split('\n'))) {
        details.push(`${f.rel}:${line} 局部字面量 ['fileId','result']——改 import SERVER_WRITABLE_DATA_KEYS/CLIENT_FORBIDDEN_ON_UPDATE`);
      }
    }
    report('②', `局部字面量 ['fileId','result'] 重声明清零（键集消费必走单源常量；定义文件 ${KEYSET_DEF_FILE} 豁免）`, details.length === 0, details);
  }

  // ③DocNodeRecord 零残留（T1 改名 StoredNodeRecord 防回潮）
  {
    const details = [];
    for (const f of byFile) {
      const hits = findDocNodeRecordResidue(f.stripped);
      if (hits.length) details.push(`${f.rel}:${hits.join(',')} DocNodeRecord 残留（T1 已改名 StoredNodeRecord）`);
    }
    report('③', 'DocNodeRecord 零残留（T1 改名 StoredNodeRecord——旧词面回潮即红）', details.length === 0, details);
  }

  // ④execSeq 裸比较禁令（lint 轻形态=check 脚本 grep gate——仓内无自定义 eslint 规则先例）
  {
    const details = [];
    for (const f of byFile) {
      for (const line of findBareExecSeqComparison(f.stripped.split('\n'))) {
        details.push(`${f.rel}:${line} execSeq 裸比较（string 字典序陷阱）——改 compareExecSeq（media-fact.ts 单源）`);
      }
    }
    report('④', 'execSeq 裸比较清零（</>/<=/>= 禁入——数值比较必走 compareExecSeq）', details.length === 0, details);
  }

  // ⑤compareExecSeq 定义唯一（防第二实现）
  {
    const sites = [];
    for (const f of byFile) {
      for (const line of compareExecSeqDefinitionSites(f.stripped.split('\n'))) sites.push(`${f.rel}:${line}`);
    }
    const pass = sites.length === 1 && sites[0].startsWith('packages/shared/src/canvas/media-fact.ts');
    report('⑤', 'compareExecSeq 定义唯一=shared media-fact.ts（防第二实现漂移）', pass,
      pass ? [] : [`定义点 ${sites.length} 处：${sites.join(' / ') || '零（单源缺失）'}——期望恰 1 处 media-fact.ts`]);
  }

  // ⑥/flowai 改写正则单点（T6③）：web 生产面改写正则仅 mediaApi.ts toFlowaiUrl 定义点——
  //    读侧 content 路径（mediaContentUrl）零 /flowai；测试面不在 collectProductionFiles 扫描集。
  {
    const TOFLOWAI_DEF_FILE = 'apps/web/src/api/mediaApi.ts';
    const details = [];
    for (const f of byFile) {
      if (!f.rel.startsWith('apps/web/src/')) continue;
      if (f.rel === TOFLOWAI_DEF_FILE) continue;
      for (const line of findFlowaiRewriteRedeclaration(f.stripped.split('\n'))) {
        details.push(`${f.rel}:${line} /flowai 改写正则散抄——改 import { toFlowaiUrl } from '@/api/mediaApi'`);
      }
    }
    report('⑥', `/flowai 改写正则清零（单点=${TOFLOWAI_DEF_FILE} toFlowaiUrl；读侧 content 路径零改写）`, details.length === 0, details);
  }

  // ⑦双端 mediaContentUrl 单源锁（T6③）：web/api 两处定义恰在锚文件+TTL 常量数值一致（跨端无
  //    共享类型层——census 数值比对防漂移；值改动=双端同步有意识动作）。
  {
    const details = [];
    const WEB_API = path.join(ROOT, 'apps/web/src/api/mediaApi.ts');
    const API_SVC = path.join(ROOT, 'apps/api/src/modules/media/media-batch.service.ts');
    const webRaw = fs.readFileSync(WEB_API, 'utf8');
    const apiRaw = fs.readFileSync(API_SVC, 'utf8');
    const defSites = byFile.flatMap((f) =>
      /export function mediaContentUrl/.test(f.stripped) ? [f.rel] : []);
    if (!(defSites.length === 2 && defSites.includes('apps/web/src/api/mediaApi.ts') && defSites.includes('apps/api/src/modules/media/media-batch.service.ts'))) {
      details.push(`mediaContentUrl 定义点 ${defSites.length} 处：${defSites.join(' / ')}——期望恰 2（web mediaApi.ts+api media-batch.service.ts）`);
    }
    const webTtl = extractTtlConstValue(webRaw, 'MEDIA_URL_CACHE_TTL_SEC');
    const apiTtl = extractTtlConstValue(apiRaw, 'MEDIA_CONTENT_URL_TTL_SEC');
    if (webTtl == null || apiTtl == null || webTtl !== apiTtl) {
      details.push(`TTL 漂移：web MEDIA_URL_CACHE_TTL_SEC=${webTtl} vs api MEDIA_CONTENT_URL_TTL_SEC=${apiTtl}——双端须同步改`);
    }
    report('⑦', '双端 mediaContentUrl 单源锁（定义恰 2 锚文件+TTL 数值一致）', details.length === 0, details);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\ncheck-plan-census: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.error(`check-plan-census FAIL: ${failed.map((f) => f.id).join(' ')}`); process.exit(1); }
}
