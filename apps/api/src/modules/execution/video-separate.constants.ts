export const VIDEO_SEPARATE_QUEUE = 'video-separate';
export const VIDEO_SEPARATE_CONNECTION = 'default';
export const TEMP_SEPARATE_DIR = '/tmp/video-separate/';
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
export const MAX_TASK_DURATION_MS = 5 * 60 * 1000; // 5min
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10min
export const DOWNLOAD_RETRIES = 1;
export const USER_CONCURRENT_LIMIT = 3;
export const PRESIGNED_URL_EXPIRY = 1800; // 30min
export const IDEMPOTENCY_LOCK_TTL = 3; // 3s
export const COUNTER_TTL = 86400; // 24h — 覆盖极端排队场景，配合每日 cron 校准兜底

export const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
];

export const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

// 音频产物常量：统一收口，后续更换格式（如 mp3）只需修改此处
export const AUDIO_OUTPUT_EXT = 'm4a';
export const AUDIO_OUTPUT_MIME = 'audio/mp4';
