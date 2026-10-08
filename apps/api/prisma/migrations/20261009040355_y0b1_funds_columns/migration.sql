-- Y0b-1（三轮 H6）：本迁移的 ADD COLUMN NOT NULL 与 CHECK 只在空表合法——空库前提由
-- 本地 migrate reset（本 Step 6）或服务器 deploy.sh --rebuild-db（T1a Step 10）保证。
-- 守卫只断言不清账（不 DELETE 任何行，非空即中止人工判读）。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "GenerationIntent") OR EXISTS (SELECT 1 FROM "TeamCreditTransaction") THEN
    RAISE EXCEPTION 'Y0b-1 funds migration requires empty ledger tables (空库前提被破坏？见 plan T1b Step 6 reset 形态 / T1a Step 10 REBUILD_DB)';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "GenerationIntent" ADD COLUMN     "creditCost" INTEGER NOT NULL,
ADD COLUMN     "durationId" TEXT,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "pricingRuleId" TEXT,
ADD COLUMN     "resolutionId" TEXT,
ADD COLUMN     "teamId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TeamCreditTransaction" ADD COLUMN     "balanceDelta" INTEGER NOT NULL,
ADD COLUMN     "frozenDelta" INTEGER NOT NULL,
ADD COLUMN     "reversesId" TEXT,
ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "GenerationIntent_teamId_idx" ON "GenerationIntent"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCreditTransaction_reversesId_key" ON "TeamCreditTransaction"("reversesId");

-- AddForeignKey
ALTER TABLE "GenerationIntent" ADD CONSTRAINT "GenerationIntent_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ====== Y0b-1 DB 级不变量（raw——Prisma 不支持 partial index/CHECK） ======
-- 定价自然键真唯一（PG15+ NULLS NOT DISTINCT——kind 级 modelId IS NULL 行同受约束）。
CREATE UNIQUE INDEX "pricing_rule_natural_key" ON "PricingRule"("nodeTypeId", "modelId", "resolutionId", "durationId") NULLS NOT DISTINCT;
-- 余额非负（F5）。
ALTER TABLE "TeamBalance" ADD CONSTRAINT "balance_non_negative" CHECK ("credits" >= 0 AND "subscriptionCredits" >= 0);
-- 定价与意图非负（Z 终裁 CHECK 全家——空库免费）。
ALTER TABLE "PricingRule" ADD CONSTRAINT "pricing_credit_cost_non_negative" CHECK ("creditCost" >= 0);
ALTER TABLE "GenerationIntent" ADD CONSTRAINT "intent_credit_cost_non_negative" CHECK ("creditCost" >= 0 AND "reservedCredits" >= 0 AND "creditsConsumed" >= 0);
ALTER TABLE "TeamMember" ADD CONSTRAINT "member_monthly_non_negative" CHECK ("monthlyUsed" >= 0);
-- 台账 amount 派生强制（Z8）。
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "ledger_amount_derived"
  CHECK ("amount" = CASE WHEN "balanceDelta" <> 0 THEN "balanceDelta" ELSE "frozenDelta" END);
