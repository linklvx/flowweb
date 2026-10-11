-- Y0b-4 T9a（Q-U v6）：CanvasDoc 代际两列——vacuum 文档代际替换
-- generation=真空代数（vacuum ⑥ 单事务 n+1；装载播种 docGeneration Map→doc-status generation 产生）
-- preVacuumSv=真空前 stateVector（beforeSync SyncStep1 SV 重叠检测代际门 DB 权威源——重启不失效）
ALTER TABLE "CanvasDoc" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preVacuumSv" BYTEA;
