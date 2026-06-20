-- CreateEnum
CREATE TYPE "TextDirection" AS ENUM ('LTR', 'RTL');

-- DropIndex
DROP INDEX "page_projectId_path_idx";

-- AlterTable
ALTER TABLE "page" ADD COLUMN     "languageId" TEXT;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "config" JSONB,
ADD COLUMN     "icon" TEXT;

-- CreateTable
CREATE TABLE "language" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "direction" "TextDirection" NOT NULL DEFAULT 'LTR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "language_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "language_projectId_idx" ON "language"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "language_projectId_code_key" ON "language"("projectId", "code");

-- CreateIndex
CREATE INDEX "page_projectId_languageId_path_idx" ON "page"("projectId", "languageId", "path");

-- CreateIndex
CREATE INDEX "page_languageId_idx" ON "page"("languageId");

-- AddForeignKey
ALTER TABLE "language" ADD CONSTRAINT "language_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing project gets a default English (LTR) language, and
-- all of its existing pages are attached to that language. Deterministic ids
-- ('lang_' || project id) keep the backfill idempotent and FK-valid.
INSERT INTO "language" ("id", "projectId", "code", "label", "direction", "isDefault", "position", "createdAt", "updatedAt")
SELECT 'lang_' || "id", "id", 'en', 'English', 'LTR', true, 0, now(), now()
FROM "project";

UPDATE "page" SET "languageId" = 'lang_' || "projectId"
WHERE "languageId" IS NULL;
