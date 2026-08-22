import releaseManifest from '../../../../release/self-host.json';

const RELEASE_REPOSITORY = 'https://github.com/lord007tn/nibleaf';

export const SELF_HOST_RELEASE = releaseManifest as {
  version: `v${number}.${number}.${number}`;
  installerSha256: string;
  composeSha256: string;
};

export const selfHostReleaseBaseUrl = `${RELEASE_REPOSITORY}/releases/download/${SELF_HOST_RELEASE.version}`;

export const SELF_HOST_INSTALL_COMMAND = `set -eu; d=$(mktemp -d); trap 'rm -rf "$d"' EXIT; curl -fsSLo "$d/nibleaf-install.sh" ${selfHostReleaseBaseUrl}/nibleaf-install.sh; actual=$(openssl dgst -sha256 "$d/nibleaf-install.sh"); actual=\${actual##* }; [ "$actual" = "${SELF_HOST_RELEASE.installerSha256}" ] || { echo "Nibleaf installer checksum mismatch" >&2; exit 1; }; sh "$d/nibleaf-install.sh"`;

export function renderSelfHostInstaller(template: string): string {
  return template
    .replaceAll('{{NIBLEAF_RELEASE_VERSION}}', SELF_HOST_RELEASE.version)
    .replaceAll('{{NIBLEAF_COMPOSE_SHA256}}', SELF_HOST_RELEASE.composeSha256);
}
