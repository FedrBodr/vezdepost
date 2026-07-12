#!/usr/bin/env bash
# 11-install-pg-backup.sh
#
# Installs encrypted, offsite postgres backups for Vezdepost:
#   pg_dump (postiz-db-local) | gzip -9 | gpg --encrypt (PUBLIC key) -> local file
#   -> rclone copy to Backblaze B2 -> rotation (local keep N, remote keep N days)
#   -> cron daily.
#
# Security model: the server holds only the PUBLIC GPG key, so it can encrypt
# but NOT decrypt. Only the operator's private key (kept off-server) can restore.
# B2 credentials live in an untracked /root/vezdepost-backup.env (chmod 600),
# filled by the operator — never in this script or in chat.
#
# Idempotent. Run: ssh vezdepost 'bash -s' < docs/server-scripts/11-install-pg-backup.sh
set -euo pipefail

GPG_HOME=/root/.gnupg-backup
GPG_RECIPIENT=1A3706CD43FC2FD7DAEA0C344D017F8E5B60A6BD
SCRIPT=/root/vezdepost-pg-backup.sh
ENVFILE=/root/vezdepost-backup.env
CRON=/etc/cron.d/vezdepost-pg-backup
LOG=/var/log/vezdepost-pg-backup.log
LOCAL_DIR=/var/backups/vezdepost-pg

echo "=== 1. rclone ==="
if ! command -v rclone >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq rclone || { curl -fsSL https://rclone.org/install.sh | bash; }
fi
rclone version | head -1

echo "=== 2. import PUBLIC gpg key into isolated keyring ==="
mkdir -p -m 700 "$GPG_HOME"
cat > /root/vezdepost-backup-pub.asc <<'PUBKEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

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
pdxdt3LwNtrWEWIChMHz
=ngsU
-----END PGP PUBLIC KEY BLOCK-----
PUBKEY
GNUPGHOME="$GPG_HOME" gpg --import /root/vezdepost-backup-pub.asc 2>&1 | grep -iE "imported|not changed" || true
GNUPGHOME="$GPG_HOME" gpg --list-keys --keyid-format long "$GPG_RECIPIENT" | grep -E "pub|uid"

echo "=== 3. B2 creds env file (placeholders; NOT overwritten if present) ==="
if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<'EOF'
# Backblaze B2 credentials for postgres backups. Fill B2_ACCOUNT_ID and
# B2_APP_KEY (chmod 600, untracked, never commit). Bucket already set.
B2_ACCOUNT_ID=REPLACE_WITH_KEY_ID
B2_APP_KEY=REPLACE_WITH_APP_KEY
B2_BUCKET=vezdepost-pg-backups
EOF
  chmod 600 "$ENVFILE"
  echo "created $ENVFILE (placeholders — fill on server)"
else
  echo "$ENVFILE already exists — left untouched"
fi

echo "=== 4. backup script -> $SCRIPT ==="
cat > "$SCRIPT" <<'BK'
#!/usr/bin/env bash
# Encrypted offsite postgres backup. Installed by 11-install-pg-backup.sh.
set -euo pipefail
ENVFILE=/root/vezdepost-backup.env
GPG_HOME=/root/.gnupg-backup
GPG_RECIPIENT=1A3706CD43FC2FD7DAEA0C344D017F8E5B60A6BD
LOCAL_DIR=/var/backups/vezdepost-pg
LOCAL_KEEP=7
REMOTE_KEEP_DAYS=90
LOG=/var/log/vezdepost-pg-backup.log
DB_CONTAINER=postiz-postgres
DB_USER=postiz-user
DB_NAME=postiz-db-local

log(){ echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
# shellcheck disable=SC1090
. "$ENVFILE"

TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="postiz-db-${TS}.sql.gz.gpg"
mkdir -p "$LOCAL_DIR"

# 1. dump -> gzip -> encrypt with PUBLIC key. pipefail catches pg_dump/gzip failure.
if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
      | gzip -9 \
      | GNUPGHOME="$GPG_HOME" gpg --batch --yes --encrypt --trust-model always \
          --recipient "$GPG_RECIPIENT" --output "$LOCAL_DIR/$FILE"; then
  log "ERROR: dump/encrypt failed for $FILE"; rm -f "$LOCAL_DIR/$FILE"; exit 1
fi
[ -s "$LOCAL_DIR/$FILE" ] || { log "ERROR: empty backup $FILE"; rm -f "$LOCAL_DIR/$FILE"; exit 1; }
log "created $FILE ($(stat -c%s "$LOCAL_DIR/$FILE") bytes)"

# 2. upload to Backblaze B2 (skip cleanly if creds not filled yet)
if [ "${B2_APP_KEY:-}" = "REPLACE_WITH_APP_KEY" ] || [ -z "${B2_APP_KEY:-}" ]; then
  log "B2 creds not set — kept LOCAL only, skipped upload"
else
  export RCLONE_CONFIG_B2_TYPE=b2
  export RCLONE_CONFIG_B2_ACCOUNT="$B2_ACCOUNT_ID"
  export RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
  if rclone copy "$LOCAL_DIR/$FILE" "B2:$B2_BUCKET/" --no-traverse >>"$LOG" 2>&1; then
    log "uploaded $FILE -> B2:$B2_BUCKET"
    rclone delete "B2:$B2_BUCKET/" --min-age "${REMOTE_KEEP_DAYS}d" >>"$LOG" 2>&1 \
      && log "remote prune ok (>${REMOTE_KEEP_DAYS}d)" || log "WARN: remote prune failed"
  else
    log "ERROR: upload failed for $FILE (kept local)"; exit 1
  fi
fi

# 3. local rotation — keep newest LOCAL_KEEP
ls -1t "$LOCAL_DIR"/postiz-db-*.sql.gz.gpg 2>/dev/null | tail -n +$((LOCAL_KEEP+1)) | xargs -r rm -f
log "done $FILE"
BK
chmod 700 "$SCRIPT"

echo "=== 5. cron (daily 03:17 UTC) ==="
cat > "$CRON" <<CRONF
# Vezdepost postgres backup — daily encrypted dump -> Backblaze B2
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root $SCRIPT
CRONF
chmod 644 "$CRON"
touch "$LOG"; chmod 640 "$LOG"

echo "=== 6. test run now (local-only until B2 creds are filled) ==="
"$SCRIPT" || true
echo "--- backups on disk ---"; ls -lh "$LOCAL_DIR" 2>/dev/null | tail -3
echo "--- log tail ---"; tail -4 "$LOG"
echo
echo "NEXT: fill B2 creds in $ENVFILE (B2_ACCOUNT_ID, B2_APP_KEY), then rerun $SCRIPT."
