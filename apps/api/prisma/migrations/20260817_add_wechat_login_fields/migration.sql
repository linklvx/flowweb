ALTER TABLE "User" ADD COLUMN "wechatOpenid" VARCHAR(64);
ALTER TABLE "User" ADD COLUMN "wechatUnionid" VARCHAR(64);
CREATE UNIQUE INDEX "User_wechatOpenid_key" ON "User"("wechatOpenid");
