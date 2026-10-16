// apps/api/src/modules/execution/video-trim.constants.spec.ts
// Y0c T34（Z79/RC3）：FFMPEG_PATH/FFPROBE_PATH 惰性化——模块级 const 导出（import 期冻结，
// 先于 dotenv→validateEnv 写回=Z79 违规面）改函数导出（调用期读；消费点 video-trim.processor
// spawn 实参/video-trim.service 模板插值同批改道）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ffmpegPath, ffprobePath } from './video-trim.constants';

afterEach(() => { vi.unstubAllEnvs(); });

describe('T34：ffmpegPath()/ffprobePath() 惰性求值（旧 const 导出=具名导出缺失即红）', () => {
  it('stubEnv 即改即读；未设/空串回落 PATH 裸命令名（B13 空串=未设）', () => {
    vi.stubEnv('FFMPEG_PATH', '/opt/ffmpeg');
    vi.stubEnv('FFPROBE_PATH', '/opt/ffprobe');
    expect(ffmpegPath()).toBe('/opt/ffmpeg');
    expect(ffprobePath()).toBe('/opt/ffprobe');
    vi.stubEnv('FFMPEG_PATH', '');
    vi.stubEnv('FFPROBE_PATH', '');
    expect(ffmpegPath()).toBe('ffmpeg');
    expect(ffprobePath()).toBe('ffprobe');
  });
});
