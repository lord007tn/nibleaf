-- Design §6.12: the deletion fence and its fixed website manifest are written
-- together, inside the owner-authorized transaction. Expand-only (PR 1 ignores it).
ALTER TABLE "organization" ADD COLUMN "deletionWebsiteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
