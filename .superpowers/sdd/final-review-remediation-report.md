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

## Verification

All pnpm commands used Node 22.20.0.

- Expanded remediation suite: 18 files, 226/226 tests passed.
- Full repository suite with coverage: 97 files, 995/995 tests passed.
- Explicit frontend TypeScript check: passed.
- Static V1 API/import proof: no matches.
- Affected-preview raw `dangerouslySetInnerHTML` proof: no matches.
- Prettier check over every changed file: passed.
- `git diff --check`: passed.
- Frontend production build (including TypeScript/static generation): passed.
- Backend production build: passed.
- Orchestrator production build: passed.

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

## Concerns

No unresolved remediation blocker or review concern.
