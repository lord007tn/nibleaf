-- AI & integrations PR 2 (operations/ux/ai-and-integrations.md, decision D7):
-- the last four characters of a site's own AI key, so the owner can tell which
-- key is in use without the key ever being returned. Expand-only: a nullable
-- column the previous release neither reads nor writes.
-- AlterTable
ALTER TABLE "project_integration" ADD COLUMN     "credentialHint" TEXT;
