# Final review remediation report

## Status

Complete. All eight external findings were independently verified against
`7b509df2` and current code/history; all were valid, so no finding was pushed
back. Every validated Critical, Important, and Minor issue is remediated. No
push, merge, release, deployment, migration, dependency change, or external
state mutation was performed.

## Remediations

1. Replaced the YouTube, TikTok, Facebook, and Instagram preview HTML sinks
   with the shared `SanitizedPostContent` boundary. Instagram account names are
   rendered as React text rather than interpolated HTML. Encoded executable-tag
   coverage exercises every affected preview plus the account-name path.
2. Added pure ID-only media expansion in `PostsService.resolveMediaSources` and
   complete-thread source authorization in the real `getPostsList` workflow
   path, with the same preflight retained in per-post preparation as defense in
   depth. Primary and registered secondary paths are authorized before
   `updateTags`, `updateMedia`, conversion, persistence, capability/provider
   preparation, or provider calls. Post-conversion authorization remains.
3. Separated Telegram delivery-group size (10) from total media cardinality.
   The adapter now rebalances singleton tails, so 11 and 21 media are delivered
   as valid 2-to-10-item albums rather than invalid 10+1 tails.
4. Made LinkedIn's verified image/video alternatives exclusive while keeping
   media optional, matching the adapter's video-plus-attachment rejection.
5. Made Telegram's 4,096 body and 1,024 caption limits authoritative UTF-16
   code-unit limits and reused shared measurement in profiles, analysis,
   previews, and transport decisions.
6. Added explicit adapter measurement metadata and declared X as
   `weighted`/`x-weighted`. Serialized frontend reconstruction preserves the
   unit/counter, so backend validation and preview cropping agree for CJK.
7. Threaded purpose-specific 10 MiB/30 s options through image dimension reads.
   Exact/oversize boundaries are covered and Pinterest dimension inspection is
   sequential, bounding concurrent buffers.
8. Corrected the TikTok photo-title input boundary from 89 to 90 and added an
   exact-boundary component regression.
9. Closed the final workflow-lifecycle follow-up: deterministic unsafe,
   missing, or malformed complete-thread media now leaves `getPostsList` as a
   structured, non-retryable `publication_media_preflight` activity failure.
   Every bundled post-workflow version catches only that failure type, marks
   the root post `ERROR`, sends a failure notification, and returns before
   commentability checks, provider activities, post updates, reminders, or
   webhooks. Only the whitelisted safe preflight cause is persisted; Temporal
   worker/activity metadata remains confined to workflow history. Transient
   database, DNS, local-filesystem, and activity failures retain their existing
   retry and workflow-failure behavior. Local source validation uses an
   explicit error code for deterministic invalid/missing paths, while
   operational `realpath` failures are rethrown. The helper adds no command on
   the success path, and the new failure type did not exist in historical
   activity results, preserving replay command order for v1.0.1–v1.0.5.
10. Hardened the persisted-media parser at its shared boundary. JSON media
    arrays are accepted only when every member is a non-null, non-array object,
    so null, mixed-null, primitive, and nested-array members become the same
    structured, non-retryable `Invalid publication media` preflight failure
    instead of throwing an ordinary `TypeError` or silently losing the media
    list. Safe path and ID object arrays remain supported, while malformed
    attachment fields continue through `PostsService`'s deterministic
    attachment validation.

## RED/GREEN evidence

- Preview safety: five encoded-payload/account-name cases initially rendered
  executable `img` nodes; all five pass through the shared sanitizer.
- Publication preflight: the initial unsafe-secondary test resolved instead of
  rejecting. Review then exposed both the one-post workflow shape and normal
  `{id}`-only stored media. Workflow-shaped and pure-resolution tests failed
  before their fixes and now prove lookup may occur while storage/DB,
  conversion, sibling preparation, and provider effects do not.
- Telegram media: 11 items initially produced an unsupported-media diagnostic;
  after the profile fix the adapter boundary exposed invalid `[10, 1]` and
  `[10, 10, 1]` groups. The final transport produces `[9, 2]` and
  `[10, 9, 2]`.
- LinkedIn: shared analysis initially accepted video plus image while the
  adapter rejected it; both now reject the combination.
