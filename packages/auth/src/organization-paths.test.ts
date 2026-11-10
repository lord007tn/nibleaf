import { organization } from 'better-auth/plugins';
import { expect, it } from 'vitest';
import { ORGANIZATION_DISABLED_PATHS } from './organization-paths';

it('disables every registered organization endpoint, including optional features', () => {
  const plugin = organization({ teams: { enabled: true }, dynamicAccessControl: { enabled: true } });
  // addMember is a server API method with no registered HTTP path.
  expect(
    Object.entries(plugin.endpoints)
      .filter(([, endpoint]) => !endpoint.path)
      .map(([name]) => name),
  ).toEqual(['addMember']);
  const registered = [
    ...new Set(
      Object.values(plugin.endpoints)
        .map((endpoint) => endpoint.path)
        .filter((path) => typeof path === 'string'),
    ),
  ].sort();
  expect([...ORGANIZATION_DISABLED_PATHS].sort()).toEqual(registered);
});
