# Tumblr Production OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the existing Tumblr provider in production Vezdepost and complete a non-publishing OAuth connection to a test Tumblr blog.

**Architecture:** Add one tested, numbered operations script that accepts credentials through hidden TTY prompts, backs up and updates the server-only `.env` and production Compose override, validates Compose, and recreates only `postiz`. After runtime readiness is proven, use the normal Vezdepost Tumblr OAuth flow to list and connect a blog without publishing content.

**Tech Stack:** Bash, Docker Compose, PostgreSQL, Temporal CLI, Tumblr OAuth 2, Orca built-in browser

## Global Constraints

- Never print, commit, log, or paste `TUMBLR_CLIENT_SECRET` or production `.env` contents.
- Report credential status only as `задана` or `отсутствует`.
- Preserve unrelated tracked and untracked files.
- Back up `.env` and `docker-compose.override.yaml` before mutation.
- Recreate only `postiz`; do not rebuild the image or restart the full stack.
- Use callback `https://app.vezdepost.ru/integrations/social/tumblr` exactly.
- Do not publish a public Tumblr post without explicit approval.
- Prefix every operator shell command with `rtk`.

---

### Task 1: Tested production configuration script

**Files:**
- Create: `docs/server-scripts/16-configure-tumblr.sh`
- Create: `docs/server-scripts/16-configure-tumblr.spec.sh`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: hidden `TUMBLR_CLIENT_ID_INPUT` and `TUMBLR_CLIENT_SECRET_INPUT` values, or interactive `/dev/tty` input when the variables are absent.
- Produces: non-empty `TUMBLR_CLIENT_ID` and `TUMBLR_CLIENT_SECRET` in server `.env` and the running `postiz` environment, plus timestamped backups of both mutated files.

- [ ] **Step 1: Write the failing shell test**

Create `docs/server-scripts/16-configure-tumblr.spec.sh` with test cases that:

1. Build a temporary repo containing `.env` and a representative Compose override.
2. Stub `docker` and `curl` while recording invocations.
3. Run the configuration script using test-only input variables.
4. Assert single, non-empty definitions in `.env`, required Compose interpolation, owner-only `.env` mode, two backups, preservation of unrelated values, and absence of credentials from output.
5. Assert invalid empty input causes no file mutation or Docker invocation.
6. Assert the deployment documentation uses `scp` followed by interactive `ssh -tt`, not stdin script transport.

The test must invoke the script as:

```bash
PATH="$bin_dir:$PATH" \
DOCKER_CALLS="$docker_calls" \
REPO_DIR="$repo" \
TUMBLR_CLIENT_ID_INPUT='test-client-id' \
TUMBLR_CLIENT_SECRET_INPUT='test-client-secret' \
SKIP_RUNTIME_READINESS=1 \
bash "$SCRIPT" > "$output_file" 2>&1
```

Required assertions:

```bash
assert_eq '1' "$(grep -c '^TUMBLR_CLIENT_ID=' "$repo/.env")" 'client ID must have one definition'
assert_eq '1' "$(grep -c '^TUMBLR_CLIENT_SECRET=' "$repo/.env")" 'client secret must have one definition'
grep -Fq "TUMBLR_CLIENT_ID: '\${TUMBLR_CLIENT_ID:?set in .env}'" "$repo/docker-compose.override.yaml"
grep -Fq "TUMBLR_CLIENT_SECRET: '\${TUMBLR_CLIENT_SECRET:?set in .env}'" "$repo/docker-compose.override.yaml"
assert_eq '600' "$(file_mode "$repo/.env")" '.env must remain owner-readable only'
[[ "$(find "$repo" -maxdepth 1 -name '.env.tumblr-backup.*' | wc -l | tr -d ' ')" == 1 ]]
[[ "$(find "$repo" -maxdepth 1 -name 'docker-compose.override.yaml.tumblr-backup.*' | wc -l | tr -d ' ')" == 1 ]]
! grep -Fq 'test-client-id' "$output_file"
! grep -Fq 'test-client-secret' "$output_file"
grep -q '^compose config --quiet$' "$docker_calls"
grep -q '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls"
```

- [ ] **Step 2: Run the test and confirm the missing-script failure**

Run:

```bash
rtk bash docs/server-scripts/16-configure-tumblr.spec.sh
```

Expected: non-zero exit because `16-configure-tumblr.sh` does not exist.

- [ ] **Step 3: Implement the production script**

Create `docs/server-scripts/16-configure-tumblr.sh` with these exact behaviors:

