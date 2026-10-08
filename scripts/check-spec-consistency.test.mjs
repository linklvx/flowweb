// scripts/check-spec-consistency.test.mjs —— Y0b-0（spec §9.22，v2 微修 Z15）：一致性门禁纯函数自测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripForDenylist, extractEnvKeys, parseFencedBlock, collectMetricFiles, DENYLIST } from './check-spec-consistency.mjs';

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
test('collectMetricFiles：glob **/*.metrics.ts 递归收集（含 video-separate——v1 硬编码 3 文件漏它）', () => {
  const files = collectMetricFiles();
  assert.ok(files.some((f) => f.endsWith('video-separate.metrics.ts')), 'video-separate 必须被 glob 收集');
  assert.ok(files.some((f) => f.endsWith('store.metrics.ts')));
});
