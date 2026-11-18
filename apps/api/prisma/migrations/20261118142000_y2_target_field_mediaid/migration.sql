-- Y2 B4（spec 第②步 6「约束与写者同一次提交」/裁决 12 段序钉死）：targetField 域收紧 'fileId'→'mediaId'。
-- 段序是唯一正确性载体，不可换序：
--   ① UPDATE 三表存量 'fileId'→'mediaId'（先改值——后段收紧的 CHECK 不容旧值在场）；
--   ② DELETE MediaBinding 三退役键行（trimmedFileId/videoFileId/audioFileId——词表九键收六键，
--      B3 已删 doc 写者；不删则 ③ 收紧在真实 dev 库失败，fresh replay 空库测不出）；
--   ③ 收紧三表 CHECK（NodeArtifact/ArtifactProjection 两键域 mediaId|result；MediaBinding 六键域）；
--   ④ MediaBinding targetField 默认值改 'mediaId'（schema @default 同批）。
-- 迁移与 targetFieldOfKind/collab-media 五处写点/词表/夹具同 commit（spec item 6 机理：中间提交在
-- 开发库直接约束失败——投影器开始产 targetField='mediaId' 行而 CHECK 未收必炸）。

-- ① 存量换值（三表——先改值后收约束）
UPDATE "NodeArtifact" SET "targetField" = 'mediaId' WHERE "targetField" = 'fileId';
UPDATE "ArtifactProjection" SET "targetField" = 'mediaId' WHERE "targetField" = 'fileId';
UPDATE "MediaBinding" SET "targetField" = 'mediaId' WHERE "targetField" = 'fileId';

-- ② 三退役键存量行整删（词表六键域不含——行随键退役）
DELETE FROM "MediaBinding" WHERE "targetField" IN ('trimmedFileId', 'videoFileId', 'audioFileId');

-- ③ 收紧三表 CHECK
ALTER TABLE "NodeArtifact" DROP CONSTRAINT "node_artifact_target_field_domain";
ALTER TABLE "NodeArtifact" ADD CONSTRAINT "node_artifact_target_field_domain" CHECK ("targetField" IN ('mediaId', 'result'));
ALTER TABLE "ArtifactProjection" DROP CONSTRAINT "artifact_projection_target_field_domain";
ALTER TABLE "ArtifactProjection" ADD CONSTRAINT "artifact_projection_target_field_domain" CHECK ("targetField" IN ('mediaId', 'result'));
ALTER TABLE "MediaBinding" DROP CONSTRAINT "media_binding_target_field_domain";
ALTER TABLE "MediaBinding" ADD CONSTRAINT "media_binding_target_field_domain" CHECK ("targetField" IN ('mediaId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages'));

-- ④ MediaBinding 默认值改（schema @default("mediaId") 同批）
ALTER TABLE "MediaBinding" ALTER COLUMN "targetField" SET DEFAULT 'mediaId';
