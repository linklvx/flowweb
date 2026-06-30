export const VIDEO_TRIM_QUEUE = 'video-trim';
export const VIDEO_TRIM_CONNECTION = 'default';
export const MIN_TRIM_DURATION = 0.5;
export const TEMP_DIR = '/tmp/video-trim/';

// Resolve ffmpeg/ffprobe paths: use env override or rely on PATH
export const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
