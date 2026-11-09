import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const guard = [isAuthenticated, requireProjectRole(MemberRole.ADMIN)] as const;
const ok = { 200: { description: 'ok' }, ...errorResponses };
const created = { 201: { description: 'created' }, ...errorResponses };

const routes = {
  list: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'List private readers, audiences, JWT configuration, and audit events.',
    responses: ok,
  }),
  updateMode: createRouteConfig({ guard: [...guard], tags: ['reader-access'], description: 'Set the published-site access mode.', responses: ok }),
  createAudience: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Create a site or page-scoped reader audience.',
    responses: created,
  }),
  updateAudience: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Update an audience and its content grants.',
    responses: ok,
  }),
  deleteAudience: createRouteConfig({ guard: [...guard], tags: ['reader-access'], description: 'Delete an audience and its grants.', responses: ok }),
  inviteReader: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Invite a dedicated reader without creating an author seat.',
    responses: created,
  }),
  inviteReaders: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Invite up to 100 readers at once, to the whole site unless audiences are given.',
    responses: created,
  }),
  resendInvitation: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Email a reader a new invitation link without changing their access.',
    responses: ok,
  }),
  emailDomains: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Set the email domains whose addresses can sign in without an invitation.',
    responses: ok,
  }),
  accessRequestsSetting: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Let people without access ask for it from the sign-in screen.',
    responses: ok,
  }),
  approveAccessRequest: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Approve an access request: invite the person to the whole site.',
    responses: ok,
  }),
  declineAccessRequest: createRouteConfig({ guard: [...guard], tags: ['reader-access'], description: 'Decline an access request.', responses: ok }),
  updateReader: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Update reader profile and audience memberships.',
    responses: ok,
  }),
  revokeReader: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Revoke a reader and all sessions immediately.',
    responses: ok,
  }),
  jwt: createRouteConfig({ guard: [...guard], tags: ['reader-access'], description: 'Configure asymmetric JWT/JWKS reader handoff.', responses: ok }),
  testJwt: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Validate a sample JWT without creating a reader session.',
    responses: ok,
  }),
  emergency: createRouteConfig({
    guard: [...guard],
    tags: ['reader-access'],
    description: 'Revoke every reader session/invitation and disable JWT handoff.',
    responses: ok,
  }),
};

export default routes;
