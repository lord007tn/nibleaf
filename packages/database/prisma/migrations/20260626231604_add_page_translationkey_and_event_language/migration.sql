-- AlterTable
ALTER TABLE "analytics_event" ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "page" ADD COLUMN     "translationKey" TEXT;

-- CreateIndex
CREATE INDEX "page_projectId_translationKey_idx" ON "page"("projectId", "translationKey");