-- 账户域幂等锚（Z9）：money_in 类每事件每池至多一条 + referenceId 必填。
CREATE UNIQUE INDEX "money_in_once" ON "TeamCreditTransaction"("type", "referenceId", "creditType")
  WHERE "type" IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant');
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "money_in_reference_required"
  CHECK ("type" NOT IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant') OR "referenceId" IS NOT NULL);
-- 冻结悬留直查（Z11 性能补偿：生命周期门与第四分支的 reservedCredits>0 扫描）。
CREATE INDEX "generation_intent_frozen_partial" ON "GenerationIntent"("teamId") WHERE "reservedCredits" > 0;
-- 孤儿/不可释放扫描性能（四轮 Z38）：T5 巡检 5min 档扫 type='reserve' 全表的 partial 化。
CREATE INDEX "ledger_reserve_open_partial" ON "TeamCreditTransaction"("createdAt") WHERE type = 'reserve';

-- ====== 定价数据进迁移（Z16+三轮 Z29——主链全家+kind 级：固定 id 常量原样搬自 seed.ts；
-- 定价真源=迁移；seed.ts 对应段 upsert-by-id/key 幂等共存） ======
-- ① 主链 NodeType（seed.ts 同名四键——id 用固定常量）
INSERT INTO "NodeType" ("id", "key", "name", "description", "active", "createdAt", "updatedAt") VALUES
  ('node-type-text', 'text', '文本生成', '文本Prompt输入与优化', true, now(), now()),
  ('node-type-image', 'image', '图片生成', '文生图、图生图', true, now(), now()),
  ('node-type-image-ext', 'imageExt', '图片扩展', '图片扩展节点', true, now(), now()),
  ('node-type-video', 'video', '视频生成', '文生视频、图生视频', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ② kind 级 NodeType（Z5——编辑 4 kind 的 modelId IS NULL 规则载体；multiImageGen 并入 Z31 显式 4xx 不建规则——mock 管线禁定价，四轮 Z37）
INSERT INTO "NodeType" ("id", "key", "name", "active", "createdAt", "updatedAt") VALUES
  ('node-type-outpaint', 'outpaint', '局部重绘（外扩）', true, now(), now()),
  ('node-type-erase', 'erase', '擦除', true, now(), now()),
  ('node-type-redraw', 'redraw', '局部重绘', true, now(), now()),
  ('node-type-lighting', 'lighting', '打光', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ③ AIModel（id=seed 固定常量；apiKey 迁移置 NULL——env 密钥由 seed.ts 补写）
INSERT INTO "AIModel" ("id", "nodeTypeId", "name", "provider", "apiUrl", "apiKey", "sortOrder", "recommended", "active", "createdAt", "updatedAt") VALUES
  ('seed-model-hy-image', 'node-type-image', 'HY-Image-V3.0', '腾讯混元', 'https://tokenhub.tencentmaas.com/v1/api/image', NULL, 0, true, true, now(), now()),
  ('seed-model-sdxl', 'node-type-image', 'Stable Diffusion XL', 'Stability AI', 'https://api.stability.ai/v1/generation', NULL, 1, true, true, now(), now()),
  ('seed-model-dalle', 'node-type-image', 'DALL-E 3', 'OpenAI', 'https://api.openai.com/v1/images/generations', NULL, 2, false, true, now(), now()),
  ('seed-model-gpt4', 'node-type-text', 'GPT-4o', 'OpenAI', 'https://api.openai.com/v1/chat/completions', NULL, 1, true, true, now(), now()),
  ('seed-model-kimi', 'node-type-text', 'Kimi K2.6', 'Moonshot AI', 'https://api.moonshot.cn/v1', NULL, 2, true, true, now(), now()),
  ('seed-model-hy-video', 'node-type-video', 'HY-Video 1.5', 'Tencent Maas', 'https://tokenhub.tencentmaas.com/v1/api/video', NULL, 1, true, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ④ 分辨率/时长（固定 id——resolver 归一化与覆盖度门禁的键集来源；列集以 schema/seed.ts 实测校准）
INSERT INTO "ModelResolution" ("id", "modelId", "label", "width", "height", "createdAt") VALUES
  ('seed-res-hy-1024', 'seed-model-hy-image', '1024×1024', 1024, 1024, now()),
  ('seed-res-hy-2048', 'seed-model-hy-image', '2048×2048', 2048, 2048, now()),
  ('seed-res-hy-512', 'seed-model-hy-image', '512×512', 512, 512, now()),
  ('seed-res-sdxl-1024', 'seed-model-sdxl', '1024×1024', 1024, 1024, now()),
  ('seed-res-sdxl-2048', 'seed-model-sdxl', '2048×2048', 2048, 2048, now()),
  ('seed-res-dalle-1024', 'seed-model-dalle', '1024×1024', 1024, 1024, now()),
  ('seed-res-dalle-512', 'seed-model-dalle', '512×512', 512, 512, now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ModelDuration" ("id", "modelId", "label", "seconds", "createdAt") VALUES
  ('seed-dur-5', 'seed-model-hy-video', '5秒', 5, now()),
  ('seed-dur-10', 'seed-model-hy-video', '10秒', 10, now()),
  ('seed-dur-15', 'seed-model-hy-video', '15秒', 15, now())
ON CONFLICT ("id") DO NOTHING;

-- ⑤ 主链规则（seed.ts 原价目——text (model,null,null)、image (model,res,null)、video (model,null,dur)；价目已与 seed.ts 现值逐条比对一致）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt") VALUES
  ('seed-pricing-gpt4', 'node-type-text', 'seed-model-gpt4', NULL, NULL, 2, true, now(), now()),
  ('seed-pricing-kimi', 'node-type-text', 'seed-model-kimi', NULL, NULL, 2, true, now(), now()),
  ('seed-pricing-sdxl-1024', 'node-type-image', 'seed-model-sdxl', 'seed-res-sdxl-1024', NULL, 3, true, now(), now()),
  ('seed-pricing-sdxl-2048', 'node-type-image', 'seed-model-sdxl', 'seed-res-sdxl-2048', NULL, 6, true, now(), now()),
  ('seed-pricing-dalle-1024', 'node-type-image', 'seed-model-dalle', 'seed-res-dalle-1024', NULL, 5, true, now(), now()),
  ('seed-pricing-dalle-512', 'node-type-image', 'seed-model-dalle', 'seed-res-dalle-512', NULL, 2, true, now(), now()),
  ('seed-pricing-hy-img-512', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-512', NULL, 3, true, now(), now()),
  ('seed-pricing-hy-img-1024', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-1024', NULL, 5, true, now(), now()),
  ('seed-pricing-hy-img-2048', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-2048', NULL, 10, true, now(), now()),
  ('seed-pricing-hy-video-5', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-5', 10, true, now(), now()),
  ('seed-pricing-hy-video-10', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-10', 18, true, now(), now()),
  ('seed-pricing-hy-video-15', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-15', 25, true, now(), now())
ON CONFLICT DO NOTHING;   -- 冲突目标=pricing_rule_natural_key（本文件先建）

-- ⑥ kind 级规则（Z5：modelId IS NULL——编辑 4 kind；承接 CREDIT_COST_PER_EDIT 旧值 1；multiImageGen 不建——Z37）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt")
SELECT 'seed-pricing-kind-' || k."key", k."id", NULL, NULL, NULL, 1, true, now(), now()
FROM "NodeType" k WHERE k."key" IN ('outpaint','erase','redraw','lighting')
ON CONFLICT DO NOTHING;
