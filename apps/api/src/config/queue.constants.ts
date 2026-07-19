const CPU_CORES = require('os').cpus().length;

export const QUEUE_NAMES = {
  EXECUTION: 'execution',
  VIDEO_TRIM: 'video-trim',
  VIDEO_SEPARATE: 'video-separate',
  AI_IMAGE_EDIT: 'ai-image-edit',
  AI_DOWNLOAD: 'ai-result-download',
  THUMBNAIL_GENERATOR: 'thumbnail-generator',
  TEMP_CLEANUP: 'temp-file-cleanup',
  BANNER_CLEANUP: 'banner-cleanup',
} as const;

export const QUEUE_CONCURRENCY = {
  DEFAULT: CPU_CORES,
  VIDEO_SEPARATE: Math.max(1, Math.floor(CPU_CORES)),
  VIDEO_TRIM: Math.max(1, Math.floor(CPU_CORES * 0.7)),
} as const;