- Telegram measurement: astral-emoji caption/body and preview cases initially
  used graphemes; they now enforce the same UTF-16 boundaries as transport.
- X measurement: 141 CJK characters initially passed the reconstructed bridge
  and preview; they now measure 282 weighted units and are rejected/cropped.
- Image dimensions: option forwarding, 10 MiB boundary, and Pinterest
  concurrency regressions failed before implementation and pass after it.
- TikTok title: the rendered input initially exposed `maxLength="89"`; it now
  exposes `maxLength="90"`.
- Workflow lifecycle: all 15 workflow-version × deterministic-preflight cases
  initially rejected outside lifecycle handling. Activity-level unsafe,
  missing, and malformed cases also initially threw ordinary retryable errors.
  They now produce the single non-retryable preflight type, and all five
  workflows terminate after exactly one root `ERROR` transition and failure
  notification with no publication effects. Five transient controls continue
  to reject rather than being misclassified.
- Review hardening: persisting the full Temporal failure first exposed worker
  identity/activity metadata through `post.error`; 15 regressions went RED
  until only the safe cause string was stored. A simulated `realpath` `EIO`
  also showed that the old generic local-source error swallowed operational
  failures; it is now rethrown for Temporal retry while missing-file
  `ENOENT`/`ENOTDIR` remains deterministic.
- Persisted media members: null and mixed valid/null arrays initially threw an
  ordinary destructuring `TypeError`; primitive and nested-array members could
  resolve with an undefined image in the isolated activity harness. All four
  cases now fail at the parser boundary with the structured non-retryable
  preflight type, while the existing safe-array and transient controls remain
  green.

## Verification

All pnpm commands used Node 22.20.0.

- Expanded remediation suite: 18 files, 226/226 tests passed.
- Lifecycle workflow/activity/security suite: 7 files, 143/143 tests passed.
- Full repository suite with coverage: 97 files, 1,024/1,024 tests passed.
- Explicit frontend TypeScript check: passed.
- Static V1 API/import proof: no matches.
- Affected-preview raw `dangerouslySetInnerHTML` proof: no matches.
- Prettier check over every changed file: passed.
- `git diff --check`: passed.
- Frontend production build (including TypeScript/static generation): passed.
- Backend production build: passed.
- Orchestrator production build: passed.
- A diagnostic raw orchestrator `tsc` run reported only the branch's existing
  test-fixture and unrelated library strictness findings; the lifecycle test's
  new tuple-inference findings were corrected, and both authoritative
  production TypeScript builds passed.

## Independent review

The read-only remediation reviewer first identified the workflow-shape,
ID-only-media, strict-TypeScript, and singleton-album gaps. Each was fixed with
fresh regression evidence and re-reviewed. Final verdict:

- Critical findings: none.
- Important findings: none.
- Minor findings: none.
- Scope regressions or architecture mismatches: none.
- Independent focused verification: 18 files, 221/221 tests passed; frontend
  TypeScript, backend/orchestrator builds, Prettier, and diff checks passed.

The same reviewer then inspected the lifecycle follow-up and identified two
Important hardening gaps before commit: unsafe persistence of the full Temporal
failure and transient local-filesystem errors collapsed into a deterministic
message. Both received fresh RED/GREEN regressions and fixes. The final
incremental re-review found:

- Critical findings: none.
- Important findings: none.
- Minor findings: none.
- Scope regressions or architecture mismatches: none.
- Independent focused verification: 7 files, 154/154 tests passed;
  orchestrator build, Prettier, and `git diff --check` passed.

The final external incremental review exposed one more Important malformed
persisted-media boundary: arrays containing null members escaped the parser and
threw an ordinary destructuring `TypeError`. The shared parser was hardened
with activity-level RED/GREEN cases for null, mixed valid/null, primitive, and
nested-array members. The same reviewer found only a formatting Minor, which
was corrected, and returned the final verdict:

- Critical findings: none.
- Important findings: none.
- Minor findings: none.
- Replay, lifecycle, transient-classification, security, and compatibility
  regressions: none.
- Independent focused verification: 7 files, 158/158 tests before the
  formatting-only correction; 71/71 relevant after-format tests, Prettier, and
  `git diff --check` passed.

## Concerns

No unresolved remediation blocker or review concern.