```bash
#!/usr/bin/env bash
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
  IFS= read -r -s value < /dev/tty
  printf '\n' > /dev/tty
  printf -v "$target" '%s' "$value"
}

[[ -n "$client_id" ]] || read_hidden 'Tumblr OAuth Consumer Key' client_id
[[ -n "$client_secret" ]] || read_hidden 'Tumblr secret key' client_secret

if [[ -z "$client_id" || -z "$client_secret" || "$client_id" == *$'\n'* || "$client_secret" == *$'\n'* ]]; then
  echo 'Tumblr credentials must be non-empty single-line values' >&2
  exit 2
fi

for path in "$REPO_DIR" "$ENV_FILE" "$COMPOSE_OVERRIDE"; do
  [[ -e "$path" ]] || { echo "Required path not found: $path" >&2; exit 1; }
done

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
env_backup="$ENV_FILE.tumblr-backup.$timestamp"
override_backup="$COMPOSE_OVERRIDE.tumblr-backup.$timestamp"
umask 077
cp -p "$ENV_FILE" "$env_backup"
cp -p "$COMPOSE_OVERRIDE" "$override_backup"

env_tmp=$(mktemp "$REPO_DIR/.env.tumblr.XXXXXX")
override_tmp=$(mktemp "$REPO_DIR/.compose-tumblr.XXXXXX")
rollback=1
cleanup() {
  local status=$?
  rm -f "$env_tmp" "$override_tmp"
  if [[ "$status" -ne 0 && "$rollback" -eq 1 ]]; then
    cp -p "$env_backup" "$ENV_FILE"
    cp -p "$override_backup" "$COMPOSE_OVERRIDE"
    echo 'Configuration validation failed; original files restored' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

awk -v client_id="$client_id" -v client_secret="$client_secret" '
  BEGIN { id_written=0; secret_written=0 }
  /^TUMBLR_CLIENT_ID=/ {
    if (!id_written) { print "TUMBLR_CLIENT_ID=" client_id; id_written=1 }
    next
  }
  /^TUMBLR_CLIENT_SECRET=/ {
    if (!secret_written) { print "TUMBLR_CLIENT_SECRET=" client_secret; secret_written=1 }
    next
  }
  { print }
  END {
    if (!id_written) print "TUMBLR_CLIENT_ID=" client_id
    if (!secret_written) print "TUMBLR_CLIENT_SECRET=" client_secret
  }
' "$ENV_FILE" > "$env_tmp"
chmod 600 "$env_tmp"
mv "$env_tmp" "$ENV_FILE"

awk '
  /^[[:space:]]+TUMBLR_CLIENT_ID:/ { next }
  /^[[:space:]]+TUMBLR_CLIENT_SECRET:/ { next }
  { print }
  /^[[:space:]]+LINKEDIN_CLIENT_SECRET:/ {
    print "      TUMBLR_CLIENT_ID: '\''${TUMBLR_CLIENT_ID:?set in .env}'\''"
    print "      TUMBLR_CLIENT_SECRET: '\''${TUMBLR_CLIENT_SECRET:?set in .env}'\''"
  }
' "$COMPOSE_OVERRIDE" > "$override_tmp"

[[ "$(grep -c '^[[:space:]]*TUMBLR_CLIENT_ID:' "$override_tmp")" -eq 1 ]]
[[ "$(grep -c '^[[:space:]]*TUMBLR_CLIENT_SECRET:' "$override_tmp")" -eq 1 ]]
chmod --reference="$COMPOSE_OVERRIDE" "$override_tmp" 2>/dev/null || true
mv "$override_tmp" "$COMPOSE_OVERRIDE"

cd "$REPO_DIR"
docker compose config --quiet
rollback=0
unset client_id client_secret TUMBLR_CLIENT_ID_INPUT TUMBLR_CLIENT_SECRET_INPUT
docker compose up -d --no-deps --force-recreate postiz

docker exec postiz sh -lc 'test -n "${TUMBLR_CLIENT_ID:-}" && test -n "${TUMBLR_CLIENT_SECRET:-}"'

if [[ "${SKIP_RUNTIME_READINESS:-0}" != 1 ]]; then
  ready=0
  for _ in $(seq 1 60); do
    if docker exec postiz sh -c '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :3000' &&
       docker exec postiz sh -c '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :4200' &&
       docker exec postiz sh -c '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :5000'; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ "$ready" -eq 1 ]] || { echo 'postiz readiness ports did not become available' >&2; exit 1; }

  http_code=$(curl -sS -o /dev/null -w '%{http_code}' https://app.vezdepost.ru/api/user/self)
  [[ "$http_code" != 502 && "$http_code" != 000 ]] || { echo "Public API readiness failed: HTTP $http_code" >&2; exit 1; }

  docker exec temporal-admin-tools temporal task-queue describe \
    --task-queue main --task-queue-type workflow --address temporal:7233 |
    grep -Eq 'Identity|@'
fi

trap - EXIT
echo "Tumblr configuration applied; backups: $(basename "$env_backup"), $(basename "$override_backup")"
```

