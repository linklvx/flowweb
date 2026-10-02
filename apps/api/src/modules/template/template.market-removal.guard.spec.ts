import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';

// Spec B M0-1/M0-2 删除锚（拍板 a1 净删）：模板市场 api+web 面符号级不存在守卫。
// 四面覆盖：schema 列+枚举（DMMF）/TS 类型+方法（prototype）/端点（controller 原型）/夹具+死导入（源码 grep）。
// M0-2 增补 web 面（TemplatePreviewPage/TemplateMarketPage/saveCanvas/isPublic +
// /templates 路由与 /works/:id 路由文本断言，apps/web/src + packages/*/src 扫描域）。

const here = __dirname;
// api 包内 template 模块 → 仓根（template→modules→src→api→apps→根 共五级）
const webSrcRoot = join(here, '../../../../web/src');
const sharedPkgsRoot = join(here, '../../../../../packages');

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
    // 收窄（M0-1 质评 Important#1 裁决）：扫描域=守卫所在 template 模块+canvas 模块，不再递归全 modules 树
    const files = [
      ...listTs(here),
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

describe('M0-2 web 链删除锚（a1 净删——web 面+夹具+死码）', () => {
  function listWebTs(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...listWebTs(p));
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('schema 四死列扩容已 drop：Template 模型无 coverUrl/dataUrl/importCount/category', () => {
    const fields = Prisma.dmmf.datamodel.models
      .find((m) => m.name === 'Template')!
      .fields.map((f) => f.name);
    for (const col of ['coverUrl', 'dataUrl', 'importCount', 'category']) {
      expect(fields, `死列 ${col} 应已 drop`).not.toContain(col);
    }
  });

  it('schema 两枚举已 DROP TYPE：无 TemplateStatus/TemplateCategory', () => {
    const enums = Prisma.dmmf.datamodel.enums.map((e) => e.name);
    for (const en of ['TemplateStatus', 'TemplateCategory']) {
      expect(enums, `死枚举 ${en} 应已 DROP TYPE`).not.toContain(en);
    }
  });

  it('web 全树符号级不存在：isPublic/templateData/TemplateData/saveCanvas/市场两页两卡/save 对话框/getTemplate/importTemplate', () => {
    // 扫描域=apps/web/src + packages/shared/src（守卫声明面；shared 已零残留，入面防复活）
    const files = [
      ...listWebTs(webSrcRoot),
      ...listWebTs(join(sharedPkgsRoot, 'shared/src')),
    ];
    expect(files.length).toBeGreaterThan(200); // 扫描面非空自证
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} 含 M0 web 死符号`).not.toMatch(
        /\b(isPublic|templateData|TemplateData|saveCanvas|TemplateMarketPage|TemplateCard|TemplatePreviewPage|SaveAsTemplateDialog|getTemplate|importTemplate)\b/,
      );
    }
  });

  it('router 无 /templates 市场路由与 /works/:id 预览路由（文本级断言——404 由路由表缺席保证）', () => {
    const src = readFileSync(join(webSrcRoot, 'router.tsx'), 'utf8');
    expect(src, 'router 含 /templates 市场路由').not.toMatch(/['"]\/templates(?:\/:id)?['"]/);
    expect(src, 'router 含 /works/:id 预览路由').not.toMatch(/['"]\/works\/:id['"]/);
  });

  it('web 全树无 /works/${} 模板串跳转（/works/:id 死跳转形态——WorkspaceDimension else 分支同批收口后盲区补钉）', () => {
    // 扫描域=apps/web/src 全树（守卫在 api，无需自排除/无需 *.test.* 排除——与上一条 web 扫描同款手法）
    const files = listWebTs(webSrcRoot);
    expect(files.length).toBeGreaterThan(100); // 扫描面非空自证
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} 含 /works/\${} 模板串死跳转`).not.toContain('/works/${');
    }
  });

  it('loginRedirect 白名单无 /templates 行（市场跳转收口）', () => {
    const src = readFileSync(join(webSrcRoot, 'utils/loginRedirect.ts'), 'utf8');
    expect(src, 'loginRedirect 白名单含 /templates').not.toMatch(/['"]\/templates['"]/);
  });

  it('死码 backfill-team.ts 已整删（引用已 DROP 的 CanvasNode/CanvasEdge）', () => {
    let exists = true;
    try {
      readFileSync(join(here, '../../../scripts/backfill-team.ts'), 'utf8');
    } catch {
      exists = false;
    }
    expect(exists, 'apps/api/scripts/backfill-team.ts 应已整删').toBe(false);
  });
});
