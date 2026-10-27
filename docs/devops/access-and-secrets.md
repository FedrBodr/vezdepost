Project: vezdepost (Postiz fork on Timeweb VPS)
Document: devops-runbook-access-secrets

# Access, SSH, git & secrets

How connections and access are set up, and the rules for handling secrets.
Swap placeholders (`vezdepost`, `<IP>`, key path) for the target project.

---

## SSH — key-based alias

`~/.ssh/config` on the operator machine:

```
Host vezdepost
    HostName <IP>
    User root
    IdentityFile ~/.ssh/vezdepost_ed25519
    IdentitiesOnly yes
```

- Connect: `ssh vezdepost`.
- **Always add `-o BatchMode=yes -o ConnectTimeout=10`** in scripts/automation
  so a missing key or prompt fails fast instead of hanging.
- Run a server script without copying it up:
  `ssh vezdepost 'bash -s' < docs/server-scripts/NN-name.sh`.

---

## SSH hardening

- Disable password auth via a **drop-in** file, not by editing the main
  `sshd_config`:

  ```
  # /etc/ssh/sshd_config.d/00-hardening.conf
  PasswordAuthentication no
  PermitRootLogin prohibit-password
  ```

  ⚠️ **Filename ordering is load-bearing.** sshd reads drop-ins in lexical
  order and **first value wins**. Cloud images ship `50-cloud-init.conf` which
  often re-enables password auth — your file must sort **before** it, hence the
  `00-` prefix. Verify: `sshd -T | grep -i passwordauth` → `passwordauthentication no`.

- `fail2ban` for brute-force protection (default sshd jail is enough).
- **Keep the panel/web console as the emergency fallback** if the key is lost.
- After hardening, re-test `ssh vezdepost` in a **separate** session before
  closing your current one.

---

## Git access from the operator machine

Gotcha: the machine's default SSH key may belong to a **different GitHub
account** than the repo owner. Two clean options:

- **HTTPS + `gh`**: set the remote to `https://github.com/<owner>/<repo>.git`
  and let `gh` provide credentials. Ensure the `gh` token has the **`workflow`
  scope** if you need to push changes under `.github/workflows/`.
- Or add a repo-scoped deploy key / a per-host `IdentityFile` in `~/.ssh/config`.

Branch-protected deploy branch (`prod`): owner can push directly; others need a
PR. Never force-push a shared deploy branch.

---

## Secrets — never in chat, never in the image

- **Never echo tokens/secrets into terminal output or chat.** Mask them or keep
  them server-side.
- Secrets live in an **untracked** `.env` on the server, `chmod 600`. The
  tracked compose file / override references them as `${VAR}`; the real values
  are only in `.env`.
- Put `.env` in **both** `.gitignore` and `.dockerignore` so it never enters a
  commit or the build context.
- If a secret ever leaks into git history: purge with `git filter-branch` /
  `git filter-repo`, force-push to **every** remote, then **rotate the secret**
  at its source (the purge alone is not enough — assume it's compromised).

---

## Server-ops discipline (the meta-rule)

- **State-changing work → a numbered script** in `docs/server-scripts/NN-name.sh`:
  self-contained, idempotent/rerunnable, **no secrets inside**, read-only checks
  first. Run it with `ssh <host> 'bash -s' < …`. The script is the record of
  what was done and lets anyone reproduce it.
- **Trivial read-only checks** (status, logs, `docker ps`) can run inline over
  SSH without a script.
- Don't confuse the server with a **local** Docker stack — if you run the same
  app locally in Docker Desktop, it's easy to point a fix at the wrong one.
  Double-check the SSH target / `docker context`.
