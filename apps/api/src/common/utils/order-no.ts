/**
 * Generate unique subscription order number: SUB + UTC milliseconds (13 digits) + 6 random digits
 * Format: SUB + 13 + 6 = 22 characters
 */
export function generateOrderNo(): string {
  const ts = Date.now().toString();
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  return `SUB${ts}${random}`;
}
