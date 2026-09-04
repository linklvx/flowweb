export type Role = 'USER' | 'ADMIN';
export const isAdmin = (role: unknown): role is 'ADMIN' => role === 'ADMIN';
