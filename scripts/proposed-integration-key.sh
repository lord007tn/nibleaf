# Proposed guide replacement, tested separately from the extracted literal block.
_integration_key=$(sed -n 's/^INTEGRATION_CREDENTIAL_ENCRYPTION_KEY=//p' .env | tail -n 1)
case "$_integration_key" in
  ''|"''"|'""')
    printf "INTEGRATION_CREDENTIAL_ENCRYPTION_KEY='%s'\n" "$(openssl rand -base64 32)" >> .env
    ;;
esac
unset _integration_key
docker compose run --rm --no-deps -T server node -e '
const key = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
if (!key || Buffer.from(key, "base64").length !== 32) {
  console.error("Integration key must be a base64-encoded 32-byte value; preserve any existing key and investigate.");
  process.exit(1);
}
console.log("Integration key format: PASS");'
docker compose up -d
