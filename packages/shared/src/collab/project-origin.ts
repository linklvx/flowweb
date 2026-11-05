// packages/shared/src/collab/project-origin.ts
// C2-0（plan Task C2-0——生产就绪收尾批）：CanvasProject.origin 值域单源（谱系列）。
// spec v5 零 origin 文字（值域未在 spec 定）——值出 plan v3.1 两处：'user'（用户创建——
// ensureProjectGovernance 两路径写〔ProjectService.create/CanvasService.create〕）+'clone'
//（VideoWorkCloneService.clone 谱系——C4 接线）。C4 cleanDrafts 判据
// `(origin IS NULL OR origin='user')`∧无 Template∧24h——clone 不删；存量行 origin=NULL
// 语义等同 'user'（判据同列，不回填）。词表形态承 retention.ts COLLAB_JOB_CURSOR_JOBS
// 先例（值域随批增列登记）。写点单源=apps/api collab/project-governance.service.ts
// ensureProjectGovernance（创建路径禁旁路直写 origin）。

/** 用户创建（两创建路径经 ensureProjectGovernance 写入）。 */
export const CANVAS_PROJECT_ORIGIN_USER = 'user' as const;

/** clone 谱系（VideoWorkCloneService——C4 接线，本批只登记值域）。 */
export const CANVAS_PROJECT_ORIGIN_CLONE = 'clone' as const;

export const CANVAS_PROJECT_ORIGINS = [CANVAS_PROJECT_ORIGIN_USER, CANVAS_PROJECT_ORIGIN_CLONE] as const;
export type CanvasProjectOrigin = (typeof CANVAS_PROJECT_ORIGINS)[number];
