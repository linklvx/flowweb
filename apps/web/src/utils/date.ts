/**
 * Format seconds as mm:ss string.
 * Example: formatDuration(65) → "01:05"
 * Example: formatDuration(0) → "00:00"
 * Example: formatDuration(3661) → "61:01"
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
