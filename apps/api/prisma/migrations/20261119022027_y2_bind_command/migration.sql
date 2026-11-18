-- Y2 D1t（spec v2.13 §3 D5 第⑤条「新行字段」）：Media 三幂等列迁移②——跨团队粘贴占坑先行的幂等元组。
-- bindCommandId/bindSourceMediaId/bindTargetProjectId 全可空（普通上传行恒 NULL——PG 多 NULL 相容，
-- 唯一约束不互撞）；@@unique([teamId, bindCommandId]) =幂等查锚（同一命令并发/重试按槽上 id 分诊）。
-- 三列只服务幂等比对（D2t 应用层分诊 BIND_COMMAND_MISMATCH），不复用 projectId、非血缘——additive 无破坏：
-- 纯 ADD COLUMN+CREATE UNIQUE INDEX，零存量改写、零约束收紧（check-migration-additive 应零豁免登记）。

-- ① ADD COLUMN——三幂等列可空（无回填依赖：现有行非粘贴命令产物，NULL=不进幂等域）
ALTER TABLE "Media" ADD COLUMN "bindCommandId" TEXT;
ALTER TABLE "Media" ADD COLUMN "bindSourceMediaId" TEXT;
ALTER TABLE "Media" ADD COLUMN "bindTargetProjectId" TEXT;

-- ② 幂等唯一索引（Prisma @@unique([teamId, bindCommandId]) 对应——索引名=Prisma 惯例 <Model>_<cols>_key）
CREATE UNIQUE INDEX "Media_teamId_bindCommandId_key" ON "Media"("teamId", "bindCommandId");
