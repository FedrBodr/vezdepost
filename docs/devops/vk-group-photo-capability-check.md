# VK Group photo capability gate

This runbook is the release gate for VK Group photo publishing. It does not
authorize a push or a production deploy.

Current external-check status: **Pending authorized execution**. The check
requires a newly created community token supplied through an approved secret
mechanism and explicit authorization for the named test community. Until an
authorized execution produces the `GO` result below, rollout remains stopped.

## Security rules

Use a dedicated community with no production impact and a newly created
**community** token. Grant only community management (`manage`), community
wall (`wall`), and photographs (`photos`) permissions. Never broaden the
permissions to make a failed check pass, and never substitute a personal token.

Tokens, upload URLs, media URLs, multipart bodies, upstream payloads,
screenshots, owner names, and personal data must never be placed in shell
history, terminal or CI captured output, Git, support messages, issue trackers,
chat, or execution notes. Do not enable shell tracing, HTTP verbose/debug
output, request recording, or response recording. Do not paste a token into a
command, prompt, committed file, screenshot, or message.

Raw API responses and the one-use upload URL may exist only inside the approved
secret-aware runner's private, mode-`0700` temporary workspace, with each raw
file explicitly created mode `0600`. They must not be printed or attached to a
job log, and the workspace must be removed on success, failure, interruption,
and timeout. Runner stdout must be restricted to the safe fields defined in
this document.

## Prerequisites and authorization

All of the following are required before the external check:

1. An operator identifies the dedicated non-production-impact VK community and
   confirms that one temporary wall post is acceptable.
2. A new community token is created for that community with exactly `manage`,
   `wall`, and `photos` enabled.
3. The token is supplied out of band through an approved secret/environment
   mechanism. The operator confirms that the runner can read it without
   exposing its value in argv, shell history, process logs, or captured output.
4. Explicit authorization names the community and permits the upload-server,
   upload, save-photo, one `wall.post`, verification, and cleanup phases. This
   authorization does not permit a push or deployment.
5. The test image is disposable, synthetic, contains no person or identifying
   content, and has metadata removed. Its path is supplied to the runner
   without recording a media URL.
6. An authorized operator can inspect the selected community wall and remove
   the temporary post/photo if API cleanup is unavailable.

If any prerequisite is missing, record `Pending authorized execution`, keep
the rollout at `STOP`, and do not call VK.

## Automated release verification

Run from the repository root with the project Node version. The examples pin
the currently supported repository runtime without changing the system Node:

```bash
rtk pnpm --use-node-version=22.20.0 run verify:workspace
rtk pnpm --use-node-version=22.20.0 exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
rtk pnpm --use-node-version=22.20.0 exec vitest run scripts/vk-group-photo-capability-check.spec.mjs scripts/vk-group-photo-release-hygiene.spec.mjs
rtk pnpm --use-node-version=22.20.0 test
rtk pnpm --use-node-version=22.20.0 run build:backend
rtk pnpm --use-node-version=22.20.0 run build:orchestrator
rtk pnpm --use-node-version=22.20.0 run build:frontend
rtk git status --short
rtk git diff --name-only prod...HEAD
rtk git diff --check prod...HEAD
rtk git diff --stat prod...HEAD
rtk git ls-files '.tmp/**'
rtk pnpm --use-node-version=22.20.0 exec node scripts/vk-group-photo-release-hygiene.mjs --base prod
```

Zero test failures and successful application builds are required. Repository
hygiene must show no whitespace errors, no tracked `.tmp/` content, no
credentials, and no new/changed binary or image content. The hygiene runner computes the exact
`git diff --name-only prod...HEAD` set, reports that filename list for scope
review, reads committed `HEAD` blobs rather than maskable working-tree content,
and never prints matched file content. It accepts only the literal `prod...HEAD`
range and fails closed when a changed `HEAD` blob cannot be read.

The binary/image check combines Git's content-based binary classification with
PNG, JPEG, GIF, WebP, BMP, and TIFF magic-byte detection, so it does not depend
on filenames or extensions. The secret check scans the current content of every
existing changed file for these explicitly bounded signatures:

