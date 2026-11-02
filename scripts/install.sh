#!/bin/sh
set -eu

# Nibleaf interactive production installer. Release automation replaces both
# placeholders before publishing this file as a versioned, checksummed asset.

RELEASE_VERSION='{{NIBLEAF_RELEASE_VERSION}}'
RELEASE_COMPOSE_SHA256='{{NIBLEAF_COMPOSE_SHA256}}'
RELEASE_BASE_URL="https://github.com/lord007tn/nibleaf/releases/download/$RELEASE_VERSION"
COMPOSE_URL=${NIBLEAF_COMPOSE_URL:-$RELEASE_BASE_URL/docker-compose.yml}
COMPOSE_SHA256=${NIBLEAF_COMPOSE_SHA256:-$RELEASE_COMPOSE_SHA256}
DEFAULT_INSTALL_DIR=${NIBLEAF_INSTALL_DIR:-"$PWD/nibleaf"}
TTY=/dev/tty
# Add future published architectures here. uname reports amd64 as x86_64;
# Docker reports it as amd64.
SUPPORTED_ARCHITECTURES='x86_64 amd64'

say() { printf '%s\n' "$*"; }
fail() { say "Error: $*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

prompt() {
  _label=$1
  _default=${2:-}
  if [ -n "$_default" ]; then
    printf '%s [%s]: ' "$_label" "$_default" >"$TTY"
  else
    printf '%s: ' "$_label" >"$TTY"
  fi
  IFS= read -r _answer <"$TTY" || fail 'Could not read from the terminal.'
  printf '%s' "${_answer:-$_default}"
}

prompt_secret() {
  _label=$1
  printf '%s: ' "$_label" >"$TTY"
  _restore=''
  if has stty; then
    _restore=$(stty -g <"$TTY" 2>/dev/null || true)
    stty -echo <"$TTY" 2>/dev/null || true
  fi
  IFS= read -r _secret <"$TTY" || {
    [ -n "$_restore" ] && stty "$_restore" <"$TTY" 2>/dev/null || true
    fail 'Could not read from the terminal.'
  }
  [ -n "$_restore" ] && stty "$_restore" <"$TTY" 2>/dev/null || true
  printf '\n' >"$TTY"
  printf '%s' "$_secret"
}

confirm() {
  _answer=$(prompt "$1 (y/n)" "${2:-y}")
  case $_answer in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

require_value() {
  [ -n "$2" ] || fail "$1 is required."
  case $2 in *'\n'*|*'\r'*) fail "$1 cannot contain a newline." ;; esac
}

env_line() {
  _escaped=$(printf '%s' "$2" | sed "s/'/'\"'\"'/g")
  printf "%s='%s'\n" "$1" "$_escaped" >>"$ENV_TMP"
}

random_hex() { openssl rand -hex "$1"; }

verify_sha256() {
  _file=$1
  _expected=$2
  case $_expected in ''|*[!0-9a-fA-F]*) fail 'The expected Compose SHA-256 must be 64 hexadecimal characters.' ;; esac
  [ "${#_expected}" -eq 64 ] || fail 'The expected Compose SHA-256 must be 64 hexadecimal characters.'
  _digest=$(openssl dgst -sha256 "$_file") || fail "Could not hash $_file"
  _actual=${_digest##* }
  [ "$_actual" = "$_expected" ] || fail "Compose checksum mismatch: expected $_expected but received $_actual. No configuration was installed."
}

ARCHITECTURE=$(uname -m)
case " $SUPPORTED_ARCHITECTURES " in
  *" $ARCHITECTURE "*) ;;
  *) fail "Unsupported architecture: $ARCHITECTURE. The published image supports linux/amd64 only." ;;
esac

[ -r "$TTY" ] || fail 'Run this command from an interactive SSH terminal.'
has curl || fail 'curl is required.'
has sed || fail 'sed is required.'
has openssl || fail 'openssl is required to generate secure credentials.'
has docker || fail 'Docker is required. Install Docker Engine and try again.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 (docker compose) is required.'
# The image runs on the Docker daemon, which can differ from this shell under emulation.
DOCKER_ARCHITECTURE=$(docker version -f '{{.Server.Arch}}' 2>/dev/null) || fail 'Could not reach the Docker daemon. Check that it is running and that this user can access it (for example, through the docker group or sudo).'
case " $SUPPORTED_ARCHITECTURES " in
  *" $DOCKER_ARCHITECTURE "*) ;;
  *) fail "Unsupported architecture: $DOCKER_ARCHITECTURE on the Docker daemon. The published image supports linux/amd64 only." ;;
