#!/usr/bin/env bash
# Configure Tumblr OAuth credentials for Vezdepost production.
#
# Idempotent. The script never prints credentials or .env contents.
# Copy it to the server first, then execute it through `ssh -tt` so the
# credentials can be entered at hidden prompts without using chat or stdin.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
COMPOSE_OVERRIDE="$REPO_DIR/docker-compose.override.yaml"
client_id=${TUMBLR_CLIENT_ID_INPUT:-}
client_secret=${TUMBLR_CLIENT_SECRET_INPUT:-}

read_hidden() {
  local prompt=$1
  local target=$2
  local value

  printf '%s: ' "$prompt" > /dev/tty
  if ! IFS= read -r -s value < /dev/tty; then
    printf '\nUnable to read Tumblr credentials\n' > /dev/tty
    exit 1
  fi
  printf '\n' > /dev/tty
  printf -v "$target" '%s' "$value"
}

[[ -n "$client_id" ]] || read_hidden 'Tumblr OAuth Consumer Key' client_id
[[ -n "$client_secret" ]] || read_hidden 'Tumblr secret key' client_secret

if [[ -z "$client_id" || -z "$client_secret" ||
      "$client_id" == *$'\n'* || "$client_secret" == *$'\n'* ]]; then
  echo 'Tumblr credentials must be non-empty single-line values' >&2
  exit 2
fi

[[ -d "$REPO_DIR" ]] || {
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
}
[[ -f "$ENV_FILE" ]] || {
  echo "Required file not found: $ENV_FILE" >&2
  exit 1
}
[[ -f "$COMPOSE_OVERRIDE" ]] || {
  echo "Required file not found: $COMPOSE_OVERRIDE" >&2
  exit 1
}

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
env_backup="$ENV_FILE.tumblr-backup.$timestamp"
override_backup="$COMPOSE_OVERRIDE.tumblr-backup.$timestamp"
umask 077
cp -p "$ENV_FILE" "$env_backup"
chmod 600 "$env_backup"
cp -p "$COMPOSE_OVERRIDE" "$override_backup"

env_tmp=$(mktemp "$REPO_DIR/.env.tumblr.XXXXXX")
override_tmp=$(mktemp "$REPO_DIR/.compose-tumblr.XXXXXX")
rollback=1

cleanup() {
  local status=$?
  trap - EXIT
  rm -f "$env_tmp" "$override_tmp"
  if [[ "$status" -ne 0 && "$rollback" -eq 1 ]]; then
    cp -p "$env_backup" "$ENV_FILE"
    cp -p "$override_backup" "$COMPOSE_OVERRIDE"
    echo 'Configuration validation failed; original files restored' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

id_written=0
secret_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    TUMBLR_CLIENT_ID=*)
      if [[ "$id_written" -eq 0 ]]; then
        printf 'TUMBLR_CLIENT_ID=%s\n' "$client_id"
        id_written=1
      fi
      ;;
    TUMBLR_CLIENT_SECRET=*)
      if [[ "$secret_written" -eq 0 ]]; then
        printf 'TUMBLR_CLIENT_SECRET=%s\n' "$client_secret"
        secret_written=1
      fi
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$ENV_FILE" > "$env_tmp"

if [[ "$id_written" -eq 0 ]]; then
  printf 'TUMBLR_CLIENT_ID=%s\n' "$client_id" >> "$env_tmp"
fi
if [[ "$secret_written" -eq 0 ]]; then
  printf 'TUMBLR_CLIENT_SECRET=%s\n' "$client_secret" >> "$env_tmp"
fi
chmod 600 "$env_tmp"
mv "$env_tmp" "$ENV_FILE"

override_mode=$(stat -c '%a' "$COMPOSE_OVERRIDE" 2>/dev/null || stat -f '%Lp' "$COMPOSE_OVERRIDE")
insertion_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    *TUMBLR_CLIENT_ID:*|*TUMBLR_CLIENT_SECRET:*)
      continue
      ;;
  esac

  printf '%s\n' "$line"
  case "$line" in
    *LINKEDIN_CLIENT_SECRET:*)
      printf "      TUMBLR_CLIENT_ID: '\${TUMBLR_CLIENT_ID:?set in .env}'\n"
      printf "      TUMBLR_CLIENT_SECRET: '\${TUMBLR_CLIENT_SECRET:?set in .env}'\n"
      insertion_written=1
      ;;
  esac
done < "$COMPOSE_OVERRIDE" > "$override_tmp"

[[ "$insertion_written" -eq 1 ]] || {
  echo 'Compose insertion anchor LINKEDIN_CLIENT_SECRET was not found' >&2
  exit 1
}
[[ "$(grep -c '^[[:space:]]*TUMBLR_CLIENT_ID:' "$override_tmp")" -eq 1 ]]
[[ "$(grep -c '^[[:space:]]*TUMBLR_CLIENT_SECRET:' "$override_tmp")" -eq 1 ]]
chmod "$override_mode" "$override_tmp"
mv "$override_tmp" "$COMPOSE_OVERRIDE"

cd "$REPO_DIR"
docker compose config --quiet
rollback=0
unset client_id client_secret TUMBLR_CLIENT_ID_INPUT TUMBLR_CLIENT_SECRET_INPUT

docker compose up -d --no-deps --force-recreate postiz
docker exec postiz sh -lc \
  'test -n "${TUMBLR_CLIENT_ID:-}" && test -n "${TUMBLR_CLIENT_SECRET:-}"'

if [[ "${SKIP_RUNTIME_READINESS:-0}" != 1 ]]; then
  ready=0
  for _ in $(seq 1 60); do
    if docker exec postiz sh -c \
         '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :3000' &&
       docker exec postiz sh -c \
         '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :4200' &&
       docker exec postiz sh -c \
         '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :5000'; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ "$ready" -eq 1 ]] || {
    echo 'postiz readiness ports did not become available' >&2
    exit 1
  }

  http_code=$(curl -sS -o /dev/null -w '%{http_code}' \
    https://app.vezdepost.ru/api/user/self)
  [[ "$http_code" != 502 && "$http_code" != 000 ]] || {
    echo "Public API readiness failed: HTTP $http_code" >&2
    exit 1
  }

  docker exec temporal-admin-tools temporal task-queue describe \
    --task-queue main --task-queue-type workflow --address temporal:7233 |
    grep -Eq 'Identity|@'
fi

trap - EXIT
echo "Tumblr configuration applied; backups: $(basename "$env_backup"), $(basename "$override_backup")"
