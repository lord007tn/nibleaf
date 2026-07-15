ALTER TABLE "domain"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'INGRESS',
  ADD COLUMN "providerHostnameId" TEXT,
  ADD COLUMN "providerData" JSONB;

CREATE INDEX "domain_provider_providerHostnameId_idx"
  ON "domain"("provider", "providerHostnameId");
