#!/usr/bin/env bash
# Real disposable KSY backup/restore acceptance; never targets a live stack.
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HARNESS="$SCRIPT_DIR/24-accept-ksy-restore.sh"
KSY_SOURCE=${KSY_RESTORE_INTEGRATION_KSY_ROOT:-}
[[ -n "$KSY_SOURCE" && -f "$KSY_SOURCE/infra/Dockerfile" ]] || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED KSY_SOURCE_INVALID\n' >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED DOCKER_REQUIRED\n' >&2
  exit 1
}

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ksy-restore-integration.XXXXXX")
chmod 700 "$WORK_DIR"
project="ksyrestore${$}${RANDOM}"
image="ksy-restore-integration:${project}"
install_root="$WORK_DIR/install"
backup_dir="$WORK_DIR/backups"
compose_file="$install_root/docker-compose.yml"
env_file="$install_root/.env"
image_created=0
project_started=0

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$project_started" == 1 ]]; then
    docker compose --project-name "$project" --env-file "$env_file" \
      -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$image_created" == 1 ]]; then
    docker image rm "$image" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$install_root" "$backup_dir"
chmod 700 "$install_root" "$backup_dir"

docker build --build-arg VITE_TELEGRAM_BOT_USERNAME=ksy_acceptance_bot \
  --file "$KSY_SOURCE/infra/Dockerfile" --tag "$image" "$KSY_SOURCE" >/dev/null
image_created=1

cat > "$compose_file" <<'YAML'
services:
  db:
    image: postgres:17.5-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 1s
      timeout: 2s
      retries: 30
  migrate:
    image: ${KSY_DEALS_IMAGE}
    command: ["node", "--experimental-strip-types", "infra/scripts/migrate.ts"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      db:
        condition: service_healthy
  backup:
    image: ${KSY_DEALS_IMAGE}
    profiles: ["maintenance"]
    user: "0:0"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      BACKUP_ENCRYPTION_PASSPHRASE: ${BACKUP_ENCRYPTION_PASSPHRASE}
    volumes:
      - ${KSY_DEALS_BACKUP_DIR}:/backups
    depends_on:
      db:
        condition: service_healthy
YAML
chmod 600 "$compose_file"

cat > "$env_file" <<ENV
KSY_DEALS_BACKUP_DIR=$backup_dir
POSTGRES_DB=ksy_deals
POSTGRES_USER=ksy_deals
POSTGRES_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DATABASE_URL=postgresql://ksy_deals:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@db:5432/ksy_deals
BACKUP_ENCRYPTION_PASSPHRASE=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
KSY_DEALS_IMAGE=$image
ENV
chmod 600 "$env_file"

compose=(docker compose --project-name "$project" --env-file "$env_file" -f "$compose_file")
project_started=1
"${compose[@]}" up -d db >/dev/null
"${compose[@]}" run --rm migrate >/dev/null

"${compose[@]}" exec -T db psql --username ksy_deals --dbname ksy_deals \
  --no-psqlrc --set ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO game_editions (
  id,region,source_product_id,canonical_url,title,edition_name,platforms,
  enabled,ps_plus_eligible,is_top,top_rank,source_status,last_confirmed_at,
  version,created_at,updated_at
) VALUES (
  '11111111-1111-4111-8111-111111111111','ua','integration-product',
  'https://store.playstation.com/integration-product','Integration Game',
  'Deluxe',ARRAY['PS5'],true,false,false,NULL,'CONFIRMED',
  '2026-08-29T10:00:00Z',1,'2026-08-29T10:00:00Z',
  '2026-08-29T10:00:00Z'
);
INSERT INTO price_observations (
  id,edition_id,fingerprint,source_status,ppid,observed_at,currency,
  base_price_minor,sale_price_minor,plus_price_minor,discount_percent,
  discount_ends_at,created_at
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111','integration-observation',
  'CONFIRMED',12345,'2026-08-29T10:05:00Z','UAH',100000,75000,NULL,25,
  '2026-09-01T00:00:00Z','2026-08-29T10:05:00Z'
);
UPDATE deal_post_format_settings
SET format='THREE_LINES', updated_at='2026-08-29T10:10:00Z'
WHERE singleton=true;
SQL

source_snapshot() {
  "${compose[@]}" exec -T db pg_dump --username ksy_deals --dbname ksy_deals \
    --data-only --no-owner --no-privileges | shasum -a 256 | awk '{print $1}'
}

live_before=$(source_snapshot)
backup_name=ksy-deals-20260829T120000Z.dump.gpg
"${compose[@]}" --profile maintenance run --rm --no-deps backup /bin/sh -eu -c '
  archive=$(mktemp /tmp/ksy-integration-backup.XXXXXX)
  trap '\''rm -f "$archive"'\'' EXIT HUP INT TERM
  pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$archive"
  printf "%s" "$BACKUP_ENCRYPTION_PASSPHRASE" |
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --symmetric \
      --cipher-algo AES256 --output "/backups/'"$backup_name"'" "$archive"
' >/dev/null
[[ -s "$backup_dir/$backup_name" ]] || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED BACKUP_MISSING\n' >&2
  exit 1
}

