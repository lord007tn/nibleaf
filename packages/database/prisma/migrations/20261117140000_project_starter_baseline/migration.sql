-- Creation-time fingerprints only. Existing projects deliberately have no rows.
CREATE TABLE "project_starter_baseline" (
    "projectId" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "starterKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_starter_baseline_pkey" PRIMARY KEY ("projectId", "bodyHash"),
    CONSTRAINT "project_starter_baseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
