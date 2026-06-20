export const Env = ['development', 'test', 'production'] as const;
export type Env = (typeof Env)[number];

/** Workspace member roles. Aligned with better-auth's organization plugin. */
export const MemberRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
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
