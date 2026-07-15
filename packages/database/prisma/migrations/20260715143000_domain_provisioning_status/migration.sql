CREATE TYPE "DomainDnsStatus" AS ENUM ('PENDING', 'VERIFIED', 'ERROR');
CREATE TYPE "DomainSslStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'ERROR');

ALTER TABLE "domain"
ADD COLUMN "dnsStatus" "DomainDnsStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "sslStatus" "DomainSslStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT;

UPDATE "domain"
SET "dnsStatus" = 'VERIFIED', "lastCheckedAt" = COALESCE("verifiedAt", "createdAt")
WHERE "verified" = true;
