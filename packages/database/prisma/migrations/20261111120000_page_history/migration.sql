-- Expand-only private page history. No existing rows or columns change.
CREATE TABLE "page_revision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pageId" TEXT NOT NULL REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "contentBytes" INTEGER NOT NULL CHECK ("contentBytes" >= 0 AND "contentBytes" <= 524288),
  "reason" TEXT NOT NULL CHECK ("reason" IN ('autosave', 'before-restore'))
);
CREATE INDEX "page_revision_projectId_pageId_createdAt_id_idx" ON "page_revision"("projectId", "pageId", "createdAt" DESC, "id");
CREATE INDEX "page_revision_userId_idx" ON "page_revision"("userId");
CREATE TABLE "page_revision_state" (
  "projectId" TEXT NOT NULL REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pageId" TEXT NOT NULL REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "lastSavedAt" TIMESTAMP(3) NOT NULL,
  "lastSnapshotAt" TIMESTAMP(3),
  PRIMARY KEY ("pageId", "userId")
);
CREATE INDEX "page_revision_state_projectId_idx" ON "page_revision_state"("projectId");
CREATE INDEX "page_revision_state_userId_idx" ON "page_revision_state"("userId");
CREATE INDEX "deployment_projectId_status_createdAt_id_idx" ON "deployment"("projectId", "status", "createdAt" DESC, "id" DESC);
