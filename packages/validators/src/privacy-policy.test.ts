import { expect, it } from 'vitest';
import { projectConfigSchema } from './index';

const consent = { enabled: true, placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' };
it('round-trips an optional owner policy URL in published consent settings', () => {
  const config = { addons: { consentBanner: { ...consent, privacyPolicyUrl: 'https://example.invalid/privacy' } } };
  expect(projectConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config);
  expect(projectConfigSchema.safeParse({ addons: { consentBanner: consent } }).success).toBe(true);
});
it.each(['javascript:alert(1)', 'data:text/html,policy', 'file:///private', 'mailto:privacy@example.invalid'])(
  'rejects the policy URL scheme in %s',
  (privacyPolicyUrl) => {
    expect(projectConfigSchema.safeParse({ addons: { consentBanner: { ...consent, privacyPolicyUrl } } }).success).toBe(false);
  },
);
