import { cpus } from 'node:os';

const CPU_CORES = cpus().length;

export const QUEUE_NAMES = {
  EXECUTION: 'execution',
  VIDEO_TRIM: 'video-trim',
  VIDEO_SEPARATE: 'video-separate',
  AI_IMAGE_EDIT: 'ai-image-edit',
  // T12：AI_DOWNLOAD（ai-result-download）退役——video materialize 归 MaterializeJob DB poller
  THUMBNAIL_GENERATOR: 'thumbnail-generator',
  TEMP_CLEANUP: 'temp-file-cleanup',
  BANNER_CLEANUP: 'banner-cleanup',
  SUBSCRIPTION_CLOSE_EXPIRED: 'subscription-close-expired',
  SUBSCRIPTION_PAYMENT_SUCCESS: 'subscription-payment-success',
  SUBSCRIPTION_DAILY_RECON: 'subscription-daily-recon',
} as const;

export const QUEUE_CONCURRENCY = {
  DEFAULT: CPU_CORES,
  VIDEO_SEPARATE: Math.max(1, Math.floor(CPU_CORES)),
  VIDEO_TRIM: Math.max(1, Math.floor(CPU_CORES * 0.7)),
} as const;
