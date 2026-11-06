/** @vitest-environment jsdom */

import { MCP_PRESET_SCOPES } from '@nibleaf/shared/mcp';
import { afterEach, describe, expect, it } from 'vitest';
import { consentLines, currentOAuthQuery, isOAuthAuthorizationSearch, oauthStepHref } from './mcp-oauth';

const signed = 'client_id=c1&scope=mcp%3Aconnect+pages%3Aread&ba_param=ba_param&ba_param=client_id&ba_param=scope&sig=abc';
const wrapped = Buffer.from(signed, 'utf8').toString('base64url');

afterEach(() => window.history.replaceState(null, '', '/'));

describe('MCP OAuth request on dashboard pages', () => {
  it('recognises the hand-off parameter and unwraps the exact signed query', () => {
    window.history.replaceState(null, '', `/oauth/project?oauth_request=${wrapped}`);
    expect(isOAuthAuthorizationSearch(window.location.search)).toBe(true);
    expect(currentOAuthQuery()).toBe(signed);
    expect(new URLSearchParams(currentOAuthQuery() ?? '').getAll('ba_param')).toEqual(['ba_param', 'client_id', 'scope']);
  });

  it('ignores pages without a signed request', () => {
    window.history.replaceState(null, '', '/sign-in?invite=abc');
    expect(isOAuthAuthorizationSearch(window.location.search)).toBe(false);
    expect(currentOAuthQuery()).toBeNull();
    window.history.replaceState(null, '', `/sign-in?oauth_request=${Buffer.from('client_id=c1').toString('base64url')}`);
    expect(currentOAuthQuery()).toBeNull();
  });

  it('links between steps of the same request', () => {
    expect(oauthStepHref('/oauth/project', `?oauth_request=${wrapped}&x=1`)).toBe(`/oauth/project?oauth_request=${wrapped}`);
  });
});

describe('consent summary', () => {
  it('says a read-only connection cannot change anything', () => {
    const { can, cannot } = consentLines(MCP_PRESET_SCOPES.read_only);
    expect(can).toEqual(['oauth.consent.can.read', 'oauth.consent.can.deployments', 'oauth.consent.can.analytics']);
    expect(cannot).toEqual(['oauth.consent.cannot.change', 'oauth.consent.cannot.other']);
  });

  it('spells out drafts and confirmed publishing for the support writer', () => {
    const { can, cannot } = consentLines(MCP_PRESET_SCOPES.support_writer);
    expect(can).toEqual(expect.arrayContaining(['oauth.consent.can.searchTerms', 'oauth.consent.can.drafts', 'oauth.consent.can.publish']));
    expect(can).not.toContain('oauth.consent.can.settings');
    expect(cannot).toEqual(['oauth.consent.cannot.admin', 'oauth.consent.cannot.other']);
  });

  it('adds settings reads for full admin', () => {
    expect(consentLines(MCP_PRESET_SCOPES.full_admin).can).toContain('oauth.consent.can.settings');
  });
});
