ALTER TABLE "User" ADD COLUMN "phoneNumber" VARCHAR(20);
ALTER TABLE "User" ADD COLUMN "phoneNumberVerified" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
