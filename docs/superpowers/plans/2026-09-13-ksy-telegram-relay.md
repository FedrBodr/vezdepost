# KSY Telegram Relay Implementation Plan
> Execute task-by-task using TDD and independent review before live operations.

Goal: restore Telegram ingress through the existing Netherlands VPS.
Architecture: TCP443 relay, existing TLS and URLs, per-bot Telegram IP override.
Tech stack: Ubuntu24.04 systemd255, Python3 stdlib, Node22 built-ins.

## Global constraints
Read the companion spec. No DNS/DB/app migration, no secret logging, no update deletion, no messages to real users. Preserve existing EU services. Only reviewed numbered scripts mutate servers.

## Task 1: scripts and regression checks
- [ ] Add script28 Python installer and unittest: check exact host, active UFW, owned unit paths, free port; install dedicated units and three source ACLs; on failure roll back only created files/rules/service. An existing exact install is verified.
- [ ] Add script29 Node CLI and node:test: status/relay/direct for order/catalogue; get current registration, verify TLS relay endpoint, set fixed IP preserving all fields, reconcile with getWebhookInfo. Requests time out after10sec and expose only enum failures/counts.
- [x] Verified legacy script23 rejects a mature database before Telegram registration (INITIAL_DATABASE_NOT_EMPTY); script27 does not register webhooks. Do not run bootstrap on this live database. A future separately approved registration must explicitly retain the relay IP.
- [ ] Run RED before implementation, GREEN afterward, independent review.

## Task 2: bounded rollout
- [ ] Commit reviewed scripts to ops/ksy-staging, stage by SHA, verify remote hashes.
- [ ] Install relay, verify units, TLS, readiness, invalid and empty authenticated webhook probes without sending messages.
- [ ] Switch order, read queue/error before and after; switch catalogue after order transport confirms.
- [ ] Observe subsequent queue/error checks and owner live relay. Restore old IP if route fails.
- [ ] Record evidence and maintenance/rollback in KSY runbook. Release monitoring through its normal workflow once authorized.
