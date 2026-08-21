-- Support impersonation is deliberately session-scoped. The administrator's
-- identity is retained for the warning banner, audit trail, and safe teardown;
-- no customer content or credentials are copied into the session.
ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;

CREATE INDEX "session_impersonatedBy_idx" ON "session"("impersonatedBy");
