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

/**
 * Generate unique recharge order number: RC + date(8) + user hash(4) + random(6)
 * Format: RC + 20260723 + XXXX + 123456 = 20 characters
 */
export function generateRechargeOrderNo(userId: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  const userHash = userId.slice(0, 4).toUpperCase();
  return `RC${date}${userHash}${random}`;
}
