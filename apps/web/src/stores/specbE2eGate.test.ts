// apps/web/src/stores/specbE2eGate.test.ts
// B7-2 门禁分层锚（v3.17 终裁 68③）：新增 e2e 文件必须与 playwright.collab.config testMatch 正则
// 同批改——否则 gate-collab（仅可选 --grep）静默不跑新 spec。本锚从 config 源码提取 testMatch 正则
// （源文本直构 RegExp——不做手抄镜像），对 e2e 目录全量匹配，断言：
//   ① 命中集合恰=5 文件（2 存量 + 本批新增 3——"命中新增文件数=3"）；
//   ② 新增 3 文件逐名在场（删文件即红）；
//   ③ e2e 目录任何其它文件不得被误纳（正则过宽=把非门禁 spec 拉进 nightly）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WEB_ROOT = process.cwd(); // vitest cwd=包根 apps/web
const CONFIG_SRC = readFileSync(path.join(WEB_ROOT, 'playwright.collab.config.ts'), 'utf8');

/** 从 config 源码提取 testMatch 正则字面量（源文本直构——防手抄镜像漂移） */
function testMatchRegex(): RegExp {
  const m = /testMatch:\s*\/(.+?)\/\s*,/.exec(CONFIG_SRC);
  if (!m) throw new Error('playwright.collab.config.ts 未找到 testMatch 正则字面量');
  return new RegExp(m[1]);
}

const SPECB_NEW_FILES = [
  'collab-specb-geometry.e2e.spec.ts',
  'collab-specb-public.e2e.spec.ts',
  'collab-specb-perf.e2e.spec.ts',
] as const;

describe('B7-2 门禁分层：collab testMatch 命中新增文件数锚', () => {
  it('testMatch 命中集合恰=5 文件（2 存量+新增 3——新增未进 testMatch 即静默不跑，本锚兜底）', () => {
    const re = testMatchRegex();
    const e2eDir = path.join(WEB_ROOT, 'e2e');
    const matched = readdirSync(e2eDir).filter((f) => re.test(f)).sort();
    expect(matched).toEqual([
      'collab-r2-commands.e2e.spec.ts',
      'collab-recovery.e2e.spec.ts',
      ...[...SPECB_NEW_FILES].sort(),
    ]);
  });

  it('新增 3 spec 文件逐名在场且被 testMatch 命中（命中新增文件数=3）', () => {
    const re = testMatchRegex();
    for (const f of SPECB_NEW_FILES) {
      const src = readFileSync(path.join(WEB_ROOT, 'e2e', f), 'utf8'); // 不存在即抛=红
      expect(re.test(f), `${f} 未被 testMatch 命中`).toBe(true);
      expect(src).toContain("from '@playwright/test'"); // 形态自证（playwright spec）
    }
  });

  it('500 节点性能冒烟单列 spec 在 testMatch 内（数字冻结锚的运行载体）', () => {
    const re = testMatchRegex();
    expect(re.test('collab-specb-perf.e2e.spec.ts')).toBe(true);
  });
});
