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


-- An account's comments are removed with the account (FK cascade); copies held
-- in Trash payloads go in the same transaction, on every deletion path. The
-- trash write locks comment authors FOR SHARE, so a user delete either waits
-- for it (and this trigger then sees the new row) or is seen by it.
-- nibleaf-migration: contract AFTER DELETE trigger on "user" that only edits page_trash, a table the previous release never reads or writes
CREATE FUNCTION page_trash_erase_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "page_trash"
  SET "payload" = jsonb_set(
    "payload",
    '{comments}',
    COALESCE(
      (SELECT jsonb_agg(comment) FROM jsonb_array_elements("payload"->'comments') AS comment WHERE comment->>'userId' IS DISTINCT FROM OLD.id),
      '[]'::jsonb
    )
  )
  WHERE jsonb_typeof("payload"->'comments') = 'array'
    AND "payload"->'comments' @> jsonb_build_array(jsonb_build_object('userId', OLD.id));
  RETURN OLD;
END $$;
CREATE TRIGGER page_trash_erase_user AFTER DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION page_trash_erase_user();
