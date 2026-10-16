export const VIDEO_TRIM_QUEUE = 'video-trim';
export const VIDEO_TRIM_CONNECTION = 'default';
export const MIN_TRIM_DURATION = 0.5;
export const TEMP_DIR = '/tmp/video-trim/';

// Resolve ffmpeg/ffprobe paths: use env override or rely on PATH
// T34（Z79/RC3）：模块级 const 导出（import 期冻结=违规面）改调用期读函数（media-process.service
// 同款；消费点 video-trim.processor spawn 实参/video-trim.service 模板插值同批改道）
export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}
export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}