esac

say ''
say 'Nibleaf guided production setup'
say 'This will download Docker Compose, generate secrets locally, and start the stack.'
say ''

INSTALL_DIR=$(prompt 'Install directory' "$DEFAULT_INSTALL_DIR")
# The production Compose file declares name: nibleaf. Honor an explicit
# project override and persist it so later Compose commands use the same name.
PROJECT_NAME=${COMPOSE_PROJECT_NAME:-nibleaf}
case $PROJECT_NAME in ''|[!a-z0-9]*|*[!a-z0-9_-]*) fail 'COMPOSE_PROJECT_NAME must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores or hyphens.' ;; esac
for _file in .env compose.yaml compose.yml docker-compose.yaml docker-compose.yml docker-compose.prod.yml; do
  if [ -e "$INSTALL_DIR/$_file" ] || [ -L "$INSTALL_DIR/$_file" ]; then
    fail "Existing installation in $INSTALL_DIR. Use https://docs.nibleaf.com/self-hosting/upgrade-v0-2; no files were changed."
  fi
done
CONTAINERS=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_NAME") || fail 'Could not inspect existing Compose containers.'
VOLUMES=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT_NAME") || fail 'Could not inspect existing Compose volumes.'
# Also catch retained volumes whose Compose labels are missing.
NAMED_VOLUMES=$(docker volume ls -q --filter "name=^${PROJECT_NAME}_") || fail 'Could not inspect existing volumes.'
if [ -n "$CONTAINERS$VOLUMES$NAMED_VOLUMES" ]; then
  fail "Existing Compose project or volumes for $PROJECT_NAME. Use https://docs.nibleaf.com/self-hosting/upgrade-v0-2; nothing was changed."
fi
APP_URL=${NIBLEAF_APP_URL:-$(prompt 'Public dashboard URL (https://docs.example.com)' '')}
STORAGE_PUBLIC_ENDPOINT=${NIBLEAF_STORAGE_PUBLIC_ENDPOINT:-$(prompt 'Public storage URL (https://storage.example.com)' '')}
require_value 'Public dashboard URL' "$APP_URL"
require_value 'Public storage URL' "$STORAGE_PUBLIC_ENDPOINT"
case $APP_URL in http://*|https://*) ;; *) fail 'Dashboard URL must begin with http:// or https://.' ;; esac
case $STORAGE_PUBLIC_ENDPOINT in http://*|https://*) ;; *) fail 'Storage URL must begin with http:// or https://.' ;; esac
APP_URL=${APP_URL%/}
STORAGE_PUBLIC_ENDPOINT=${STORAGE_PUBLIC_ENDPOINT%/}

SITE_BASE_DOMAIN=$(prompt 'Base domain for published sites (optional)' '')
CUSTOM_DOMAIN_CNAME_TARGET=$(prompt 'CNAME target for customer domains (optional)' "$SITE_BASE_DOMAIN")
NIBLEAF_VERSION=$(prompt 'Nibleaf image tag' "${NIBLEAF_VERSION:-$RELEASE_VERSION}")

EMAIL_FROM='nibleaf@localhost'
POSTMARK_API_KEY=''
POSTMARK_MESSAGE_STREAM=''
SMTP_URL=''
EMAIL_DELIVERY_REQUIRED=true
if confirm 'Enable transactional email delivery for sign-in codes and invitations?' y; then
  EMAIL_FROM=$(prompt 'From address (Nibleaf <no-reply@example.com>)' '')
  require_value 'From address' "$EMAIL_FROM"
  EMAIL_PROVIDER=$(prompt 'Mail provider: postmark or smtp' 'postmark')
  case $EMAIL_PROVIDER in
    postmark)
      POSTMARK_API_KEY=$(prompt_secret 'Postmark server token')
      require_value 'Postmark server token' "$POSTMARK_API_KEY"
      POSTMARK_MESSAGE_STREAM=$(prompt 'Postmark message stream' 'outbound')
      ;;
    smtp)
      SMTP_URL=$(prompt_secret 'SMTP URL (smtp://user:pass@host:587)')
      require_value 'SMTP URL' "$SMTP_URL"
      ;;
    *) fail 'Mail provider must be postmark or smtp.' ;;
  esac
else
  say 'Warning: without email delivery, the first owner cannot sign in with email codes unless Google sign-in is configured.'
  confirm 'Continue without email delivery and configure Google sign-in separately?' n || fail 'Cancelled; configure Postmark or SMTP for email sign-in.'
  EMAIL_DELIVERY_REQUIRED=false
fi

