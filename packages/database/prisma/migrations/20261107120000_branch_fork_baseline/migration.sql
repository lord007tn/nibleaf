-- Record where a version was copied from main, so "Promote into main" can list
-- pages changed on main since then instead of silently replacing them.
-- Nullable: versions created before this change fall back to createdAt.
ALTER TABLE "branch" ADD COLUMN     "forkBaseline" JSONB,
ADD COLUMN     "forkedAt" TIMESTAMP(3);
