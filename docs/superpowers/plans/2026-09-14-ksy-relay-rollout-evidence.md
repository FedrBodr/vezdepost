# KSY Telegram relay rollout — 2026-09-14

Reviewed scripts: ops/ksy-staging commit c6545900 (script28 introduced in e5d4e509). Independent code/spec reviews passed after fixes for Node22 DNS lookup, boot-time FreeBind and Telegram's omitted allowed_updates default.

Validation: Node22.20.0, 14 Node tests pass; 7 Python installer tests pass. Vezdepost pnpm10.6.1 frozen installation and verify:workspace passed. KSY application code has a separate full pnpm10.15.1 check:1742passed,2skipped,106files,lint/typecheck pass.

Installed EU185.158.249.84:443 -> Timeweb201.51.7.50:443 through dedicated systemd socket/service. TLS remains on Timeweb. Script28 first run installed_verified; repeat on September14 returned already_verified. Socket enabled; service active, NRestarts=0, memory about1.5MB. Existing3proxy and WireGuard remained active. No DNS, app-image, DB, bot-token or file-storage changes.

Remote hashes verified before execution:
- script28:9207bfa3fdaac4da604b3b2967b74f01ea709a1b5fa7ee01a5ea83bea7db0b3c
- script29:d7c2e9a494f5320ba6c92b04d6565300f3c9c613b17f195ff2e60138717652c5

Timeweb -> relay HTTPS probe verified the normal certificate and returned200 in0.344seconds. Per-bot script29 preflight also checked invalid-secret403 and authenticated empty-update204 through the selected IP. No real messages were sent.

Order registration changed from201.51.7.50 to185.158.249.84 and was verified. A subsequent12:14:53UTC read showed pendingUpdateCount0,lastErrorAtnull. The first attempt before the optional-field fix refused safely without changing the registration.

Catalogue first mutation timed out. A separate status read at12:14:05UTC confirmed the original201.51.7.50 remained; only then was the reviewed operation retried. That operation verified185.158.249.84,pendingUpdateCount0,lastErrorAtnull.

Actual Telegram TCP connections to the relay were observed from91.108.5.4 and91.108.5.88. This establishes incoming connectivity, not measured human-message latency. No owner end-to-end conversation result has been received yet.

The script added only the three reviewed source rules. Broad80/443 allow rules appeared on the server outside this rollout and were preserved. Source-exclusive ingress cannot therefore be claimed; the relay has a fixed upstream and passes encrypted TLS only.

Rollback: on Timeweb run the staged script via docker exec -i ksy-deals-server-1 node - direct order (or catalogue), stdin /tmp/ksy-29-c654590.cjs. It verifies the original target and preserves pending updates. Then check status. Leave unused EU units in place until a separately reviewed removal.

KSY PR16 was merged at12:15UTC as ff33a031926108736eaea4407631a632867e2968. Monitoring endpoint, stable alerts and authenticated burst-limit fix await the normal application release; the owner confirmation required by README has been requested, not yet received. No release workflow was dispatched.

Follow-up: confirm live client/manager latency, monitor both queues/errors over time, and verify EU subscription renewal separately. A September11 Servinga expiry reminder was visible during an earlier read-only account search; current billing/renewal state was not verified and no payment was made.
