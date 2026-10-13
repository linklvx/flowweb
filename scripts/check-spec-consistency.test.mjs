// scripts/check-spec-consistency.test.mjs —— Y0b-0（spec §9.22，v2 微修 Z15）：一致性门禁纯函数自测
// Y0b-5 T10（裁定 24⑸）：--write-metric-names 落盘模式的纯函数（renderMetricNamesBlock/
// replaceFencedBlock）——门禁已持有两侧集合，写模式只做"*.metrics.ts 侧集合 → spec §10 围栏块"单向落盘。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripForDenylist, extractEnvKeys, extractMetricNames, parseFencedBlock, collectMetricFiles, renderMetricNamesBlock, replaceFencedBlock, DENYLIST } from './check-spec-consistency.mjs';

test('P7 三层剥离：HTML 注释/fenced 块/全角括号——代码型 token 合法提及不命中，正文命中', () => {
  const spec = [
    '<!-- doc-status: v2.4 ... release_once 残留清扫 ... -->',
    '## 1.1 迁移',
    '历史：幂等（v2.2 删除 `release_once`——冗余（嵌套（再嵌套）））。',
    '```yaml',
    'release_once: 已退役',
    '```',
    '正文规范句：禁用 replay_kill。',
  ].join('\n');
  const stripped = stripForDenylist(spec);
  const hits = DENYLIST.filter((d) => stripped.includes(d));
  assert.deepEqual(hits, ['replay_kill']);   // 注释/fenced/（）内全剥；正文命中且仅命中
});
test('extractEnvKeys：envSchema 块内两空格缩进键全提取、块外不取', () => {
  const src = [
    "export const envSchema = z.object({",
    "  DATABASE_URL: z.string().url(),",
    "  PORT: z.coerce.number().default(3000),",
    "});",
    "const NOT_A_KEY: z.string();",
  ].join('\n');
  assert.deepEqual(extractEnvKeys(src), ['DATABASE_URL', 'PORT']);
});
test('parseFencedBlock：标记后取第一 fenced 块内 `- key` 行；无标记/无块返回 null', () => {
  const md = '<!-- y0b0:env-keys -->\n```yaml\n- A\n- B\n```\n';
  assert.deepEqual(parseFencedBlock(md, 'y0b0:env-keys'), ['A', 'B']);
  assert.equal(parseFencedBlock(md, 'y0b0:missing'), null);
  assert.equal(parseFencedBlock('<!-- y0b0:x -->\n无围栏', 'y0b0:x'), null);
});
test('extractMetricNames：name: 行提取+排序；label 等非 name 行不捕获', () => {
  assert.deepEqual(extractMetricNames("name: 'foo_total'\nname:'bar_total'\nlabel: 'x'"), ['bar_total', 'foo_total']);
});
test('collectMetricFiles：glob **/*.metrics.ts 递归收集（含 video-separate——v1 硬编码 3 文件漏它）', () => {
  const files = collectMetricFiles();
  assert.ok(files.some((f) => f.endsWith('video-separate.metrics.ts')), 'video-separate 必须被 glob 收集');
  assert.ok(files.some((f) => f.endsWith('store.metrics.ts')));
});

// ===== Y0b-5 T10：--write-metric-names 落盘模式纯函数 =====

test('renderMetricNamesBlock：`- name` 行+yaml 围栏（与 parseFencedBlock 往返恒等——写后即读）', () => {
  const block = renderMetricNamesBlock(['b_total', 'a_total', 'c_total']);
  assert.equal(block, '```yaml\n- a_total\n- b_total\n- c_total\n```');
  // 往返：写出的块被 parseFencedBlock 读回同一集合（写后即绿的结构保证）
  const md = `<!-- y0b0:metric-names -->\n${block}\n`;
  assert.deepEqual(parseFencedBlock(md, 'y0b0:metric-names'), ['a_total', 'b_total', 'c_total']);
});

test('replaceFencedBlock：只替换标记后第一个围栏内容（块外正文/后续块不动）；无标记返回 null', () => {
  const md = [
    '前文',
    '<!-- y0b0:metric-names -->',
    '```yaml',
    '- old_metric',
    '```',
    '后文（含第二块）',
    '```yaml',
    '- other_block',
    '```',
  ].join('\n');
  const out = replaceFencedBlock(md, 'y0b0:metric-names', '```yaml\n- new_metric\n```');
  assert.deepEqual(parseFencedBlock(out, 'y0b0:metric-names'), ['new_metric']);
  assert.ok(out.includes('- old_metric') === false, '旧条目清除');
  assert.ok(out.includes('- other_block'), '标记外第二块不动');
  assert.ok(out.startsWith('前文') && out.includes('后文（含第二块）'), '块外正文保留');
  assert.equal(replaceFencedBlock(md, 'y0b0:missing', '```yaml\n- x\n```'), null);
});
