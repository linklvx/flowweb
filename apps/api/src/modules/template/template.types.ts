// M0-2：TemplateData 接口整删（快照面已由 Y.Doc CanvasDoc 承载，Prisma 同名列已 drop）。
// TemplateListResponse 为既有死类型（全仓零 import）——不属本批处置面，保留待后续清算。
export interface TemplateListResponse {
  templates: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
