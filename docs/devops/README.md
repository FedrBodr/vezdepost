Project: vezdepost (Postiz fork on Timeweb VPS)
Document: devops-runbook-index

# DevOps runbooks — Timeweb VPS + Docker Compose apps

Portable, reusable DevOps knowledge for deploying and operating a Dockerized
app (Node/NestJS + pm2 + Postgres/Redis + Temporal, fronted by Caddy) on a
**Timeweb Cloud** VPS. Written from real production incidents — each file is a
self-contained runbook you can drag into another project's `docs/` and adapt.

## How to reuse in another project

1. Copy the whole `docs/devops/` folder into the new repo's `docs/`.
2. Update the `Project:` header line in each file.
3. Search for the concrete placeholders and swap them for the new project's
   values: server IP/host, SSH alias (`vezdepost`), domain (`vezdepost.ru`),
   container names (`postiz`, `temporal`, `caddy`, …), pm2 process names
   (`backend`/`frontend`/`orchestrator`), DB name/user.
4. The **provider-specific** gotchas in `timeweb-vps.md` apply to any app on
   Timeweb Cloud regardless of stack — keep them as-is.

> These are docs, not installed Claude Code skills. To turn one into an
> invocable skill later, add a `SKILL.md` with frontmatter (`name`,
> `description`) that points at the relevant runbook.

## Index

| File | What it covers |
|---|---|
| [`timeweb-vps.md`](./timeweb-vps.md) | **Provider quirks & fixes** — broken NIC offload, broken IPv6, **blocked outbound IPv4 to Telegram (WireGuard egress tunnel)**, DPI/IP filtering (swap the IP), Docker Hub 429 mirror, npm mirror for RF, serial-console paste mangling, reboot-resets-network. |
| [`access-and-secrets.md`](./access-and-secrets.md) | SSH alias + key access, SSH hardening (sshd drop-in ordering), fail2ban, git-over-HTTPS when the box key is another GitHub account, secrets handling, numbered server-scripts discipline. |
| [`deployment.md`](./deployment.md) | Compose stack layout, Caddy TLS + domains, **autodeploy** (poll → reset → build under flock, track last-successful rev), build-speed optimization (`.dockerignore`, digest pin, bind-mounts), startup-ordering race + reboot resilience. |
| [`diagnostics.md`](./diagnostics.md) | Troubleshooting playbook — the **startup-hang** family (backend/orchestrator/frontend), 502 → black-screen chain, post-state SQL, Temporal workflow/poller inspection, the process **watchdog**, and a copy-paste debug toolbox. |
| [`backups.md`](./backups.md) | **Encrypted offsite postgres backups** — `pg_dump → gzip → gpg (public key) → Backblaze B2`, cron + rotation, key management (private key off-server), and the tested **restore** procedure. |

## The one meta-rule

**State-changing server work goes through a numbered, self-contained script in
`docs/server-scripts/NN-name.sh`** (no secrets inside), run with
`ssh <host> 'bash -s' < docs/server-scripts/NN-name.sh`. It documents what was
done and stays rerunnable. Trivial read-only checks can run inline over SSH.
