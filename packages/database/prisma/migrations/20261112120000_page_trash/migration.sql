-- AUTH-12: a deleted page subtree moves to a 30-day Trash instead of being
-- cascade-deleted. Expand-only: a new table that the previous release never
-- reads or writes (it keeps hard-deleting pages during the rollout overlap).
-- CreateTable
CREATE TABLE "page_trash" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "rootPageId" TEXT NOT NULL,
    "parentId" TEXT,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "PageKind" NOT NULL DEFAULT 'PAGE',
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "deletedById" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "page_trash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_trash_projectId_branchId_deletedAt_idx" ON "page_trash"("projectId", "branchId", "deletedAt");

-- CreateIndex
CREATE INDEX "page_trash_projectId_expiresAt_idx" ON "page_trash"("projectId", "expiresAt");

-- CreateIndex
CREATE INDEX "page_trash_branchId_idx" ON "page_trash"("branchId");

-- CreateIndex
CREATE INDEX "page_trash_languageId_idx" ON "page_trash"("languageId");

-- CreateIndex
CREATE INDEX "page_trash_deletedById_idx" ON "page_trash"("deletedById");

-- AddForeignKey
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

