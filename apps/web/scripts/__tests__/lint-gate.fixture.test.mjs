// A3 验收项 "ESLint fixture"（plan A3-3 / spec §2.6-5）：
// 1) 规则拦截证明——违例字符串被 flowweb/no-color-hex 命中，非拦截面不误报；
// 2) 门禁增量证明——baseline 命中的存量违例（含行号移动）放行，非存量违例判新增。
// 纯内存 Linter + 纯函数 diff，不做全量 type-aware 跑（快）。
import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import { noColorHex } from '../eslint-rules/no-color-hex.js';
import { noThemeUtility } from '../eslint-rules/no-theme-utility.js';
import { NEW_RULE_ID, THEME_RULE_ID, violationKey, diffNewViolations } from '../lint-gate.mjs';

const linter = new Linter(); // ESLint 10 默认 flat
const lintFixture = (code) =>
  linter.verify(code, {
    plugins: { flowweb: { rules: { 'no-color-hex': noColorHex } } },
    rules: { 'flowweb/no-color-hex': 'error' },
  });
const lintThemeFixture = (code, filename) =>
  linter.verify(
    code,
    {
      files: ['**/*.ts', '**/*.tsx'], // flat Linter.verify 带 filename 时要求配置显式匹配文件
      plugins: { flowweb: { rules: { 'no-theme-utility': noThemeUtility } } },
      rules: { 'flowweb/no-theme-utility': 'error' },
    },
    { filename }, // 白名单按文件路径判定，fixture 以相对路径直供（规则内部按 APP_ROOT 相对解释，与 cwd 无关）
  );

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

