import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';

// Spec B M0-1 删除锚（拍板 a1 净删）：模板市场 api 面符号级不存在守卫。
// 四面覆盖：schema 列（DMMF）/TS 类型+方法（prototype）/端点（controller 原型）/夹具+死导入（源码 grep）。
// web 面（TemplatePreviewPage/importTemplate/+works/:id 路由 404）归 M0-2，不在本守卫。

const here = __dirname;

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('M0-1 模板市场删除守卫（a1）', () => {
  it('schema 四死列已 drop：Template 模型无 templateData/status/isPublic/description', () => {
    const fields = Prisma.dmmf.datamodel.models
      .find((m) => m.name === 'Template')!
      .fields.map((f) => f.name);
    for (const col of ['templateData', 'status', 'isPublic', 'description']) {
      expect(fields, `死列 ${col} 应已 drop`).not.toContain(col);
    }
  });

  it('TemplateService 无 getTemplate/import/initOfficialTemplates 符号', () => {
    const proto = TemplateService.prototype as unknown as Record<string, unknown>;
    for (const method of ['getTemplate', 'import', 'initOfficialTemplates']) {
      expect(proto, `死方法 ${method} 应已整删`).not.toHaveProperty(method);
    }
  });

  it('TemplateController 无 getTemplate/import 端点（GET :id / POST :id/import 路由消失）', () => {
    const proto = TemplateController.prototype as unknown as Record<string, unknown>;
    for (const method of ['getTemplate', 'import']) {
      expect(proto, `死端点 ${method} 应已整删`).not.toHaveProperty(method);
    }
  });

  it('template/canvas 模块源码（含 spec 夹具）无 isPublic/templateData 符号', () => {
    const files = [
      ...listTs(join(here, '..')),
      ...listTs(join(here, '../canvas')),
    ].filter((f) => !f.endsWith('template.market-removal.guard.spec.ts')); // 守卫自身职责即命名死符号
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} 含死符号 isPublic/templateData`).not.toMatch(/\b(isPublic|templateData)\b/);
    }
  });

  it('死导入三符号不再被 template.service/canvas.service 引用（import 方法/save 整链删后成死导入）', () => {
    for (const f of [join(here, 'template.service.ts'), join(here, '../canvas/canvas.service.ts')]) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} 含死导入 buildFilteredSnapshot/CLONE_WHITELIST/ensureParentFirst`).not.toMatch(
        /\b(buildFilteredSnapshot|CLONE_WHITELIST|ensureParentFirst)\b/,
      );
    }
  });
});
