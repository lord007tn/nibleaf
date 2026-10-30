-- Better Auth's organization plugin writes invitation.createdAt, and from 1.7.3
-- its schema check rejects auth requests while the column is missing. The
-- default fills existing rows and keeps inserts from older images working.
ALTER TABLE "invitation" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
