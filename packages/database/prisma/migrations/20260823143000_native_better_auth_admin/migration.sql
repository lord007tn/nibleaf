-- Align the existing platform-admin model with Better Auth's native admin
-- plugin. Existing suspensions are carried forward as indefinite bans.
ALTER TABLE "user" ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN "banExpires" TIMESTAMP(3);

UPDATE "user"
SET "banned" = true,
    "banReason" = COALESCE("banReason", 'Suspended by a Nibleaf operator')
WHERE "suspendedAt" IS NOT NULL;
