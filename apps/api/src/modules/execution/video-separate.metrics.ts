export function registerVideoSeparateMetrics(registry?: any) {
  // Metrics are registered lazily via service. This module provides
  // the metric definitions used by VideoSeparateProcessor for
  // media_separate_duration_seconds, media_separate_total, etc.
  // Integration with existing Prometheus setup is deferred
  // until the project standardizes its metrics collection pattern.
}
