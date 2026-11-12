// apps/api/src/modules/media/media-fact-outbox.retirement.spec.ts
// C2-4（spec 2026-11-11-foundation-batch-design.md §3.1-4/⑥，plan v3）：MediaFactOutbox 旧面退役
// grep 锚（collab-t32-deletion.spec 同形态先例）。写点（C2-2）/读道（C2-3）已改道 MediaFact——本锚
// 钉「读者/清理面/指标/脚本/测试对旧表零触碰」：camelCase delegate（prisma.mediaFactOutbox）与
// gauge 名（media_fact_outbox_lag）在扫描全域零命中（白名单外红）。扫描全域=apps/api/src+
// apps/web/src+apps/web/e2e+packages/shared/src（生产+测试 TS/TSX）+根 scripts（*.mjs+*.ts/*.mts）+
// apps/api/scripts（*.mjs）。
//
// 白名单（C1-1 rebaseline 后=空：表/模型/enum 已物删，六点同步面清零——新增任何命中即红）：
//  C2-4 结算时六文件（scope-column.registry / project-erasure.purge.c4c1 fixture / lifecycle.ts +
//  lifecycle.spec / runtime-event.ts / media-facts.controller.ts）已随模型删除/头注改写除名。
// PascalCase 模型名零命中；schema.prisma+prisma/migrations（init 无旧表）+apps/api/soak-t19.json
// （历史证据）不在本锚扫描域。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 仓根定位（module:commonjs；本文件=apps/api/src/modules/media/ 下五级）
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const SELF = 'apps/api/src/modules/media/media-fact-outbox.retirement.spec.ts';

/** 扫描域：生产+测试 TS（apps 两端 src+shared src+web e2e）+根 scripts（*.mjs+*.ts/*.mts）+
 *  apps/api/scripts（*.mjs）（本 spec 自身排除——锚词面自 hit）。 */
function collectScanFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, ext: RegExp) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(p, ext);
      else if (ext.test(e.name)) out.push(p);
    }
  };
  walk('apps/api/src', /\.(ts|tsx)$/);
  walk('apps/web/src', /\.(ts|tsx)$/);
  walk('apps/web/e2e', /\.ts$/);
  walk('packages/shared/src', /\.ts$/);
  walk('scripts', /\.(mjs|m?ts)$/);
  walk('apps/api/scripts', /\.mjs$/);
  return out.filter((p) => p !== SELF).sort();
}

/** raw 全文命中（注释/字符串同计——登记条目本身是字符串字面量，stripped 面结构性不可见）。 */
function hits(token: string): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const p of collectScanFiles()) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    src.split('\n').forEach((l, i) => {
      if (l.includes(token)) out.push({ file: p, line: i + 1, text: l.trim() });
    });
  }
  return out;
}

/** 白名单断言：token 命中文件集 ⊆ allow（白名单外新增引用即红；白名单点消失=绿不回退）。 */
function assertWithin(token: string, allow: readonly string[]): void {
  const stray = hits(token).filter((h) => !allow.includes(h.file));
  expect(stray.map((h) => `${h.file}:${h.line} ${h.text}`), `token '${token}' 白名单=${allow.join('|')} 外命中`).toEqual([]);
}

describe('C2-4 MediaFactOutbox 旧面退役 grep 锚（C1-1 物删——白名单空，全域零触碰）', () => {
  it('camelCase delegate `mediaFactOutbox`：生产/测试/脚本全域零命中（模型物删——delegate 不存在）', () => {
    assertWithin('mediaFactOutbox', []);
  });

  it('gauge 名 `media_fact_outbox_lag`：全链零命中（delivery-lag.metrics+soak 两处已退役）', () => {
    expect(hits('media_fact_outbox_lag')).toEqual([]);
  });

  it('PascalCase 模型名 `MediaFactOutbox`：全链零命中（C1-1 六点除名清零——新增引用即红）', () => {
    assertWithin('MediaFactOutbox', []);
  });
});
