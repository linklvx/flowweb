-- Y1a+Y1b T16 spec 评审 P1#1：MediaBinding.targetField CHECK 域放宽——补 referenceVideo/referenceAudio
-- （AddNodeMenu.tsx:247-251/AudioGenNode.tsx:105 上传视频/音频引用经 updateConfig→mergeNodeData 落
--  doc data 单域——词表缺此二键 ⇒ binding 不索引+GC doc 终裁不识别 ⇒ 被引用上传媒体软删 7d 后被硬删）。
-- 域=shared MEDIA_REF_TARGET_FIELDS 九键单源（本 DDL 是其 DB 执法面）。域扩展非收紧：旧值全合法，
-- 旧代码零破坏（additive gate 对 DROP CONSTRAINT 的硬拦按形态豁免——登记面=EXEMPTIONS MediaBinding）。
ALTER TABLE "MediaBinding" DROP CONSTRAINT "media_binding_target_field_domain";
ALTER TABLE "MediaBinding" ADD CONSTRAINT "media_binding_target_field_domain" CHECK ("targetField" IN ('fileId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages', 'trimmedFileId', 'videoFileId', 'audioFileId'));