umask 077
mkdir -p "$INSTALL_DIR"
ENV_TMP="$INSTALL_DIR/.env.tmp.$$"
COMPOSE_TMP="$INSTALL_DIR/docker-compose.yml.tmp.$$"
trap 'rm -f "$ENV_TMP" "$COMPOSE_TMP"' EXIT HUP INT TERM
: >"$ENV_TMP"

env_line COMPOSE_PROJECT_NAME "$PROJECT_NAME"
env_line NIBLEAF_VERSION "$NIBLEAF_VERSION"
env_line APP_URL "$APP_URL"
env_line BETTER_AUTH_SECRET "$(random_hex 32)"
env_line INTEGRATION_CREDENTIAL_ENCRYPTION_KEY "$(openssl rand -base64 32)"
env_line INTERNAL_API_SECRET "$(random_hex 32)"
env_line POSTGRES_PASSWORD "$(random_hex 24)"
env_line STORAGE_PROVIDER maxio
env_line STORAGE_ENDPOINT http://maxio:9000
env_line STORAGE_PUBLIC_ENDPOINT "$STORAGE_PUBLIC_ENDPOINT"
env_line STORAGE_PUBLIC_URL "$STORAGE_PUBLIC_ENDPOINT/nibleaf"
env_line STORAGE_ACCESS_KEY_ID "nibleaf-$(random_hex 8)"
env_line STORAGE_SECRET_ACCESS_KEY "$(random_hex 32)"
env_line STORAGE_BUCKET nibleaf
env_line STORAGE_REGION auto
env_line STORAGE_FORCE_PATH_STYLE true
env_line SITE_BASE_DOMAIN "$SITE_BASE_DOMAIN"
env_line CUSTOM_DOMAIN_CNAME_TARGET "$CUSTOM_DOMAIN_CNAME_TARGET"
env_line DISABLE_SIGNUP false
env_line EMAIL_DELIVERY_REQUIRED "$EMAIL_DELIVERY_REQUIRED"
env_line EMAIL_FROM "$EMAIL_FROM"
env_line POSTMARK_API_KEY "$POSTMARK_API_KEY"
env_line POSTMARK_MESSAGE_STREAM "$POSTMARK_MESSAGE_STREAM"
env_line SMTP_URL "$SMTP_URL"
env_line WORKBENCH_USER admin
env_line WORKBENCH_PASS "$(random_hex 24)"
env_line NIBLEAF_RUN_SEED false

say ''
say 'Downloading the production Compose file...'
curl -fsSL "$COMPOSE_URL" -o "$COMPOSE_TMP" || fail "Could not download $COMPOSE_URL"
verify_sha256 "$COMPOSE_TMP" "$COMPOSE_SHA256"
say "Verified Docker Compose SHA-256: $COMPOSE_SHA256"
mv -f "$ENV_TMP" "$INSTALL_DIR/.env"
mv -f "$COMPOSE_TMP" "$INSTALL_DIR/docker-compose.yml"
chmod 600 "$INSTALL_DIR/.env"

say 'Pulling Nibleaf containers...'
if ! (cd "$INSTALL_DIR" && docker compose pull); then
  say ''
  say 'The public image could not be pulled. Check linux/amd64 architecture, network access to ghcr.io, and available disk space.'
  say "Then restart with: cd '$INSTALL_DIR' && docker compose up -d"
  fail 'Container pull failed; the generated configuration was kept.'
fi

say 'Starting Nibleaf...'
if ! (cd "$INSTALL_DIR" && docker compose up -d); then
  say ''
  say "Check the output above, then restart with: cd '$INSTALL_DIR' && docker compose up -d"
  fail 'Nibleaf did not start; the generated configuration was kept.'
fi
trap - EXIT HUP INT TERM

say ''
say 'Nibleaf is running.'
say "Dashboard: $APP_URL"
say "Configuration: $INSTALL_DIR/.env (mode 600)"
say "Reverse proxy targets: dashboard -> 127.0.0.1:4310; storage -> maxio:9000 (or publish it to loopback)."
say "Check status: cd '$INSTALL_DIR' && docker compose ps"
if [ "$EMAIL_DELIVERY_REQUIRED" = false ]; then
  say "Next: configure DNS/TLS, add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to $INSTALL_DIR/.env, run docker compose up -d there, then open /sign-up. Email codes will not arrive until Postmark or SMTP is configured. Set DISABLE_SIGNUP=true if this is a private instance."
else
  say 'Next: configure DNS/TLS, open /sign-up for the first owner, then set DISABLE_SIGNUP=true if this is a private instance.'
fi
