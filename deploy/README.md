# Deploy (prod-only)

Server: 201.51.7.50 (`~/postiz-app`, branch `prod`).

- `autodeploy.sh` — polls `origin/prod` every 3 minutes (cron `/etc/cron.d/vezdepost-autodeploy`), on new commits: `git reset --hard` + `docker compose up -d --build`. Log: `/var/log/vezdepost-autodeploy.log`.
- `docker-compose.override.yaml` (repo root, tracked in prod only) — server config; secrets come from untracked `.env` (`JWT_SECRET`, `TELEGRAM_TOKEN`, `MAX_TOKEN`).
- `wait-temporal.js` (repo root) — gates app startup until temporal accepts connections.
- Temporal UI: `ssh -L 8080:127.0.0.1:8080 root@201.51.7.50` → http://localhost:8080

This directory lives only on the `prod` branch — do not merge it into `main`.