- VK `vk1.` tokens with at least 40 token characters;
- three-segment JWT-shaped values;
- GitHub `ghp_`, `gho_`, `ghu_`, `ghs_`, and `ghr_` tokens;
- AWS `AKIA` access-key IDs;
- private-key PEM headers;
- values of at least 32 token characters assigned to
  `VK_GROUP_CAPABILITY_TOKEN`, `access_token`, `api_key`, or `client_secret`
  spellings.

The scan deliberately avoids generic high-entropy matching so harmless test
fixtures are not flagged. A failure emits only the check name, `STOP`, and
matched filenames; it never emits the matched value or line. Inspect every file
in the `changed-files` record against the planned Task 1–5 scope.

The exact regular expressions are:

```text
\bvk1\.[A-Za-z0-9._-]{40,}\b
\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b
\bgh[pousr]_[A-Za-z0-9]{36,}\b
\bAKIA[0-9A-Z]{16}\b
-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----
\b(?:VK_GROUP_CAPABILITY_TOKEN|access[_-]?token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{32,}
```

## Controlled runner invocation

Use the repository runner at
`scripts/vk-group-photo-capability-check.mjs`. It never accepts a token argument.
The approved secret injector must expose the token directly to the child process
as `VK_GROUP_CAPABILITY_TOKEN`; do not export it interactively or prefix the
command with its value. Keep shell tracing disabled. Set the non-secret numeric
community ID and local synthetic-image path using the operator's approved
environment procedure, then run:

```bash
rtk env VK_GROUP_CAPABILITY_AUTHORIZED=1 pnpm --use-node-version=22.20.0 exec node scripts/vk-group-photo-capability-check.mjs --group-id "$VK_GROUP_ID" --media-file "$VK_TEST_MEDIA"
```

`VK_GROUP_CAPABILITY_AUTHORIZED=1` attests that the named community is the
approved dedicated non-production-impact community and that the full publish,
verification, and cleanup sequence is authorized. The runner rejects missing
authorization, a missing injected token, unknown arguments (including a token
argument), non-positive/non-numeric group IDs, URLs, empty files, and media
outside `.jpg`, `.jpeg`, `.png`, and `.webp` before network access.

The runner sends the token only inside VK POST bodies. It performs the upload
inside the Node process, so the discovered upload URL never enters a child
process argument. Requests have a 30-second abort timeout and reject redirects,
so a redirect cannot forward a VK POST body to a different origin. Raw response
files exist only in a mode-`0700` temporary
directory as mode-`0600` files. A `finally` cleanup removes that directory on
normal success or failure; SIGINT/SIGTERM handlers remove it before exit. Raw
responses and other ephemeral diagnostics are destroyed before durable JSON
Lines are emitted.

Stdout is JSON Lines containing only `phase`, `method`, numeric `error_code`
when VK supplied one, `status`, and safe numeric `post_id` fields. Exit `0`
means `GO`; exit `2` means `STOP`; exit `3` means `PENDING_CLEANUP`. Do not
add upstream messages or raw details. Stdout is transient safe execution
evidence, not the durable decision record below.

For every response, the runner first extracts a numeric VK error code from a VK
error envelope, then requires an HTTP 2xx status for any success payload. A
shape-valid non-2xx response is never accepted as success. Cleanup delete
responses must be the numeric value `1`; boolean or string lookalikes do not
complete cleanup.

## Controlled API phases

Run these phases only through the approved runner invocation. Use VK API version
`5.251` for every VK method. Send the access token in the POST body, never in a
URL.

1. **Upload-server request** — POST
   `photos.getWallUploadServer` with the positive dedicated community ID as
   `group_id`. Validate that the response contains an HTTPS upload URL. Do not
   display, copy, or persist that URL outside the private workspace.
2. **Disposable upload** — POST the synthetic image as multipart field `photo`
   to the returned upload URL. Keep `photo`, `server`, and `hash` only in private
   runner memory or private temporary files. Do not emit the multipart body or
   response.
3. **Wall-photo save** — POST `photos.saveWallPhoto` with the positive
   `group_id` and the upload response's `photo`, `server`, and `hash`. Validate
   a non-empty saved-photo result with nonzero owner and photo IDs.
4. **Publication** — only after phases 1–3 succeed, POST one `wall.post` with
   the negative community `owner_id`, `from_group=1`, the saved attachment in
   `photo<owner_id>_<photo_id>` form, and neutral non-identifying test text.
   Never call `wall.post` after an upload-server, upload, or save failure.
