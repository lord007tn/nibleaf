import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import PRODUCTION_COMPOSE from '../../../../docker-compose.prod.yml?raw';
import INSTALL_TEMPLATE from '../../../../scripts/install.sh?raw';
import { renderSelfHostInstaller, SELF_HOST_INSTALL_COMMAND, SELF_HOST_RELEASE, selfHostReleaseBaseUrl } from './self-host-release';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('self-host release integrity', () => {
  it('keeps the committed manifest synchronized with the release artifacts', () => {
    const installer = renderSelfHostInstaller(INSTALL_TEMPLATE);

    expect(sha256(PRODUCTION_COMPOSE)).toBe(SELF_HOST_RELEASE.composeSha256);
    expect(sha256(installer)).toBe(SELF_HOST_RELEASE.installerSha256);
    expect(installer).toContain(`RELEASE_VERSION='${SELF_HOST_RELEASE.version}'`);
    expect(installer).toContain(`RELEASE_COMPOSE_SHA256='${SELF_HOST_RELEASE.composeSha256}'`);
    expect(installer).not.toContain('{{NIBLEAF_');
  });

  it('publishes a pinned bootstrap command that verifies before execution', () => {
    expect(SELF_HOST_INSTALL_COMMAND).toContain(`${selfHostReleaseBaseUrl}/nibleaf-install.sh`);
    expect(SELF_HOST_INSTALL_COMMAND).toContain(SELF_HOST_RELEASE.installerSha256);
    expect(SELF_HOST_INSTALL_COMMAND).toContain('openssl dgst -sha256');
    expect(SELF_HOST_INSTALL_COMMAND).not.toContain('| sh');
  });
});
