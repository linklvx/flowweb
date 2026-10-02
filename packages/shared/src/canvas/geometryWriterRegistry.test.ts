// packages/shared/src/canvas/geometryWriterRegistry.test.ts
// C0-2 账本 sanity：文件路径真实存在（防 typo 漂移）+ 类别封闭（allowlist 用到的类别 ⊆ 枚举值面）。
// 处数不入断言（口径随正则浮动——账本按文件+函数列出，见模块头注）。
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GEOMETRY_WRITER_ALLOWLIST,
  GEOMETRY_WRITER_CATEGORIES,
} from './geometryWriterRegistry';

const WEB_ROOT = fileURLToPath(new URL('../../../../apps/web', import.meta.url));

describe('geometryWriterRegistry（写者归类账本 sanity）', () => {
  it('账本键=apps/web 真实存在的源文件（posix 相对路径不漂移）', () => {
    const files = Object.keys(GEOMETRY_WRITER_ALLOWLIST);
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) {
      expect(existsSync(join(WEB_ROOT, f)), f).toBe(true);
    }
  });

  it('allowlist 用到的类别 ⊆ GEOMETRY_WRITER_CATEGORIES ∪ {non-geometry}', () => {
    const known = new Set<string>([...GEOMETRY_WRITER_CATEGORIES, 'non-geometry']);
    for (const sites of Object.values(GEOMETRY_WRITER_ALLOWLIST)) {
      for (const s of sites) {
        expect(known.has(s.category), `${s.fn}: ${s.category}`).toBe(true);
      }
    }
  });

  it('枚举值面无重复（GEOMETRY_WRITER_CATEGORIES 封闭清单）', () => {
    expect(new Set(GEOMETRY_WRITER_CATEGORIES).size).toBe(GEOMETRY_WRITER_CATEGORIES.length);
  });
});
