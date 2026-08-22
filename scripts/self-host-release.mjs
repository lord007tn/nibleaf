import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repositoryRoot, 'release', 'self-host.json');
const installerPath = join(repositoryRoot, 'scripts', 'install.sh');
const composePath = join(repositoryRoot, 'docker-compose.prod.yml');
const readmePath = join(repositoryRoot, 'README.md');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const releaseAssetBaseUrl = (version) => `https://github.com/lord007tn/nibleaf/releases/download/${version}`;

export function renderInstaller(template, version, composeSha256) {
  return template.replaceAll('{{NIBLEAF_RELEASE_VERSION}}', version).replaceAll('{{NIBLEAF_COMPOSE_SHA256}}', composeSha256);
}

export function verifiedInstallCommand(version, installerSha256) {
  const baseUrl = releaseAssetBaseUrl(version);
  return `set -eu; d=$(mktemp -d); trap 'rm -rf "$d"' EXIT; curl -fsSLo "$d/nibleaf-install.sh" ${baseUrl}/nibleaf-install.sh; actual=$(openssl dgst -sha256 "$d/nibleaf-install.sh"); actual=\${actual##* }; [ "$actual" = "${installerSha256}" ] || { echo "Nibleaf installer checksum mismatch" >&2; exit 1; }; sh "$d/nibleaf-install.sh"`;
}

export async function buildSelfHostRelease() {
  const [manifestSource, installerTemplate, compose, readme] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(installerPath, 'utf8'),
    readFile(composePath, 'utf8'),
    readFile(readmePath, 'utf8'),
  ]);
  const manifest = JSON.parse(manifestSource);
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version))
    throw new Error(`Invalid self-host release version: ${manifest.version}`);

  const composeDigest = sha256(compose);
  const installer = renderInstaller(installerTemplate, manifest.version, composeDigest);
  const installerDigest = sha256(installer);
  const command = verifiedInstallCommand(manifest.version, installerDigest);
  if (!compose.includes(`NIBLEAF_VERSION:-${manifest.version}`))
    throw new Error('docker-compose.prod.yml does not default to the release manifest version');
  if (!readme.includes(command)) throw new Error('README.md does not contain the verified install command generated from release/self-host.json');

  return {
    actualManifest: { version: manifest.version, installerSha256: installerDigest, composeSha256: composeDigest },
    command,
    compose,
    installer,
    manifest,
    readme,
  };
}

export function assertManifestMatches({ actualManifest, manifest }) {
  for (const field of ['version', 'installerSha256', 'composeSha256']) {
    if (manifest[field] !== actualManifest[field]) throw new Error(`release/self-host.json ${field} is stale: expected ${actualManifest[field]}`);
  }
}

export async function writeReleaseAssets(directory, release) {
  await mkdir(directory, { recursive: true });
  const checksums = `${release.actualManifest.installerSha256}  nibleaf-install.sh\n${release.actualManifest.composeSha256}  docker-compose.yml\n`;
  await Promise.all([
    writeFile(join(directory, 'nibleaf-install.sh'), release.installer),
    writeFile(join(directory, 'docker-compose.yml'), release.compose),
    writeFile(join(directory, 'SHA256SUMS'), checksums),
    writeFile(join(directory, 'install-command.txt'), `${release.command}\n`),
    writeFile(join(directory, 'self-host-release.json'), `${JSON.stringify(release.actualManifest, null, 2)}\n`),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = await buildSelfHostRelease();
  if (process.argv.includes('--print-actual')) {
    process.stdout.write(`${JSON.stringify(release.actualManifest, null, 2)}\n`);
  } else if (process.argv.includes('--print-command')) {
    assertManifestMatches(release);
    process.stdout.write(`${release.command}\n`);
  } else {
    assertManifestMatches(release);
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex >= 0) {
      const output = process.argv[outputIndex + 1];
      if (!output) throw new Error('--output requires a directory');
      await writeReleaseAssets(resolve(output), release);
    }
    process.stdout.write(`Self-host release ${release.manifest.version} verified.\n`);
  }
}
