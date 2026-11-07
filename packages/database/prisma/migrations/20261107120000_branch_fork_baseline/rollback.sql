-- Run only after the application has been rolled back to a version without
-- fork baselines. Dropping these columns forgets where every open version was
-- copied from main; the older application promotes without that check (and
-- replaces main's pages, edits made on main included). Pages are unaffected.
ALTER TABLE "branch"
  DROP COLUMN IF EXISTS "forkBaseline",
  DROP COLUMN IF EXISTS "forkedAt";