5. **Authorship verification** — call `wall.getById` for the numeric post ID.
   The post must exist with both `owner_id` and `from_id` equal to the negative
   dedicated community ID.
6. **Cleanup** — call `wall.delete` and `photos.delete`, then verify absence with
   `wall.getById` and `photos.getById`. Cleanup is complete only when both
   delete calls succeed and both absence checks return no artifact.
7. **Completion** — remove the private runner workspace, revoke the one-use
   token through the approved secret procedure, and retain only the safe JSON
   result. `GO` is possible only after phases 1–6 all succeed.

At the first rejection or invalid response, stop immediately. Do not retry with
more permissions, a personal token, another community, or `wall.post`. If VK
returns an error envelope, retain only the method name and numeric
`error_code`; discard the error text and complete payload. If a transport,
parse, or malformed-response failure contains no numeric VK code, retain only
the method name and `STOP`; omit `error_code`. Destroy all raw responses and
ephemeral diagnostics.

A transport, parse, or malformed-response failure from
`photos.saveWallPhoto` or `wall.post` leaves artifact creation uncertain and is
therefore `PENDING_CLEANUP`, even after all known artifacts were deleted. A VK
error envelope with a numeric code is a definite rejection and may be `STOP`
after cleanup of previously known artifacts succeeds.

If a saved photo or published post exists when a later phase fails, the runner
attempts all applicable cleanup and absence checks. Any failed or unverified
cleanup produces `PENDING_CLEANUP`, exit `3`, and never `GO`. Complete the
approved operator cleanup and verify absence before starting a new controlled
run; the previous run remains non-GO.

## Decision and evidence record

Use this decision table exactly:

| Result                                                                                                                                                        | Action                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload-server request, upload, wall-photo save, controlled `wall.post`, community-authorship verification, both delete calls, and both absence checks succeed | Record date, VK API version `5.251`, method names, safe test post ID, cleanup `completed`, and `GO` for later rollout approval.                                                          |
| Upload-server, upload, or wall-photo save fails                                                                                                               | Record only method name and numeric VK error code when supplied, otherwise method name only; mark `STOP`; do not broaden permissions, use a personal token, call `wall.post`, or deploy. |
| Publication or authorship verification fails and cleanup is completed and verified                                                                            | Record only the failed method and numeric VK error code when supplied, otherwise method name only; mark `STOP` and do not deploy.                                                        |
| Cleanup fails or absence cannot be verified                                                                                                                   | Record only the cleanup/verification method and numeric VK error code when supplied, otherwise method name only; mark `PENDING_CLEANUP`, never `GO`, and do not deploy.                  |

The durable success record contains only:

- execution date;
- VK API version `5.251`;
- method names `photos.getWallUploadServer`, `photos.saveWallPhoto`, and
  `wall.post`;
- the verified numeric test post ID;
- cleanup status `completed` after both absence checks;
- decision `GO` for a separately approved rollout.

After the runner exits, the authorized operator creates this separate durable
record from the safe JSON Lines plus the known execution date and the runner's
fixed API version `5.251`. Record the three required capability method names
`photos.getWallUploadServer`, `photos.saveWallPhoto`, and `wall.post` only after
the emitted cleanup/absence phases culminate in `GO`. Do not copy raw temporary
files or add upstream messages. Revoke the one-use token after recording the
decision.

The durable failure record contains only the failed method name, the numeric VK
error code when returned, and decision `STOP` or `PENDING_CLEANUP`. When no
numeric code exists, omit the error-code field entirely. Do not add summaries
of VK's message, prose substitutes for a code, or raw response.

Current record: **Pending authorized execution**. No VK method has been called,
no test post ID exists, and no external health result has been observed.

## Later production rollout expectations

These are acceptance checks for a later, separately approved production
rollout. They are expectations, not results from this runbook's current pending
state:

- the integration list loads;
- the VK Group connection modal works on desktop and mobile in Russian and
  English;
- a text-only VK Group post succeeds;
- a one-photo VK Group post succeeds;
- unsupported or excess media is rejected before enqueue;
- worker error logs contain no token, private URL, multipart data, or upstream
  payload;
- queue and worker health remain normal.

A `GO` capability result permits only a later rollout approval decision. A
production deploy requires separate explicit confirmation and its own health
verification; this runbook does not authorize deployment.
