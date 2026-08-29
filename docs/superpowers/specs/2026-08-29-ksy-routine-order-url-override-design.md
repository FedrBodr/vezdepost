# KSY routine order URL override design

## Context

The KSY image built from `014af82` is healthy and its site CTA route records
`SITE_CTA_CLICK`, but production routine deployment preserved an older
`ORDER_TELEGRAM_URL`. The approved product acceptance requires
`/r/site/order_site_hero` to redirect to
`https://t.me/ksy_deals_store_bot?start=order_site_hero`.

The existing routine path in reviewed script 20 intentionally rewrites only
`KSY_DEALS_IMAGE`. Re-entering the twelve-field hidden bootstrap batch would
unnecessarily read every secret, while editing `/opt/ksy-deals/.env` directly
would bypass the reviewed transactional deployment path.

## Decision

Extend script 20 with one optional routine-only argument:

```text
--reuse-existing-secrets \
  --order-telegram-url https://t.me/ksy_deals_store_bot \
  --image ghcr.io/fedrbodr/ksy-deals@sha256:<digest>
```

The override is accepted only with `--reuse-existing-secrets`, exactly once,
and only for the fixed approved URL
`https://t.me/ksy_deals_store_bot`. Bootstrap mode continues to obtain
`ORDER_TELEGRAM_URL` from the hidden batch and rejects the override. Unknown,
duplicate, missing-value, malformed, or non-approved arguments fail before
Docker or filesystem mutation.

## Data flow and safety

Routine preflight keeps the existing root ownership, mode `0600`, canonical
key, printable-ASCII, image-digest, disk, and Docker-auth checks. After those
checks, the candidate env is produced in the private work directory by
rewriting exactly two canonical assignments:

- `KSY_DEALS_IMAGE` becomes the requested immutable digest;
- `ORDER_TELEGRAM_URL` becomes the fixed approved bot URL.

Every other byte in the existing env remains unchanged. No secret is printed,
placed in argv, or re-entered. Script 20's existing transaction boundary is
unchanged: it snapshots the previous env and Compose file, installs candidates
atomically, recreates the server, and restores the previous files/server if a
later migration or health gate fails. Deployment evidence retains only image
roles and existing redacted status; it does not record secret values or
Telegram identifiers.

## Acceptance and tests

Shell specs follow RED-GREEN-REFACTOR and prove:

1. the new routine invocation fails before implementation;
2. the successful path changes only the image and order URL assignments,
   never prompts, and does not replace Docker authentication;
3. bootstrap use, duplicate override, missing value, malformed URL, alternate
   Telegram destinations, and unknown arguments fail before mutation;
4. a post-install failure restores the previous env, including the previous
   order URL;
5. all existing script 20 specs and workspace verification remain green.

After merge, the operator stages script 20 and Compose, compares local and
remote SHA-256, reruns the same already-deployed digest with the routine
override, and then requires:

- live/ready health and routine script 23 acceptance;
- `curl -I /r/site/order_site_hero` returns `302` with the approved bot deep
  link;
- the matching `SITE_CTA_CLICK` count increases without exposing row or actor
  identifiers;
- restart/OOM, disk, PostgreSQL volume, backup, and public route postflight
  gates remain healthy.

## Out of scope

- secret rotation or hidden-batch changes;
- arbitrary Telegram destination changes;
- database or schema changes;
- KSY application code changes;
- Vezdepost production resources outside the KSY deployment boundary.
