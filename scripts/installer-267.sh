#!/usr/bin/env bash
# Render exactly as release automation does, using the PR's implementation.
node --input-type=module - "$PUBLIC" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.argv[2];const {renderInstaller}=await import(pathToFileURL(root+'/self-host-release.mjs'));
const manifest=JSON.parse(readFileSync(root+'/self-host.json'));
const output=renderInstaller(readFileSync(root+'/installer-template.sh','utf8'),manifest.version,manifest.composeSha256);
if(createHash('sha256').update(output).digest('hex')!==manifest.installerSha256)throw new Error('PR installer manifest checksum mismatch');
writeFileSync(root+'/rendered-installer.sh',output);
console.log('PR rendered installer checksum: PASS');
JS
export NIBLEAF_INSTALL_DIR="$RUNNER_TEMP/fresh-pr267" NIBLEAF_APP_URL=http://127.0.0.1:4310 NIBLEAF_STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:9300
export COMPOSE_PROJECT_NAME=installer-proof NIBLEAF_VERSION="$CANDIDATE"
export NIBLEAF_COMPOSE_URL="https://raw.githubusercontent.com/lord007tn/nibleaf/$GUIDE_COMMIT/docker-compose.prod.yml"
export NIBLEAF_COMPOSE_SHA256
NIBLEAF_COMPOSE_SHA256=$(python3 -c 'import json,os;print(json.load(open(os.environ["PUBLIC"]+"/self-host.json"))["composeSha256"])')
export INSTALLER_SCRIPT="$PUBLIC/rendered-installer.sh" INSTALLER_KIND=new INSTALLER_LOG="$PRIVATE/fresh-pr-installer.log"
CURRENT=PR-installer-fresh;log=$INSTALLER_LOG
expect "$SOURCE/scripts/installer-267.exp"
cd "$NIBLEAF_INSTALL_DIR"
healthy
for phrase in 'add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET' 'Email codes will not arrive until Postmark or SMTP is configured.';do grep -q "$phrase" "$INSTALLER_LOG";done
grep '^Next:' "$INSTALLER_LOG" > "$PUBLIC/no-email-final-message.txt"
grep -q "EMAIL_DELIVERY_REQUIRED='false'" .env
grep -q "NIBLEAF_VERSION='$CANDIDATE'" .env
test "$(stat -c '%a' .env)" = 600
cp .env "$PRIVATE/fresh-env-copy"
cp docker-compose.yml "$PRIVATE/fresh-compose-copy"
record PR-installer-fresh PASS 'all six services healthy; persisted candidate; no-email final message correct; mode 600'
export INSTALLER_KIND=existing INSTALLER_LOG="$PRIVATE/existing-refusal.log"
log=$INSTALLER_LOG
if expect "$SOURCE/scripts/installer-267.exp";then record existing-refusal FAIL 'installer allowed overwrite';exit 1;fi
grep -q 'Existing installation' "$log";safe_errors
cmp -s .env "$PRIVATE/fresh-env-copy";cmp -s docker-compose.yml "$PRIVATE/fresh-compose-copy"
record existing-refusal PASS 'nonzero refusal; existing configuration byte-identical'
# Existing project/volume detection when selecting a different empty install directory.
export NIBLEAF_INSTALL_DIR="$RUNNER_TEMP/empty-install-target" INSTALLER_LOG="$PRIVATE/volume-refusal.log"
log=$INSTALLER_LOG
if expect "$SOURCE/scripts/installer-267.exp";then return 1;fi
grep -q 'Existing Compose project or volumes' "$log";safe_errors
test ! -e "$NIBLEAF_INSTALL_DIR/.env"
record existing-project-volume-refusal PASS 'retained project prevents fresh-dir reinstall; no files created'
export NIBLEAF_INSTALL_DIR="$RUNNER_TEMP/fresh-pr267"
REAL_DOCKER=$(command -v docker);REAL_CURL=$(command -v curl);export REAL_DOCKER REAL_CURL
MOCK="$PRIVATE/preflight-bin";mkdir -p "$MOCK"
cat > "$MOCK/curl" <<'SH'
#!/bin/sh
touch "$PRIVATE/curl-executed"
exec "$REAL_CURL" "$@"
SH
chmod +x "$MOCK/curl"
cat > "$MOCK/uname" <<'SH'
#!/bin/sh
echo aarch64
SH
chmod +x "$MOCK/uname"
export INSTALLER_KIND=preflight INSTALLER_LOG="$PRIVATE/host-arch.log"
log=$INSTALLER_LOG
if PATH="$MOCK:$PATH" expect "$SOURCE/scripts/installer-267.exp";then return 1;fi
grep -q 'Unsupported architecture: aarch64' "$log";safe_errors
test ! -e "$PRIVATE/curl-executed"
record host-architecture PASS 'unsupported shell architecture refused before download'
# Supported uname amd64 alias proceeds to the existing-install check.
printf '#!/bin/sh\necho amd64\n' > "$MOCK/uname"
export INSTALLER_KIND=existing INSTALLER_LOG="$PRIVATE/amd64-alias.log"
log=$INSTALLER_LOG
if PATH="$MOCK:$PATH" expect "$SOURCE/scripts/installer-267.exp";then return 1;fi
grep -q 'Existing installation' "$log"
record supported-alias PASS 'amd64 alias accepted; existing-install fence still applies'
# Keep real host uname, override only daemon architecture response.
rm "$MOCK/uname"
cat > "$MOCK/docker" <<'SH'
#!/bin/sh
if [ "$1" = version ];then echo arm64;exit 0;fi
exec "$REAL_DOCKER" "$@"
SH
chmod +x "$MOCK/docker"
export INSTALLER_KIND=preflight INSTALLER_LOG="$PRIVATE/daemon-arch.log"
log=$INSTALLER_LOG
if PATH="$MOCK:$PATH" expect "$SOURCE/scripts/installer-267.exp";then return 1;fi
grep -q 'Unsupported architecture: arm64 on the Docker daemon' "$log";safe_errors
test ! -e "$PRIVATE/curl-executed"
record daemon-architecture PASS 'unsupported daemon architecture refused before download'
cat > "$MOCK/docker" <<'SH'
#!/bin/sh
if [ "$1" = version ];then exit 1;fi
exec "$REAL_DOCKER" "$@"
SH
export INSTALLER_LOG="$PRIVATE/daemon-unavailable.log";log=$INSTALLER_LOG
if PATH="$MOCK:$PATH" expect "$SOURCE/scripts/installer-267.exp";then return 1;fi
grep -q 'Could not reach the Docker daemon' "$log";safe_errors
record unreachable-daemon PASS 'clear failure before download'
cmp -s .env "$PRIVATE/fresh-env-copy"
if docker image inspect ghcr.io/lord007tn/nibleaf:v0.2.0 > /dev/null 2>&1;then record release-tag FAIL 'unexpected release tag exists on fresh runner';exit 1;fi
record release-tag-untouched PASS 'no v0.2.0 image built or pulled; only candidate tag used'
record complete PASS 'PR installer fresh/guard/architecture/no-email cases completed'
