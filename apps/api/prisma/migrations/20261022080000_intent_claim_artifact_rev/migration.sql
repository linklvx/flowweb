-- T13 评审 Important#1：claim 时捕获的槽位 rev 持久化（R3 finalizeFromStage 的 expectedRev 重建源
-- ——悬留窗 replace 后失配=superseded 不覆盖用户值；替代「现读 claimCapture」的击穿面）
ALTER TABLE "GenerationIntent" ADD COLUMN "claimArtifactRev" INTEGER;
