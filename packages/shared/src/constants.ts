export const Env = ['development', 'test', 'production'] as const;
export type Env = (typeof Env)[number];

/** Workspace member roles. `owner`/`admin`/`member` are better-auth's
 *  organization-plugin defaults (`member` is shown as "Editor"). `viewer` is
 *  Nibleaf's read-only role: better-auth grants an unknown role no
 *  organization permissions, and every Nibleaf guard ranks it below `member`. */
export const MemberRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

/** Documentation tree node kind (mirrors the Prisma `PageKind` enum). */
export const PageKind = {
  PAGE: 'PAGE',
  GROUP: 'GROUP',
} as const;
export type PageKind = (typeof PageKind)[keyof typeof PageKind];

/** Deployment lifecycle status (mirrors the Prisma `DeploymentStatus` enum). */
export const DeploymentStatus = {
  PENDING: 'PENDING',
  BUILDING: 'BUILDING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const API_KEY_PREFIX = 'plm';

export const MAX_ASSET_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ASSET_UPLOAD_CLOCK_SKEW_MS = 60_000;
export const ASSET_UPLOAD_FIRST_RECHECK_MS = 30 * 60 * 1000;
// Providers/proxies must terminate accepted PUTs within this shared upload/erasure allowance.
export const MAX_ACCEPTED_PUT_DURATION_MS = 23 * 60 * 60 * 1000;
export const PENDING_ASSET_UPLOAD_GRACE_MS = 10 * 60 * 1000 + ASSET_UPLOAD_CLOCK_SKEW_MS + ASSET_UPLOAD_FIRST_RECHECK_MS;
// Outstanding reservations remain counted while the cleanup worker is down; uploads pause at these caps until space is freed.
export const MAX_PENDING_ASSET_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_PENDING_ASSET_UPLOADS = 20;
// Active and retained reservations bound declared unconfirmed bytes to 500 MiB + 2 GiB (2.48828125 GiB).
// This covers current object bodies; versioned buckets also retain noncurrent versions.
// Retained bytes stay reserved through URL expiry, clock skew and MAX_ACCEPTED_PUT_DURATION_MS.
export const MAX_RETAINED_ASSET_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_RETAINED_ASSET_UPLOADS = 500;
