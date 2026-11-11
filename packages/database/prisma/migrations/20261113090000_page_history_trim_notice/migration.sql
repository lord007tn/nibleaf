-- #492: a page restored from Trash records when its history was trimmed to fit
-- the payload cap, so the History panel can say so. Expand-only: a nullable
-- column the previous release neither reads nor writes.
-- AlterTable
ALTER TABLE "page" ADD COLUMN     "historyTrimmedFromTrash" JSONB;

