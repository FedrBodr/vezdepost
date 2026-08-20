# KSY provision progress output design

## Context

The live KSY staging provisioner completed successfully, but its interactive
output was dominated by Docker Compose's animated pull and container status
frames. The later health polling phase produced only repeated curl errors, so
an operator could not tell which phase was active, whether work was continuing,
or how long remained before rollback.

## Decision

Script 20 will emit stable, line-oriented progress records for the complete
provisioning path. Each record uses this public format:

```text
KSY_PROGRESS step=<current>/<total> phase=<stable-name> message=<human-readable text>
```

The phases, in order, are `preflight`, `secrets`, `install`, `pull`, `database`,
`migrations`, `server`, `health`, and `evidence`. The existing terminal prompt,
`KSY_PROVISION_FAILED <reason>`, and final `KSY_PROVISIONED ...` record remain
compatible.

Docker Compose will run with its plain progress renderer so a TTY produces
append-only lines instead of repainting spinner frames. Compose output remains
visible because pull, migration, and container errors are useful diagnostics.

## Health polling

The health phase will identify the endpoint (`live` or `ready`), attempt number,
maximum attempt count, and result (`WAIT` or `PASS`) without printing a response
body. A failed request will no longer print curl's repetitive transport error;
the corresponding progress record is the diagnostic. The existing limits stay
unchanged: 30 attempts per endpoint with a two-second delay outside test mode.

If deployment fails, rollback behavior is unchanged and the script still exits
through `KSY_PROVISION_FAILED READINESS_FAILED`. The last progress line makes
the stalled phase and attempt visible.

## Secret safety

Progress records must never contain secret values, their lengths, parsed
assignment text, environment dumps, or temporary paths derived from secrets.
Public image digests may remain in Docker output and the final deployment
record. Terminal echo remains disabled before the batch prompt and is restored
on success, parsing failure, signal interruption, and EXIT cleanup.

## Verification

The existing script 20 spec will gain a focused contract that first fails
against the current script. It will require all nine phase records in order,
plain Compose progress, health `WAIT`/`PASS` records, compatibility of the final
success/failure records, and absence of every synthetic secret. Existing PTY,
rollback, idempotency, child-environment, and input-validation cases must remain
green. `bash -n` must pass for both script and spec.
