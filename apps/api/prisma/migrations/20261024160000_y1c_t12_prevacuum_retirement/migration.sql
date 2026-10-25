-- Y1c T12（偏离 27/D2——vacuum=generation++/新 docName(#g) 换代通道）：preVacuumSv 列退役。
-- SV 代际门（guardSyncFrame SyncStep1 preVacuumSv 分支）结构性放行洞（S2 Phase C/D：Update 帧路径
-- 绕过 SV 门+形态②〔全 clock<pre〕恒放行）——世代执法改道 docName 世代段 auth/load 双校验
-- （admitDocNameForGeneration——CanvasDoc.generation PG 列真值）。T11 迁移 20261024150000 既定
-- 「preVacuumSv 列退役归 T12（本批勿动）」本批兑现；dev 无存量数据（reset runbook 全表部署）。
ALTER TABLE "CanvasDoc" DROP COLUMN "preVacuumSv";
