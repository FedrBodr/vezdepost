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
secret-aware runner's private, mode-`0700` temporary workspace, with files
created under `umask 077`. They must not be printed or attached to a job log,
and the workspace must be removed on success, failure, interruption, and
timeout. The runner's durable output must be restricted to the safe result
fields defined in this document.

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
rtk pnpm --use-node-version=22.20.0 test
rtk pnpm --use-node-version=22.20.0 run build:backend
rtk pnpm --use-node-version=22.20.0 run build:orchestrator
rtk pnpm --use-node-version=22.20.0 run build:frontend
rtk git status --short
rtk git diff --check prod...HEAD
rtk git diff --stat prod...HEAD
rtk git ls-files | rtk rg -i 'vk.*\.(png|jpe?g|webp)$'
```

Zero test failures and successful application builds are required. Repository
hygiene must show no whitespace errors, tracked `.tmp/` content, credentials,
or original/reference VK screenshots. Existing product icons are allowed when
inspection confirms that they are normal UI assets rather than captured VK
content.

## Controlled API phases

Run these phases only in the approved secret-aware runner. Use VK API version
`5.251` for every VK method. Send the access token in the POST body, never in a
URL. Keep raw inputs and responses inside the private temporary workspace; the
phase descriptions below are the request contract, not commands into which a
secret should be pasted.

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
5. **Verification** — inspect the selected community wall. The one-photo post
   must appear on that wall and be authored by the community. The numeric test
   post ID is safe to record only after this verification.
6. **Cleanup** — delete the temporary post and photo with the already approved
   community procedure where permitted. If API cleanup is unavailable, the
   authorized operator removes the artifacts through the community UI. Remove
   the private runner workspace and revoke the one-use token after the result
   is recorded.

At the first rejection or invalid response, stop immediately. Do not retry with
more permissions, a personal token, another community, or `wall.post`. If VK
returns an error envelope, retain only the method name and numeric
`error_code`; discard the error text and complete payload. If a transport,
parse, or malformed-response failure contains no numeric VK code, record the
method name and the literal classification `no numeric VK error code returned`
rather than inventing a code or retaining raw details.

## Decision and evidence record

Use this decision table exactly:

| Result                                                 | Action                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload-server request and wall-photo save both succeed | Record date, VK API version `5.251`, method names, safe test post ID, and `GO` for later rollout approval.                                                           |
| Either method fails                                    | Record only method name and VK numeric error code, mark `STOP`, do not broaden permissions, do not use a personal token, do not call `wall.post`, and do not deploy. |

The first row becomes `GO` only after the permitted `wall.post` is visible on
the selected community wall, is authored by the community, and its numeric post
ID is available for the safe record. Any publication or authorship verification
failure is `STOP`; retain only `wall.post` and its numeric VK error code when VK
provided one. Cleanup status may be recorded as `completed` or
`operator cleanup required`, without owner names, URLs, screenshots, personal
data, or upstream responses.

The durable success record contains only:

- execution date;
- VK API version `5.251`;
- method names `photos.getWallUploadServer`, `photos.saveWallPhoto`, and
  `wall.post`;
- the verified numeric test post ID;
- cleanup status;
- decision `GO` for a separately approved rollout.

The durable failure record contains only the failed method name, the numeric VK
error code when returned (otherwise `no numeric VK error code returned`), and
decision `STOP`. Do not add summaries of VK's message or raw response.

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