"${compose[@]}" --profile maintenance run --rm --no-deps backup /bin/sh -eu -c '
  archive=$(mktemp /tmp/ksy-integration-toc.XXXXXX)
  trap '\''rm -f "$archive"'\'' EXIT HUP INT TERM
  printf "%s" "$BACKUP_ENCRYPTION_PASSPHRASE" |
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
      --output "$archive" --decrypt "/backups/'"$backup_name"'"
  pg_restore --list "$archive" >/dev/null
' >/dev/null 2>&1

success_output="$WORK_DIR/success.out"
KSY_RESTORE_TEST_MODE=1 KSY_RESTORE_COMPOSE_PROJECT="$project" \
KSY_RESTORE_TEST_IMAGE="$image" KSY_ROOT="$install_root" \
  bash "$HARNESS" >"$success_output" 2>&1
grep -q '^KSY_RESTORE_ACCEPTED ' "$success_output" || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED RESTORE_SUCCESS_MISSING\n' >&2
  exit 1
}
[[ "$("${compose[@]}" exec -T db psql --username ksy_deals --dbname postgres \
  --no-psqlrc --tuples-only --no-align \
  --command "SELECT COUNT(*) FROM pg_database WHERE datname='ksy_deals_restore'")" == 0 ]] || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED RESTORE_DATABASE_REMAINS\n' >&2
  exit 1
}
[[ "$(source_snapshot)" == "$live_before" ]] || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED LIVE_CHANGED\n' >&2
  exit 1
}

corrupt_name=ksy-deals-20300101T010101Z.dump.gpg
printf 'not-openpgp' > "$backup_dir/$corrupt_name"
touch -t 203001010101 "$backup_dir/$corrupt_name"
corrupt_output="$WORK_DIR/corrupt.out"
if KSY_RESTORE_TEST_MODE=1 KSY_RESTORE_COMPOSE_PROJECT="$project" \
  KSY_RESTORE_TEST_IMAGE="$image" KSY_ROOT="$install_root" \
  bash "$HARNESS" >"$corrupt_output" 2>&1; then
  printf 'KSY_RESTORE_INTEGRATION_FAILED CORRUPT_BACKUP_ACCEPTED\n' >&2
  exit 1
fi
grep -q '^KSY_RESTORE_ACCEPT_FAILED DECRYPTION_FAILED$' "$corrupt_output" || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED CORRUPT_CLASSIFICATION_WRONG\n' >&2
  exit 1
}
[[ "$("${compose[@]}" exec -T db psql --username ksy_deals --dbname postgres \
  --no-psqlrc --tuples-only --no-align \
  --command "SELECT COUNT(*) FROM pg_database WHERE datname='ksy_deals_restore'")" == 0 ]] || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED CORRUPT_DATABASE_REMAINS\n' >&2
  exit 1
}
[[ "$(source_snapshot)" == "$live_before" ]] || {
  printf 'KSY_RESTORE_INTEGRATION_FAILED CORRUPT_CHANGED_LIVE\n' >&2
  exit 1
}
for output in "$success_output" "$corrupt_output"; do
  ! grep -Eiq 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|postgres(ql)?://' "$output" || {
    printf 'KSY_RESTORE_INTEGRATION_FAILED SECRET_LEAK\n' >&2
    exit 1
  }
done

printf 'KSY_RESTORE_INTEGRATION_PASSED success=PASS corrupt=DECRYPTION_FAILED cleanup=PASS liveStable=PASS\n'
