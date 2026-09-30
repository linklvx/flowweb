import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

// ── 扫描纯函数（可单测——假绿/假红洞的自证入口）──
// v5：两桶统一内容标识 string[]（'rel|param: type'）——原 dtoNoPipe 是 Record<rel, count>+#i 序号编码，
// "同文件修好一个+变坏一个"时计数不变恒绿；改内容标识后新增端点必产新 tuple 红。
// 已知盲区登记：Set 去重使"同文件同参名同类型的重复违规"数量不可见（inline 桶 v4 起同款——出现概率极低，登记不修）。
export interface BodyScanResult { inline: string[]; dtoNoPipe: string[] }

export function scanBodyParams(sources: Record<string, string>): BodyScanResult {
  const inline: string[] = [];
  const dtoNoPipe: string[] = [];
  for (const [rel, src] of Object.entries(sources)) {
    // 方法块切分：HTTP 动词装饰器起，到下一个动词装饰器或文件尾
    const blocks = src.split(/(?=@(?:Post|Get|Put|Patch|Delete)\()/);
    // v3/v5：类级 pipe 检测——第一个动词装饰器之前的前导块 = 类声明区（类级 @UsePipes 在这里）。
    // 前提修正（v5）：类装饰器在 TS 语法上必位于 class 声明前（不可能在类体后），blocks[0] 覆盖是结构保证；
    // 多行类级装饰器 \s* 跨行可匹配，非盲区。真漏判形态仅：字符串/注释含动词装饰器字面量（如文档示例）
    // 导致切分错位——此时方法块滑进前导块，dtoNoPipe 内容变化 → 门禁红 → 现场先查此处。
    const hasClassPipe = /UsePipes\(\s*new\s*ValidationPipe/.test(blocks[0] ?? '');
    for (const block of blocks) {
      const m = block.match(/@Body\(\)\s+(\w+):\s*([^,)=\n]+)/);
      if (!m) continue;
      const type = m[2].trim().replace(/\s+/g, ' ');
      // v3：数组后缀（SettingEntry[]）与联合类型归 inline；Partial</{/[/any 同
      const isInline = type === 'any' || /^(\{|\[|Partial<)/.test(type) || /\[\]$/.test(type) || type.includes('|');
      if (isInline) {
        inline.push(`${rel}|${m[1]}: ${type}`);
      } else if (/^[A-Z]/.test(type)
          && !hasClassPipe                                  // v3：类级 pipe 覆盖全文件方法
          && !/UsePipes\(\s*new\s*ValidationPipe/.test(block)) { // 方法块内 pipe
        dtoNoPipe.push(`${rel}|${m[1]}: ${type}`);
      }
    }
  }
  return { inline, dtoNoPipe };
}

const SRC = path.resolve(process.cwd(), 'src');  // pnpm --filter 的 cwd 恒为包根（__dirname 在 API spec 无先例不赌）

function collectSources(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.controller.ts')) {
        out[path.relative(SRC, p).split(path.sep).join('/')] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(SRC);
  return out;
}

/** 棘轮基线（Step 2 现场扫描生成后固化）：新端点要求 @Body() 用 DTO class 且有 pipe 保护（方法级或类级）。
 *  v4/v5：扁平字符串集合（'rel|param: type'）+ 两桶统一内容标识；只查增长（合法清理不逼改基线）。
 *  v5 表述修正：v4 声称"文件改名自动免疫"不准——rel 段变化时该文件 tuple 全量更新 → 门禁红 →
 *  属"搬运=重审"语义（人工确认后更新基线），非自动免疫；比 Record 按路径索引的"整份清单假红"仍显著收敛。 */
const INLINE_BASELINE = new Set<string>([
  /* 按 Step 2 扫描输出固化：'src/modules/.../x.controller.ts|body: any' 形态（现场 39 条，多行类型字面量截断为 '{'/'Partial<{' 属正则已知形态） */
  'auth/auth.controller.ts|body: { email: string; password: string }',
  'auth/auth.controller.ts|body: { email: string; password: string; name: string }',
  'modules/admin/model/model.controller.ts|body: any',
  'modules/admin/model/model.controller.ts|body: { label: string; width: number; height: number }',
  'modules/admin/model/model.controller.ts|body: { label: string; seconds: number }',
  'modules/admin/node-type/node-type.controller.ts|body: { name: string; key: string; description?: string }',
  'modules/admin/node-type/node-type.controller.ts|body: { name?: string; description?: string; active?: boolean }',
  'modules/admin/pricing/pricing.controller.ts|body: any',
  'modules/admin/pricing/pricing.controller.ts|body: { rules: any[] }',
  'modules/admin/settings/settings.controller.ts|entries: SettingEntry[]',
  'modules/ai-image-edit/ai-image-edit.controller.ts|body: {',
  /* 批0.5-8：erase/redraw 增 intentId?: string（幂等键透传）——内容标识更新，条数不增（棘轮"搬运=重审"语义） */
  'modules/ai-image-edit/ai-image-edit.controller.ts|body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; intentId?: string }',
  'modules/ai-image-edit/ai-image-edit.controller.ts|body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; prompt: string; strength: number; intentId?: string }',
  'modules/execution/execution.controller.ts|body: { projectId: string; nodeId?: string; nodeIds?: string[] }',
  'modules/execution/execution.controller.ts|body: { projectId: string; nodeId?: string; intentId?: string }',
  'modules/execution/video-separate.controller.ts|dto: { fileId: string; nodeId: string; mode: string }',
  'modules/execution/video-trim.controller.ts|body: { fileId: string; startTime: number; endTime: number; nodeId: string }',
  'modules/project/project.controller.ts|body: { name?: string; teamId?: string }',
  'modules/project/project.controller.ts|body: { name: string }',
  'modules/styles/styles.controller.ts|dto: { favorited: boolean }',
  'modules/subscription/admin/admin-subscription.controller.ts|body: any',
  'modules/subscription/admin/admin-subscription.controller.ts|body: { userId: string; amount: number; creditType: string }',
  'modules/subscription/subscription-order.controller.ts|body: { planId: string; period: string; type: string }',
  'modules/team/admin-team-plan.controller.ts|body: {',
  'modules/team/admin-team-plan.controller.ts|body: Partial<{',
  'modules/team/project-member.controller.ts|body: { userId: string; role: GrantRole }',
  'modules/team/project-member.controller.ts|body: { role: GrantRole }',
  'modules/team/team.controller.ts|body: { name: string }',
  'modules/team/team.controller.ts|body: { role: \'ADMIN\' | \'MEMBER\' }',
  'modules/team/team.controller.ts|body: { monthlyQuota: number }',
  'modules/team/team.controller.ts|body: { message?: string }',
  'modules/team/team.controller.ts|body: { amount: number }',
  'modules/team/team.controller.ts|body: { planId: string }',
  'modules/team/team.controller.ts|body: { targetUserId: string }',
]);
const DTO_NO_PIPE_BASELINE = new Set<string>([
  /* v5：内容标识回填（'src/modules/.../x.controller.ts|dto: XDto' 形态——现场 6 条：storage×2/lighting/admin-banner + auth×2，个位数符合预期）；
     v2 预告的"4 个"是在漏检数组+类级回退的扫描器下得出的，以现场为准 */
  'auth/auth.controller.ts|dto: SendSmsCodeDto',
  'auth/auth.controller.ts|dto: PhoneLoginDto',
  'modules/ai-image-edit/lighting/lighting.controller.ts|body: CreateLightingTaskDto',
  'modules/storage/storage.controller.ts|body: PresignUploadDto',
  'modules/storage/storage.controller.ts|body: ConfirmUploadDto',
  'modules/subscription/admin/admin-banner.controller.ts|dto: UpdateBannerDto',
]);

describe('@Body() 棘轮门禁（R0d②，v3 三修）', () => {
  it('自证①：文件有方法级 pipe 但另一方法块无 → 判违规（文件级判定的假绿洞）', () => {
    const fake = {
      'fake.controller.ts': [
        "@Controller('x')",
        '@Post("a") @UsePipes(new ValidationPipe({ whitelist: true })) m1(@Body() d: ADto) {}',
        '@Post("b") m2(@Body() d: ADto) {}',
      ].join(String.fromCharCode(10)),   // v5：'\n' 字面量经传输层会被折叠成真换行（parse 错）——fromCharCode 抗折叠
    };
    const out = scanBodyParams(fake);
    expect(out.dtoNoPipe).toEqual(['fake.controller.ts|d: ADto']);
  });

  it('自证②：类级 pipe + 方法无方法级 pipe → 合规（v3——admin-video-work 形态，29 端点误报洞）', () => {
    const fake = {
      'fake-class.controller.ts': [
        "@Controller('y') @UsePipes(new ValidationPipe({ whitelist: true }))",
        'export class Y {',
        '  @Post() m(@Body() d: ADto) {}',
        '}',
      ].join(String.fromCharCode(10)),
    };
    const out = scanBodyParams(fake);
    expect(out.dtoNoPipe).toHaveLength(0);
  });

  it('自证③：inline/any/Partial/数组/联合类型全归 inline 桶（数组漏检洞）', () => {
    const fake = {
      'fake2.controller.ts': [
        '@Post() a(@Body() body: any) {}',
        '@Post() b(@Body() body: { name: string }) {}',
        '@Post() c(@Body() entries: SettingEntry[]) {}',
        '@Post() d(@Body() body: Partial<{ x: number }>) {}',
        '@Post() e(@Body() body: string | number) {}',
      ].join(String.fromCharCode(10)),
    };
    const out = scanBodyParams(fake);
    expect(out.inline).toHaveLength(5);
    expect(out.dtoNoPipe).toHaveLength(0);
  });

  it('自证④：扫描面非空（防 cwd 错位→空集→门禁恒绿）', () => {
    const sources = collectSources();
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(Object.keys(sources).some((f) => f.includes('storyboard'))).toBe(true);
  });

  it('生产源码：inline/any 不新增（内容标识基线只查增长，v5）', () => {
    const { inline } = scanBodyParams(collectSources());
    const grown = inline.filter((e) => !INLINE_BASELINE.has(e));
    expect(grown).toEqual([]);
  });

  it('生产源码：DTO-class-无-pipe 端点不新增（内容标识基线只查增长，v5）', () => {
    const { dtoNoPipe } = scanBodyParams(collectSources());
    const grown = dtoNoPipe.filter((e) => !DTO_NO_PIPE_BASELINE.has(e));
    expect(grown).toEqual([]);
  });
});
