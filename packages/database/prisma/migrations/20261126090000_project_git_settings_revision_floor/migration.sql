-- #915: the settingsRevision a site's last disconnected Git connection had
-- reached. Disconnecting deletes the git_connection row, so without it a
-- reconnect restarted at revision 1 and a settings form left open from before
-- the disconnect was accepted. A new connection now starts past this value.
-- Expand-only: a column with a default, which the previous release neither
-- reads nor writes (its disconnect leaves it as is; its first connect starts
-- at 1, as before).
-- AlterTable
ALTER TABLE "project" ADD COLUMN     "gitSettingsRevisionFloor" INTEGER NOT NULL DEFAULT 0;
