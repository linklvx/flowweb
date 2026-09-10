// shared 包无 exports 字段，子路径 '@flowweb/shared/types/video-project' 不可解析（TS2307 实证）；
// 既有惯例是 barrel 导出（packages/shared/src/index.ts），故经 barrel re-export。
export * from '@flowweb/shared';
