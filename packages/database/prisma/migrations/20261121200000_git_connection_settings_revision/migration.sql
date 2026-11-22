-- #876: the revision of a Git connection's settings, so a settings form loaded
-- before another save committed can be told so instead of replacing it. Only
-- a connection save (PUT /git/connection) moves it; sync status, webhook and
-- worker updates leave it alone. Expand-only: a column with a default, which
-- the previous release neither reads nor writes.
-- AlterTable
ALTER TABLE "git_connection" ADD COLUMN     "settingsRevision" INTEGER NOT NULL DEFAULT 1;
