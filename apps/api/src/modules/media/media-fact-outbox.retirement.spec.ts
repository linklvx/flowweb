// apps/api/src/modules/media/media-fact-outbox.retirement.spec.ts
// C2-4（spec 2026-11-11-foundation-batch-design.md §3.1-4/⑥，plan v3）：MediaFactOutbox 旧面退役
// grep 锚（collab-t32-deletion.spec 同形态先例）。写点（C2-2）/读道（C2-3）已改道 MediaFact——本锚
// 钉「读者/清理面/指标/脚本/测试对旧表零触碰」：camelCase delegate（prisma.mediaFactOutbox）与
// gauge 名（media_fact_outbox_lag）在 生产+测试+脚本 全域零命中（白名单外红）。
//
// 白名单（=C2-4 census 放行项，逐处理由；C1-1 删表时随模型除名清零）：
//  - scope-column.registry.ts：PROJECT_COLUMN_MODELS schema 闭包条目——表暂留 C1（㊲ 门=双向 diff，
//    除名须与模型删除同批；erasure 批删/断言由 registry 驱动，提前除名=擦除项目在仍存在的表里留孤儿行）；
//  - project-erasure.purge.c4c1.int.spec.ts：erasure 全表清点 fixture（registry 闭包断言面同源）；
//  - packages/shared/src/collab/lifecycle.ts + lifecycle.spec.ts：OBLIGATION_EXCLUDED_CANDIDATES
//    排除台账（键域无 nodeId 的既档理由——表在册一日台账真一日）；
//  - packages/shared/src/collab/runtime-event.ts：T22 修正批 #3 历史裁定注记（决策史档非触碰）；
//  - media-facts.controller.ts：C2-3 头注的历史改道说明（「旧读道已断流」缘由在档）。
// PascalCase 模型名仅上列五处合法；schema.prisma+prisma/migrations+apps/api/soak-t19.json
// （历史证据）不在本锚扫描域（表本体与迁移史=表暂留 C1 的明确豁免面）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 仓根定位（module:commonjs；本文件=apps/api/src/modules/media/ 下五级）
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const SELF = 'apps/api/src/modules/media/media-fact-outbox.retirement.spec.ts';

/** 扫描域：生产+测试 TS（apps 两端+shared src）与根/api 两处脚本 *.mjs（本 spec 自身排除——锚词面自 hit）。 */
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
  walk('packages/shared/src', /\.ts$/);
  walk('scripts', /\.mjs$/);
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

describe('C2-4 MediaFactOutbox 旧面退役 grep 锚（表暂留 C1 物删——白名单外零触碰）', () => {
  it('camelCase delegate `mediaFactOutbox`：生产/测试/脚本全域仅 erasure c4c1 fixture 合法（registry 闭包断言面）', () => {
    assertWithin('mediaFactOutbox', [
      'apps/api/src/modules/collab/project-erasure.purge.c4c1.int.spec.ts',
    ]);
  });

  it('gauge 名 `media_fact_outbox_lag`：全链零命中（delivery-lag.metrics+soak 两处已退役）', () => {
    expect(hits('media_fact_outbox_lag')).toEqual([]);
  });

  it('PascalCase 模型名 `MediaFactOutbox`：仅 census 放行五处（registry 闭包/c4c1 fixture/lifecycle 台账×2/runtime-event 史注/media-facts 头注）', () => {
    assertWithin('MediaFactOutbox', [
      'apps/api/src/modules/collab/scope-column.registry.ts',
      'apps/api/src/modules/collab/project-erasure.purge.c4c1.int.spec.ts',
      'packages/shared/src/collab/lifecycle.ts',
      'packages/shared/src/collab/lifecycle.spec.ts',
      'packages/shared/src/collab/runtime-event.ts',
      'apps/api/src/modules/media/media-facts.controller.ts',
    ]);
  });
});
