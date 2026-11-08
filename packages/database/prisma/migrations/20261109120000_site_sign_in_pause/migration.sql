-- CreateTable
CREATE TABLE "site_sign_in_guard" (
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "burnedCodes" INTEGER NOT NULL DEFAULT 0,
    "pausedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_sign_in_guard_pkey" PRIMARY KEY ("projectId","email")
);

-- CreateIndex
CREATE INDEX "site_sign_in_guard_updatedAt_idx" ON "site_sign_in_guard"("updatedAt");

-- AddForeignKey
ALTER TABLE "site_sign_in_guard" ADD CONSTRAINT "site_sign_in_guard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