- [ ] **Step 4: Document the safe interactive invocation**

Append a Tumblr section to `deploy/README.md` containing:

```bash
scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/16-configure-tumblr.sh \
  vezdepost:/tmp/vezdepost-configure-tumblr.sh
ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'status=0; bash /tmp/vezdepost-configure-tumblr.sh || status=$?; rm -f /tmp/vezdepost-configure-tumblr.sh; exit "$status"'
```

Document the exact callback and state that the prompts are hidden and no credentials should be pasted into chat.

- [ ] **Step 5: Run the tests and static checks**

Run:

```bash
rtk bash docs/server-scripts/16-configure-tumblr.spec.sh
rtk bash -n docs/server-scripts/16-configure-tumblr.sh
rtk git diff --check
```

Expected: test prints `Tumblr configuration script tests passed`; both other commands exit 0.

- [ ] **Step 6: Commit the reviewed operations change**

```bash
rtk git add docs/server-scripts/16-configure-tumblr.sh \
  docs/server-scripts/16-configure-tumblr.spec.sh deploy/README.md
rtk git commit -m 'ops: configure Tumblr production OAuth'
```

### Task 2: Apply production configuration and verify runtime

**Files:**
- Execute: `docs/server-scripts/16-configure-tumblr.sh`
- Mutate on server only: `/root/postiz-app/.env`
- Mutate on server only: `/root/postiz-app/docker-compose.override.yaml`

**Interfaces:**
- Consumes: Tumblr OAuth Consumer Key and secret key entered by the operator.
- Produces: Tumblr credentials available to the running `postiz` service and verified application readiness.

- [ ] **Step 1: Copy and run the guarded script**

Run the documented `scp` and `ssh -tt` commands. The user enters both credentials directly into the hidden prompts.

Expected: the script reports only successful status and backup filenames; no credential values appear.

- [ ] **Step 2: Independently verify minimal runtime impact**

```bash
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost '
  cd /root/postiz-app &&
  docker compose ps --format "table {{.Name}}\t{{.State}}\t{{.Status}}" &&
  for v in TUMBLR_CLIENT_ID TUMBLR_CLIENT_SECRET; do
    if docker exec postiz sh -c "test -n \"\$(printenv $v)\""; then
      echo "$v=задана"
    else
      echo "$v=отсутствует"
    fi
  done'
```

Expected: all services remain running; both statuses are `задана`.

### Task 3: Complete Tumblr OAuth without publishing

**Files:**
- No repository or server file mutation beyond normal encrypted Integration storage.

**Interfaces:**
- Consumes: the production Vezdepost account session and the Tumblr account's OAuth approval.
- Produces: a visible `tumblr` Integration for the selected test blog.

- [ ] **Step 1: Open production Integrations and select Tumblr**

Use the Orca built-in browser to open `https://app.vezdepost.ru/launches`, choose Add Channel, then Tumblr.

Expected: redirect to `https://www.tumblr.com/oauth2/authorize` with callback `https://app.vezdepost.ru/integrations/social/tumblr`.

- [ ] **Step 2: Approve Tumblr OAuth**

The user approves the requested `write` and `offline_access` access. Stop for any account login, 2FA, or CAPTCHA.

Expected: redirect back to Vezdepost and a list of blogs accessible to the authorized Tumblr account.

- [ ] **Step 3: Select the test blog and verify Integration storage safely**

Select the intended test blog, then verify only non-secret metadata:

```bash
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'docker exec postiz-postgres psql -U postiz-user -d postiz-db-local -P pager=off -c "select \"providerIdentifier\", name, disabled, \"refreshNeeded\", \"tokenExpiration\" from \"Integration\" where \"providerIdentifier\"='\''tumblr'\'' and \"deletedAt\" is null order by \"createdAt\" desc limit 5;"'
```

Expected: one active `tumblr` row for the selected blog, `disabled=false`, and `refreshNeeded=false`.

- [ ] **Step 4: Create but do not publish a draft**

Create a draft in Vezdepost with a short text and one image, ensure Tumblr validation passes, and leave it unpublished.

Expected: draft is saved; no Tumblr public URL is created and no public Tumblr post appears.

