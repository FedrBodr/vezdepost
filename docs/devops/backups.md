Project: vezdepost (Postiz fork on Timeweb VPS)
Document: devops-runbook-backups

# Encrypted offsite postgres backups

Daily `pg_dump` → gzip → **GPG public-key encryption** → **Backblaze B2**, with
rotation and a tested restore path. The design goal: a server compromise must
not expose backup contents, so the server holds only the **public** key (can
encrypt, cannot decrypt); only the operator's off-server **private** key restores.

---

## What runs where

| Piece | Location |
|---|---|
| Backup script | `/root/vezdepost-pg-backup.sh` |
| Cron (daily 03:17 UTC) | `/etc/cron.d/vezdepost-pg-backup` |
| B2 credentials (untracked, chmod 600) | `/root/vezdepost-backup.env` |
| Local dumps (rotation: keep 7) | `/var/backups/vezdepost-pg/` |
| Remote dumps (rotation: prune >90d) | Backblaze B2 bucket `vezdepost-pg-backups` |
| GPG public key (isolated keyring) | `/root/.gnupg-backup` |
| Log (writes per run) | `/var/log/vezdepost-pg-backup.log` |
| Installer (rerunnable, embeds pubkey) | `docs/server-scripts/11-install-pg-backup.sh` |

Pipeline: `docker exec postiz-postgres pg_dump -U postiz-user postiz-db-local | gzip -9 | gpg --encrypt --trust-model always -r <FPR> → file.sql.gz.gpg`, then `rclone copy → B2`. rclone uses **env-var config** (`RCLONE_CONFIG_B2_*`), no `rclone.conf`; the native `b2` backend needs only keyID + applicationKey.

---

## Key management (critical)

- **Private key is OFF-server.** It lives in the operator's local `~/.gnupg`
  keyring (+ a copy in a password manager). It is the **only** way to decrypt
  backups — lose it and every backup is unrecoverable.
- The server has only the exported **public** key. Re-export the private key any
  time from the operator machine: `gpg --armor --export-secret-keys <FPR>`.
- Recipient fingerprint for this project: `1A3706CD43FC2FD7DAEA0C344D017F8E5B60A6BD`.
- Generate a fresh pair (portable): `gpg --batch --gen-key` with a params file
  (`%no-protection`, `Key-Type: RSA`, `Key-Length: 4096`, `Expire-Date: 0`).
  ⚠️ Generating in a very long `GNUPGHOME` path fails on macOS (`gpg-agent`
  socket path exceeds the ~104-char limit) — generate into the default keyring
  or a short path.

---

## Restore (needs the private key)

**Restore into the live DB** (⚠️ overwrites — usually restore into a throwaway
DB first and inspect):

```bash
gpg --decrypt postiz-db-YYYYMMDDT......Z.sql.gz.gpg \
  | gunzip \
  | docker exec -i postiz-postgres psql -U postiz-user -d postiz-db-local
```

**Safe restore + verify into a throwaway DB** (what the test below does):

```bash
# 1. get an encrypted dump (local dir, or pull from B2 — see below)
# 2. create a scratch DB and restore
docker exec postiz-postgres psql -U postiz-user -d postgres \
  -c 'CREATE DATABASE restore_test OWNER "postiz-user";'
gpg -d file.sql.gz.gpg | gunzip \
  | docker exec -i postiz-postgres psql -q -v ON_ERROR_STOP=1 -U postiz-user -d restore_test
# 3. sanity-check row counts vs production, then drop
docker exec postiz-postgres psql -U postiz-user -d restore_test -c 'select count(*) from "Post";'
docker exec postiz-postgres psql -U postiz-user -d postgres -c 'DROP DATABASE restore_test;'
```

**Pull a specific backup from B2** (creds from the env file, never echoed):

```bash
set -a; . /root/vezdepost-backup.env; set +a
export RCLONE_CONFIG_B2_TYPE=b2 RCLONE_CONFIG_B2_ACCOUNT="$B2_ACCOUNT_ID" RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
rclone ls   "B2:$B2_BUCKET/"                 # list
rclone copy "B2:$B2_BUCKET/<file>" ./restore/  # download one
```

> The decrypt step must run where the **private** key is (operator machine),
> not on the server. Stream the encrypted file to that machine, decrypt, and
> pipe the SQL back into the target DB.

**Verified end-to-end (2026-07-12):** dump → B2 upload → B2 download → decrypt →
restore into a throwaway DB, row counts matched production exactly. A backup you
have not test-restored is not a backup — re-run the throwaway-restore test after
any change to the pipeline.

---

## Operate

```bash
# run a backup now
/root/vezdepost-pg-backup.sh; tail -5 /var/log/vezdepost-pg-backup.log

# set / rotate B2 creds (in your OWN terminal, keeps the secret off chat/history)
ssh vezdepost 'nano /root/vezdepost-backup.env'   # fill B2_ACCOUNT_ID / B2_APP_KEY
```

If `B2_APP_KEY` is still the placeholder, the script keeps the dump **local only**
and logs "skipped upload" — it never fails the run for a missing offsite target.

---

## Hardening backlog (not yet done)

- **Passphrase on the backup private key** (currently none) — makes a leaked key
  file (e.g. the copy in Telegram saved-messages, which is not E2E) useless
  without the passphrase: `gpg --edit-key <FPR>` → `passwd` → re-export → replace copies.
- **B2 write-only / object-lock** — the server's B2 key is read+write, so a
  server compromise could delete remote backups (it still can't read them).
  Mitigate with a write-only application key + a bucket lifecycle rule for the
  >90d prune (server-side), or B2 Object Lock for ransomware protection.
- **Second offsite** (e.g. a periodic pull to another machine) for provider
  independence.
