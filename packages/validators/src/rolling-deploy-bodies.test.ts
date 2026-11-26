import { describe, expect, it } from 'vitest';
import { mutateProjectAddonBody, updateProjectAddonBody } from './addons';
import { saveWorkspaceAiConnectionBody, workspaceAiSelectionBody } from './ai';
import { gitConnectionBody } from './index';
import {
  createIntegrationDeleteConfirmationBody,
  createProjectIntegrationBody,
  integrationRevisionBody,
  updateProjectIntegrationBody,
  verifyProjectIntegrationBody,
} from './integrations';

// During a rolling deploy a new dashboard talks to the API one release behind (#915). The dashboard's revisioned save
// bodies strip a field they don't know instead of refusing the save, so a release can add an optional field to one
// (operations/runbook-rolling-deploys.md §6.1).
const FUTURE = { addedNextRelease: 'ignored by this release' };
const tolerant: Array<[string, { safeParse: (value: unknown) => { success: boolean; data?: unknown } }, Record<string, unknown>]> = [
  ['gitConnectionBody', gitConnectionBody, { repository: 'acme/docs', baseBranch: 'main', headBranch: 'nibleaf/docs', expectedRevision: 2 }],
  ['updateProjectAddonBody', updateProjectAddonBody, { config: {}, expectedRevision: 0 }],
  ['mutateProjectAddonBody', mutateProjectAddonBody, { expectedRevision: 3 }],
  ['saveWorkspaceAiConnectionBody', saveWorkspaceAiConnectionBody, { providerId: 'openai', answerModel: 'fixture-model', expectedRevision: 2 }],
  ['workspaceAiSelectionBody', workspaceAiSelectionBody, { providerId: 'disabled', answersEnabled: false, expectedRevision: 1 }],
  [
    'updateProjectIntegrationBody',
    updateProjectIntegrationBody,
    { providerId: 'slack', label: 'Docs', expectedRevision: 1, idempotencyKey: 'update-key' },
  ],
  ['integrationRevisionBody', integrationRevisionBody, { expectedRevision: 1, idempotencyKey: 'revision-key' }],
  ['verifyProjectIntegrationBody (slack)', verifyProjectIntegrationBody, { providerId: 'slack', expectedRevision: 1, idempotencyKey: 'verify-key' }],
  ['createIntegrationDeleteConfirmationBody', createIntegrationDeleteConfirmationBody, { expectedRevision: 1 }],
];

describe('dashboard save bodies across a rolling deploy', () => {
  it.each(tolerant)('%s accepts a field from the next release and drops it', (_name, schema, body) => {
    expect(schema.safeParse(body)).toEqual({ success: true, data: body });
    expect(schema.safeParse({ ...body, ...FUTURE })).toEqual({ success: true, data: body });
  });

  it.each(tolerant)('%s still refuses a known field with a wrong value (its revision)', (_name, schema, body) => {
    expect(schema.safeParse({ ...body, ...FUTURE, expectedRevision: 'not a number' }).success).toBe(false);
  });

  it('keeps creating a connection strict: it carries a new webhook credential', () => {
    const body = {
      providerId: 'slack',
      webhookUrl: 'https://hooks.slack.com/services/T/B/token',
      label: 'Docs',
      idempotencyKey: 'create-key',
    };
    expect(createProjectIntegrationBody.safeParse(body).success).toBe(true);
    expect(createProjectIntegrationBody.safeParse({ ...body, ...FUTURE }).success).toBe(false);
  });
});
