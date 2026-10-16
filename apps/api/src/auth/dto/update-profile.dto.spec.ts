// apps/api/src/auth/dto/update-profile.dto.spec.ts
// Y0c T34（Z79/RC3+Z45⑤前半）：头像 URL 校验惰性化——装饰器实参（@IsUrl options/@Matches regex）
// 在类定义期（模块加载期）求值=NODE_ENV 冻结在 import 时点（vitest 下恒 test⇒dev 档），
// 先于 dotenv→validateEnv 写回=Z79 违规面。改自定义 ValidatorConstraint（class-validator 原生
// 形态）——validate() 调用期读 NODE_ENV。语义保持现档二分（T35 COOKIE_SECURE 三态 resolver
// 单点化的挂载面，本任务不引入新三态逻辑——RC7 边界）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

afterEach(() => { vi.unstubAllEnvs(); });

function imageErrors(image: string): string[] {
  const dto = new UpdateProfileDto();
  dto.image = image;
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('T34：update-profile.dto 头像 URL 校验期读 NODE_ENV（惰性——同模块随 env 切档）', () => {
  it('production 档（import 后 stub）：https 白名单域过/http 拒/非白名单域拒/localhost 拒（require_tld 生效）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(imageErrors('https://cdn.flowai.dev/a.png')).toEqual([]);
    expect(imageErrors('https://x.flowai.dev/a.png')).toEqual([]);
    expect(imageErrors('http://cdn.flowai.dev/a.png').length).toBeGreaterThan(0);
    expect(imageErrors('https://evil.com/a.png').length).toBeGreaterThan(0);
    expect(imageErrors('https://localhost/a.png').length).toBeGreaterThan(0);
  });

  it('development 档（import 后 stub）：localhost http 过/远端 https 白名单域拒——旧实现冻结 import 时点档 ⇒ 红', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(imageErrors('http://localhost:5173/a.png')).toEqual([]);
    expect(imageErrors('http://127.0.0.1/a.png')).toEqual([]);
    expect(imageErrors('https://cdn.flowai.dev/a.png').length).toBeGreaterThan(0);
  });

  it('image 未设 ⇒ IsOptional 跳过（既有面保持）；name 校验不受影响', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(validateSync(new UpdateProfileDto())).toEqual([]);
    const dto = new UpdateProfileDto();
    dto.name = 'ok name';
    expect(validateSync(dto)).toEqual([]);
    const bad = new UpdateProfileDto();
    bad.name = 'bad$name';
    expect(validateSync(bad).length).toBeGreaterThan(0);
  });
});