describe('flowweb/no-theme-utility 规则拦截（fixture，B5）', () => {
  it('白名单域放行：videos 恒深域 text-white 不报', () => {
    expect(
      lintThemeFixture("const cls = 'text-white';", 'src/pages/videos/PlayView.tsx'),
    ).toHaveLength(0);
  });

  it('跟随域 text-white 判违例', () => {
    const messages = lintThemeFixture("const cls = 'text-white';", 'src/pages/settings/Profile.tsx');
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(THEME_RULE_ID);
  });

  it('跟随域 text-black 判违例；白名单域（board 节点）放行', () => {
    expect(
      lintThemeFixture("const cls = 'text-black';", 'src/pages/settings/Profile.tsx'),
    ).toHaveLength(1);
    expect(
      lintThemeFixture("const cls = 'text-black';", 'src/pages/canvas/components/nodes/TextConfigPanel.tsx'),
    ).toHaveLength(0);
  });

  it('变体前缀天然命中：hover:text-white 被拦（与 hover:bg-[#…] 同口径）', () => {
    expect(
      lintThemeFixture("const cls = 'hover:text-white';", 'src/pages/settings/Profile.tsx'),
    ).toHaveLength(1);
    expect(
      lintThemeFixture('const cls = `md:hover:!text-black`;', 'src/pages/settings/Profile.tsx'),
    ).toHaveLength(1);
  });

  it('斜杠透明度形命中：text-white/90（跟随域）', () => {
    expect(
      lintThemeFixture("const cls = 'text-white/90';", 'src/components/HistoryPage/HistorySidebar.tsx'),
    ).toHaveLength(1);
  });

  it('text-whitesmoke（非完整 token）、text-[#fff]（hex 规则域）不误报；bg-white 随 C8 扩九前缀族改判命中', () => {
    const code = "const b = 'text-whitesmoke'; const c = 'text-[#ffffff]';";
    expect(lintThemeFixture(code, 'src/pages/settings/Profile.tsx')).toHaveLength(0);
    // C8 Task 19 扩九前缀族：bg-white 现为命中面（文件头注释同步改写，旧"非 text 前缀不命中"口径废止）
    expect(lintThemeFixture("const a = 'bg-white';", 'src/pages/settings/Profile.tsx')).toHaveLength(1);
  });

  // —— C8 Task 19 Step 2b：扩规则自测（白名单双形态 + 串内全匹配 + 两式同步闭环）——

  it('① 目录条目全放行：nodes 恒深域（string 条目）九族不报（升级前基线，守旧语义；Task 20 审查修——原锚 videos/VideoCard 已随目录摘除改精确条目，border-white/50 正确可报致基线红）', () => {
    expect(
      lintThemeFixture("const a = 'bg-white text-black border-white/50';", 'src/pages/canvas/components/nodes/VideoGenNode.tsx'),
    ).toHaveLength(0);
  });

  it('② 精确条目全匹配判定：TopActionBar allow:[bg,text]——两家族都在 allow → 0 报；border 超出 → 1 报（首个匹配在 allow 不能放行同串真违例）', () => {
    const ok = lintThemeFixture("const a = 'bg-white hover:text-black';", 'src/components/layout/TopActionBar.tsx');
    expect(ok).toHaveLength(0);
    const bad = lintThemeFixture("const a = 'bg-white border-white';", 'src/components/layout/TopActionBar.tsx');
    expect(bad).toHaveLength(1);
    expect(bad[0].messageId).toBe('themeUtilityForbidden');
  });

  it('③ 模板串逐 quasi：quasis 逐段收集——bg-white(allowed)+border-white(超出) → 1 报；纯 allow 族模板 → 0 报（quasi 收集路径守卫）', () => {
    const bad = lintThemeFixture(
      'const cls = `bg-white ${x} border-white`;',
      'src/components/layout/TopActionBar.tsx',
    );
    expect(bad).toHaveLength(1);
    expect(bad[0].messageId).toBe('themeUtilityForbidden');
    expect(
      lintThemeFixture('const cls = `bg-white ${x}`;', 'src/components/layout/TopActionBar.tsx'),
    ).toHaveLength(0);
  });

  it('④a 非白名单 hover:!bg-white（变体+! 单 token）→ 1 报——守 THEME_UTILITY_RE 认得变体前缀+!（scanner 契约单串单报，恒 1 非 2）', () => {
    const messages = lintThemeFixture("const cls = 'hover:!bg-white';", 'src/pages/settings/Profile.tsx');
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('themeUtilityForbidden');
  });

  it("④b' 精确条目 allow:[bg]（CreditsDropdown 真实条目）hover:!bg-white → 0 报——GLOBAL 式 familiesOf 认得变体+!（漏认则 fams=[] 落 visit 假红）", () => {
    expect(
      lintThemeFixture("const cls = 'hover:!bg-white';", 'src/pages/canvas/components/CreditsDropdown.tsx'),
    ).toHaveLength(0);
  });

  it('④b″ 同 filename allow:[bg]，hover:!bg-white text-black → 1 报——全匹配判定（text 超出 allow）+变体提取叠加路径', () => {
    const messages = lintThemeFixture(
      "const cls = 'hover:!bg-white text-black';",
      'src/pages/canvas/components/CreditsDropdown.tsx',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('themeUtilityForbidden');
  });

  it('④c 非白名单 bg-white/[0.06]（方括号 alpha）→ 1 报——alpha 段方括号形态两式都认得（不认得则 0 报假绿）', () => {
    const messages = lintThemeFixture("const cls = 'bg-white/[0.06]';", 'src/pages/settings/Profile.tsx');
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('themeUtilityForbidden');
  });

  it('④c′ allow 侧方括号 alpha 判别（quality 审查补）——CreditsDropdown(allow:[bg]) 上 bg-white/[0.06] 0 报（GLOBAL 式认得方括号形态方能过 every 门；漏认则 fams=[] 落 visit 假红）', () => {
    const messages = lintThemeFixture("const cls = 'bg-white/[0.06]';", 'src/pages/canvas/components/CreditsDropdown.tsx');
    expect(messages).toHaveLength(0);
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
