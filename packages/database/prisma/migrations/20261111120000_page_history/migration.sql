-- Expand-only private page history. No existing rows or columns change.
CREATE TABLE "page_revision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pageId" TEXT NOT NULL REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentBytes" INTEGER NOT NULL CHECK ("contentBytes" >= 0 AND "contentBytes" <= 524288),
  "reason" TEXT NOT NULL CHECK ("reason" IN ('autosave', 'before-restore'))
);
CREATE INDEX "page_revision_projectId_pageId_createdAt_id_idx" ON "page_revision"("projectId", "pageId", "createdAt" DESC, "id");
CREATE INDEX "page_revision_userId_idx" ON "page_revision"("userId");
CREATE TABLE "page_revision_state" (
  "projectId" TEXT NOT NULL REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pageId" TEXT NOT NULL REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "lastSavedAt" TIMESTAMP(3) NOT NULL,
  "lastSnapshotAt" TIMESTAMP(3),
  PRIMARY KEY ("pageId", "userId")
);
CREATE INDEX "page_revision_state_projectId_idx" ON "page_revision_state"("projectId");
CREATE INDEX "page_revision_state_userId_idx" ON "page_revision_state"("userId");
