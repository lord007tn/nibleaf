-- Record main's pages when a version is copied from main, so "Promote into
-- main" can refuse instead of silently replacing edits made on main since.
-- Both columns are nullable: versions created before this change (and versions
-- copied from another version) have no baseline, and promote refuses them.
ALTER TABLE "branch" ADD COLUMN     "forkBaseline" JSONB,
ADD COLUMN     "forkedAt" TIMESTAMP(3);
