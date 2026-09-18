// A3 验收项 "ESLint fixture"（plan A3-3 / spec §2.6-5）：
// 1) 规则拦截证明——违例字符串被 flowweb/no-color-hex 命中，非拦截面不误报；
// 2) 门禁增量证明——baseline 命中的存量违例（含行号移动）放行，非存量违例判新增。
// 纯内存 Linter + 纯函数 diff，不做全量 type-aware 跑（快）。
import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import { noColorHex } from '../eslint-rules/no-color-hex.js';
import { NEW_RULE_ID, violationKey, diffNewViolations } from '../lint-gate.mjs';

const linter = new Linter(); // ESLint 10 默认 flat
const lintFixture = (code) =>
  linter.verify(code, {
    plugins: { flowweb: { rules: { 'no-color-hex': noColorHex } } },
    rules: { 'flowweb/no-color-hex': 'error' },
  });

describe('flowweb/no-color-hex 规则拦截（fixture）', () => {
  it('新增违例：颜色前缀任意值 hex 被拦截', () => {
    const messages = lintFixture("const cls = 'bg-[#123456]';");
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(NEW_RULE_ID);
  });

  it('!important 变体与变体前缀前缀天然命中（hover:bg-[#…] 含子串 bg-[#）', () => {
    expect(lintFixture("const a = '!bg-[#123]';")).toHaveLength(1);
    expect(lintFixture("const a = 'hover:bg-[#f00]';")).toHaveLength(1);
    expect(lintFixture('const a = `md:hover:!text-[#abcdef]`;')).toHaveLength(1);
  });

  it('存量同款违例同样被规则命中——放行与否由 baseline 门禁决定，而非规则本身', () => {
    // 与 baseline 采集时同款写法：规则无差别命中
    expect(lintFixture("const cls = 'text-[#1F6DFF]';")).toHaveLength(1);
  });

  it('多行模板字面量：报错锚定 hex 所在 quasi 行，而非起始反引号行（报错行文本须含 hex）', () => {
    const code = ['const cls = `', '  flex items-center', '  bg-[#123456]', '`;'].join('\n');
    const messages = lintFixture(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].line).toBe(3); // hex 在第 3 行，而非反引号起始的第 1 行
    expect(code.split('\n')[messages[0].line - 1]).toContain('bg-[#123456]');
  });

  it('非拦截面不误报：w-[#]、bg-[url(#…)]、rgba(、shadow-[0_0_…#…]、style 对象字面量', () => {
    expect(lintFixture("const a = 'w-[#abcde]';")).toHaveLength(0);
    expect(lintFixture("const a = 'bg-[url(#fragment)]';")).toHaveLength(0);
    expect(lintFixture("const a = 'bg-[rgba(0,0,0,0.5)]';")).toHaveLength(0);
    expect(lintFixture("const a = 'shadow-[0_0_10px_#fff]';")).toHaveLength(0);
    // O3 范围声明：不拦 style 对象字面量（归 B2-2 逐处判定通道）
    expect(lintFixture("const style = { color: '#fff' };")).toHaveLength(0);
  });
});

describe('lint-gate 增量门禁（fixture）', () => {
  const LINE_TEXT = "    <div className='bg-[#123456]' />;";
  const baselineKeys = [violationKey(NEW_RULE_ID, 'src/pages/Foo.tsx', LINE_TEXT)];

  it('键不含行号：键结构 = ruleId | 文件相对路径 | 行文本 hash', () => {
    const key = violationKey(NEW_RULE_ID, 'src/pages/Foo.tsx', LINE_TEXT);
    expect(key.split('|')).toHaveLength(3); // 无行号段——行移动不触发门禁
  });

  it('行尾空白（含 CRLF 残留 \r）不影响键', () => {
    const a = violationKey(NEW_RULE_ID, 'src/pages/Foo.tsx', LINE_TEXT);
    const b = violationKey(NEW_RULE_ID, 'src/pages/Foo.tsx', LINE_TEXT + '  \r');
    expect(b).toBe(a);
  });

  it('baseline 命中（含行号移动后的同文本行）→ 0 新增，门禁放行', () => {
    const violations = [
      { ruleId: NEW_RULE_ID, filePath: 'src/pages/Foo.tsx', line: 3, lineText: LINE_TEXT },
      { ruleId: NEW_RULE_ID, filePath: 'src/pages/Foo.tsx', line: 42, lineText: LINE_TEXT }, // 行移动
    ];
    expect(diffNewViolations(baselineKeys, violations)).toHaveLength(0);
  });

  it('非 baseline 违例 → 判新增，门禁拦下', () => {
    const violations = [
      { ruleId: NEW_RULE_ID, filePath: 'src/pages/Foo.tsx', line: 3, lineText: LINE_TEXT },
      { ruleId: NEW_RULE_ID, filePath: 'src/pages/Bar.tsx', line: 7, lineText: "    <div className='text-[#ff0000]' />;" },
    ];
    const news = diffNewViolations(baselineKeys, violations);
    expect(news).toHaveLength(1);
    expect(news[0].filePath.replace(/\\/g, '/')).toBe('src/pages/Bar.tsx');
    expect(news[0].line).toBe(7);
  });

  it('同文件同文本重复行塌缩为一键（O3 已接受的口径）', () => {
    const violations = [
      { ruleId: NEW_RULE_ID, filePath: 'src/pages/Baz.tsx', line: 1, lineText: LINE_TEXT },
      { ruleId: NEW_RULE_ID, filePath: 'src/pages/Baz.tsx', line: 9, lineText: LINE_TEXT },
    ];
    expect(diffNewViolations([], violations)).toHaveLength(1);
  });
});
