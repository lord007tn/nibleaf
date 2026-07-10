-- AlterTable
ALTER TABLE "user" ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "takedownAt" TIMESTAMP(3),
ADD COLUMN     "takedownReason" TEXT;

-- AlterTable
ALTER TABLE "deployment" ADD COLUMN     "errorDetails" JSONB;

-- CreateTable
CREATE TABLE "platform_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_event_type_createdAt_idx" ON "platform_event"("type", "createdAt");
