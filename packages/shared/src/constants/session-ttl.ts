/**
 * Y5 T5（plan 约束⑦）：会话 7 天 TTL 单源（毫秒）——三处消费必须同步：
 * api auth.ts cookie maxAge（毫秒）、auth.ts better-auth session.expiresIn（**秒**——此值须 / 1000）、
 * session.service.ts 滑动续期（毫秒）。改值只动此处。
 */
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
