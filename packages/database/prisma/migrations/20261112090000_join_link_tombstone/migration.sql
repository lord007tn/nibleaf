-- PR 3: deleting a join link is a tombstone, so its admission history
-- (join_link_use) survives. Expand-only: three nullable columns that the PR 1
-- floor ignores; a deleted link is always revoked too, so PR 1 never admits
-- anyone through it.
ALTER TABLE "join_link"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "deletedScope" TEXT;
