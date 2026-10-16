// apps/api/src/modules/collab/collab.module.spec.ts
// Y0c T34（Z45③）：COLLAB_* 装配惰性化结构锚——useValue（模块加载期求值，先于 dotenv→
// validateEnv 写回=Z79 违规面）⇒ useFactory（DI 解析期=NestFactory.create 时求值，恒在
// main.ts validateEnv 之后⇒写回等价成立）。取值行为等价（同值解析）由 di-smoke int 承担；
// 本 spec 钉死求值时序形态（源码结构断言——worker.module.spec/偏离 46 case C 同款先例）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'collab.module.ts'), 'utf8');

describe('T34（Z45③）：COLLAB_PORT/COLLAB_DEBOUNCE/COLLAB_TIMEOUT 装配 useFactory 惰性化', () => {
  it('三 token 均 useFactory（useValue+直读形态=import 期求值 ⇒ 红）', () => {
    expect(src).toMatch(/provide: 'COLLAB_PORT', useFactory: \(\) => Number\(process\.env\.COLLAB_PORT\) \|\| 3001/);
    expect(src).toMatch(/provide: 'COLLAB_DEBOUNCE', useFactory: \(\) => resolveCollabDebounce\(\)/);
    expect(src).toMatch(/provide: 'COLLAB_TIMEOUT', useFactory: \(\) => Number\(process\.env\.COLLAB_TIMEOUT\) \|\| 30_000/);
  });

  it('providers 段 useValue+process.env / useValue+resolveCollabDebounce 直读形态零残留（Z79 违规面）', () => {
    expect(src).not.toMatch(/useValue:[^\n]*process\.env/);
    expect(src).not.toMatch(/useValue: resolveCollabDebounce/);
  });
});
