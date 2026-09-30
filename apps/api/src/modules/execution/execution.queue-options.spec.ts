import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXECUTION_JOB_OPTIONS } from './execution.queue-options';
import { AI_IMAGE_EDIT_JOB_OPTIONS } from '../ai-image-edit/ai-image-edit.queue-options';

/** 批0c-7 必红：两付费队列今天继承全局 defaultJobOptions attempts:3——processor 内扣费后抛错
 *  会自动重试再扣（重复扣费今天就在发生）。接线断言用源码文本匹配（esbuild 不发射 decorator
 *  metadata，registerQueue 装饰器参数无法运行时断言；cwd=包根）。 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('队列重试配置（批0c：全局 attempts:3 继承链=重试重复扣费）', () => {
  it('execution 与 ai-image-edit 两队列 attempts===1', () => {
    expect(EXECUTION_JOB_OPTIONS.attempts).toBe(1);
    expect(AI_IMAGE_EDIT_JOB_OPTIONS.attempts).toBe(1);
  });

  it('execution.module registerQueue 接线 EXECUTION_JOB_OPTIONS', () => {
    const s = src('src/modules/execution/execution.module.ts');
    expect(s).toContain('EXECUTION_JOB_OPTIONS');
    expect(s).toContain('defaultJobOptions: { ...EXECUTION_JOB_OPTIONS }');
  });

  it('ai-image-edit.module registerQueue 接线 AI_IMAGE_EDIT_JOB_OPTIONS', () => {
    const s = src('src/modules/ai-image-edit/ai-image-edit.module.ts');
    expect(s).toContain('AI_IMAGE_EDIT_JOB_OPTIONS');
    expect(s).toContain('defaultJobOptions: { ...AI_IMAGE_EDIT_JOB_OPTIONS }');
  });

  it('app.module Bull connection maxRetriesPerRequest:null（BullMQ 阻塞式连接要求）', () => {
    expect(src('src/app.module.ts')).toContain('maxRetriesPerRequest: null');
  });
});
