-- AI & integrations PR 2 (operations/ux/ai-and-integrations.md, decision D7):
-- the last four characters of a site's own AI key, and when that key was
-- added, so the owner can tell which key is in use without the key ever being
-- returned. Expand-only: nullable columns the previous release neither reads
-- nor writes.
-- AlterTable
ALTER TABLE "project_integration" ADD COLUMN     "credentialHint" TEXT,
ADD COLUMN     "credentialAddedAt" TIMESTAMP(3);
