// apps/api/src/modules/collab/shadow-literal.scan.spec.ts
// 批5 判据⑤（api 半边静态断言）：生产代码（apps/api/src 非 test）禁以 'shadow-' 开头的
// string/template 字面量——影子 id 生成/过滤/白名单三形态随信箱删除零回流。
// web 半边 = lint-gate flowweb/no-shadow-literal（AST 规则）；api 无 lint-gate 门禁
// （pnpm verify 不含 api lint），以本 spec 兜（tsc+vitest 均在 verify 链内）。
// TS AST 扫描：注释不是 AST 节点天然豁免（历史注释里的 shadow- 提及保留）。
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// pnpm --filter 的 cwd 恒为包根（body-param-ratchet.spec 同款先例——import.meta 在 spec tsconfig 的
// commonjs module 下 tsc 拒绝）
const SRC_ROOT = resolve(process.cwd(), 'src');

function collectProductionTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectProductionTs(p, out);
    else if (name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** 以 shadow- 开头的 string/template 字面量首段文本（AST——注释天然不参与） */
function shadowPrefixedLiterals(code: string, fileName: string): string[] {
  const hits: string[] = [];
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const walk = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && node.text.startsWith('shadow-')) hits.push(node.text);
    if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.startsWith('shadow-')) hits.push(node.text);
    if (ts.isTemplateExpression(node) && node.head.text.startsWith('shadow-')) hits.push(node.head.text);
    node.forEachChild(walk);
  };
  walk(sf);
  return hits;
}

describe('批5 判据⑤：api 生产代码 shadow- 前缀字面量零命中（TS AST 扫描）', () => {
  it('探测器自测（防假绿）：合成源码命中 string/模板两形态，注释与非前缀串不命中', () => {
    const code = [
      "const a = 'shadow-video-1';",
      'const b = `shadow-${id}`;',
      "const c = '/video-projects/remove-shadow';",
      "const d = '说明：shadow- 前缀已删';",
      '// 历史注释 shadow-x 保留',
    ].join('\n');
    expect(shadowPrefixedLiterals(code, 'synthetic.ts')).toEqual(['shadow-video-1', 'shadow-']);
  });

  it('仓库扫描：apps/api/src 生产代码（非 test）零命中', () => {
    const offenders = collectProductionTs(SRC_ROOT).flatMap((f) =>
      shadowPrefixedLiterals(readFileSync(f, 'utf8'), f).map((t) => `${f}: ${t}`));
    expect(offenders).toEqual([]);
  });
});
