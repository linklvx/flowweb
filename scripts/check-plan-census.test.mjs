// Y1a T3：check-plan-census.mjs 单元测试（node --test；check-collab-census.test.mjs 先例形态）。
// 只测纯 helper；端到端走 verify 链的 `node scripts/check-plan-census.mjs`。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findKeySetLiteralRedeclaration,
  findBareExecSeqComparison,
  findDocNodeRecordResidue,
  compareExecSeqDefinitionSites,
  findFlowaiRewriteRedeclaration,
  extractTtlConstValue,
} from './check-plan-census.mjs';
import { stripCommentsAndStrings } from './check-collab-census.mjs';

test('findKeySetLiteralRedeclaration：正/反序+单双引号命中；注释行/其他数组不命中', () => {
  const lines = [
    "const k = ['fileId', 'result'];",          // 命中
    "const k2 = [ 'result' , 'fileId' ];",      // 命中（反序+空白容忍）
    "const k3 = [\"fileId\", \"result\"];",     // 命中（双引号）
    "// const k = ['fileId', 'result'];",       // 注释行——不命中
    "const k4 = ['fileId', 'errorCode'];",      // 键集不同——不命中
    "const k5 = ['fileId'];",                   // 单键——不命中
    "import { SERVER_WRITABLE_DATA_KEYS } from '@flowweb/shared';",  // import 单源——不命中
  ];
  assert.deepEqual(findKeySetLiteralRedeclaration(lines), [1, 2, 3]);
});

test('findBareExecSeqComparison：裸 </>/<=/>= 命中；===/!==/=>/调用/BigInt 局部变量不命中', () => {
  const raw = [
    'if (a.execSeq > b.execSeq) return;',        // 命中——字典序裸比
    'while (execSeq<= max) {',                   // 命中（无空格+单词边界）
    'if (a.execSeq >= b.execSeq) return;',       // 命中
    'if (a.execSeq === b.execSeq) return;',      // 相等比较——不命中（无字典序陷阱）
    'const f = (execSeq) => execSeq + 1;',       // 箭头函数——不命中（= 先于 >，且 => 非比较形态）
    'if (compareExecSeq(a, b) < 0) return;',     // 单源调用——不命中
    'return ba < bb ? -1 : ba > bb ? 1 : 0;',    // BigInt 局部变量——不命中
  ].join('\n');
  const stripped = stripCommentsAndStrings(raw);
  assert.deepEqual(findBareExecSeqComparison(stripped.split('\n')), [1, 2, 3]);
});

test('findDocNodeRecordResidue：旧词面命中（行号定位）；StoredNodeRecord 不误伤；注释剥除', () => {
  const raw = [
    'export interface StoredNodeRecord { id: string; }',   // 不命中（\b 边界——StoredNodeRecord 不含独立 DocNodeRecord 词）
    'const r: DocNodeRecord = {};',                         // 命中
    '// type DocNodeRecord = legacy',                       // 注释——剥离后不命中
    'declare function f(r: DocNodeRecord): DocNodeRecord;', // 命中 ×2
  ].join('\n');
  const stripped = stripCommentsAndStrings(raw);
  assert.deepEqual(findDocNodeRecordResidue(stripped), [2, 4, 4]);
});

test('compareExecSeqDefinitionSites：function/= 定义命中；调用/import/类型引用不命中', () => {
  const stripped = stripCommentsAndStrings([
    'export function compareExecSeq(a: string, b: string): number {',  // 命中（function 定义）
    '  const x = compareExecSeq(a, b);',                               // 调用——不命中
    '}',
    'import { compareExecSeq } from "./media-fact";',                  // import——不命中
    'const g: typeof compareExecSeq = compareExecSeq;',                // 命中（= 定义别名）
  ].join('\n'));
  assert.deepEqual(compareExecSeqDefinitionSites(stripped.split('\n')), [1, 5]);
});

test('findFlowaiRewriteRedeclaration：改写正则字面量命中；单点定义/纯字符串/注释不命中（T6⑥）', () => {
  const raw = [
    "const proxy = url.replace(/^https?:\\/\\/[^/]+\\/flowai/, '/flowai');",  // 命中（散抄正则）
    "export const toFlowaiUrl = (url: string) => url.replace(/^https?:\\/\\/[^/]+\\/flowai/, '/flowai');",  // 单点定义——主流程白名单豁免（helper 本身命中）
    "const p = '/flowai/up';",                                            // 纯字符串——stripped 剥内容不命中
    "const mediaUrl = `/api/media/${fileId}/content`;",                  // content 路径——不命中
    '// 改写 /flowai（注释）',                                             // 注释——剥离不命中
  ].join('\n');
  const stripped = stripCommentsAndStrings(raw);
  assert.deepEqual(findFlowaiRewriteRedeclaration(stripped.split('\n')), [1, 2]);
});

test('extractTtlConstValue：数字字面量提取（含 _ 分隔）；未定义/非数字形态 null（T6⑦）', () => {
  assert.equal(extractTtlConstValue('export const MEDIA_URL_CACHE_TTL_SEC = 86_400;', 'MEDIA_URL_CACHE_TTL_SEC'), 86400);
  assert.equal(extractTtlConstValue('export const MEDIA_CONTENT_URL_TTL_SEC = 86_400;', 'MEDIA_CONTENT_URL_TTL_SEC'), 86400);
  assert.equal(extractTtlConstValue('export const X = 3600;', 'MEDIA_URL_CACHE_TTL_SEC'), null);
  assert.equal(extractTtlConstValue('const A = SEC_900;', 'A'), null);   // 非纯数字——null（防误提标识符）
});
