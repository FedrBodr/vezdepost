# VK Publishing Reliability and Personal Calendar Streak Design

## Summary

This change fixes two production defects:

1. Personal VK API errors returned inside HTTP 200 responses are currently
   treated as successful calls. Expired tokens can therefore produce either a
   media-upload exception or a false `PUBLISHED` post with an undefined VK ID.
2. The posting streak currently measures rolling 24-hour intervals for an
   organization. Users expect consecutive calendar days in their own time
   zones.

The implementation will make VK publication success explicit and verifiable,
and will derive a personal calendar-day streak from confirmed publication
timestamps for all successful posts in the active organization.

## Product Decisions

- A VK post is successful only after VK returns a real post ID.
- VK API error code `5` enters the existing refresh-token flow. If refresh is
  impossible, the channel requires reconnection and the post remains `ERROR`.
- Existing posts are never automatically retried or republished by this
  change.
- A user's streak includes every confirmed successful post in the active
  organization, regardless of which team member created it or which channel
  published it.
- Multiple successful posts and multiple channels on one local calendar day
  count as one streak day.
- Calendar days use the viewing user's IANA time zone, such as
  `Europe/Moscow`.
- A streak remains active throughout the day after its most recent posting
  day. It resets only after a complete local calendar day passes without a
  successful publication.
- Streak reminders are personal and are scheduled relative to the user's local
  day.

## VK API Handling

### Typed VK response boundary

`VkProvider` will introduce one response-unwrapping boundary for VK method
calls. The boundary will inspect the decoded JSON even when the HTTP status is
200:

- a payload containing `response` returns that response;
- VK error code `5` throws the existing Temporal `RefreshToken` failure;
- any other VK error throws `BadBody` with a bounded, sanitized diagnostic;
- access tokens and refresh tokens are never included in error messages,
  notifications, or persisted diagnostics.

All personal VK method calls used by authentication, media upload, posting,
and comments will use this boundary. The group provider is not changed except
where it can safely reuse a token-free response type or helper.

### Verified publication result

`wall.post` must return a non-empty `post_id`. Missing or malformed response
data is a publication error. The provider must not construct release IDs or
URLs containing `undefined`.

Media upload follows the same rule at every stage:

- `photos.getWallUploadServer` or `video.save` must return the expected upload
  fields;
- the upload response must contain the fields needed by
  `photos.saveWallPhoto`;
- `photos.saveWallPhoto` must return a real media ID.

The existing post workflow will then refresh and retry on token expiration,
or persist `ERROR` for non-refreshable failures. `Post.state` reaches
`PUBLISHED` only after the provider returns a verified post ID and URL.

### Proactive refresh

`VkProvider` will opt into the existing refresh workflow. Reactive handling of
VK error code `5` remains required because tokens can be revoked or expire
outside the expected schedule.

## Confirmed Publication Timestamp

### Schema

Add nullable `Post.publishedAt DateTime?` with an index. `publishedAt` is set
in the same repository update that stores `PUBLISHED`, `releaseId`, and
`releaseURL`. It is never set for `QUEUE`, `DRAFT`, or `ERROR` posts.

The migration backfills `publishedAt` from `updatedAt` only for legacy rows
that have:

- `state = PUBLISHED`;
- a non-null, non-empty `releaseId`;
- `releaseId <> 'undefined'`;
- a release URL that does not contain an undefined identifier.

This deliberately excludes the known false-positive personal VK rows. The
migration does not alter their existing state and does not republish them.

### Why a timestamp instead of a stored counter

The same organization's events can fall on different local dates for users in
different time zones. A canonical success timestamp lets each user derive the
correct calendar dates without duplicating mutable counters or rewriting
history when a time zone changes.

## User Time Zone

Add nullable `User.timezoneName String?` for a validated IANA zone. The
existing numeric `User.timezone` field remains unchanged for compatibility.

The frontend uses the existing `getTimezone()` helper as the source of the
selected or browser-detected IANA zone. After `/user/self` loads, the layout
updates the backend only when the local zone differs from `timezoneName`, then
revalidates user and streak data. The update follows the project layering
rule: controller to service to repository.

The backend validates the supplied value with the runtime time-zone database.
Invalid values are rejected. Existing users without `timezoneName` fall back
to their stored numeric UTC offset for calculation until the frontend syncs a
valid IANA zone; `UTC` is the final fallback.

## Streak Calculation

### Data flow

A dedicated authenticated streak endpoint returns:

```ts
type PersonalStreak = {
  days: number;
  timezone: string;
  lastPublishedLocalDate: string | null;
  nextChangeAt: string | null;
};
```

The repository selects distinct local dates from confirmed
`Post.publishedAt` values for the active organization. The IANA zone is passed
as a parameter, never interpolated into SQL. The service counts backward from
the latest distinct day:

1. If the latest posting day is today, count consecutive days ending today.
2. If the latest posting day is yesterday, count consecutive days ending
   yesterday and keep that result active through today.
3. If the latest posting day is older than yesterday, return zero.
4. Stop counting at the first missing local calendar day.

`nextChangeAt` is the first local midnight at which the returned value can
change without another publication. The calculation uses calendar operations
in the user's IANA zone rather than fixed 24-hour millisecond arithmetic, so
daylight-saving transitions are correct.

### Frontend behavior

`StreakComponent` consumes the streak endpoint rather than subtracting
`streakSince` locally. It revalidates:

- when the browser regains focus or connectivity;
- on a low-frequency interval so scheduled publications appear without a page
  reload;
- exactly at `nextChangeAt` using a local timer.

The tooltip continues to distinguish a one-day streak from a longer streak.
The component is hidden when `days` is zero.

The legacy `Organization.streakSince` field is no longer a source of truth.
It can remain temporarily for rollback compatibility, but no new UI or
reminder behavior depends on it.

## Personal Reminder Workflow

The organization-wide rolling 24-hour streak workflow will be replaced by a
personal reminder workflow per organization user.

After a confirmed publication, the activity starts or replaces a workflow
whose identity includes both organization ID and user ID. For each user, the
workflow:

1. reads the user's current `timezoneName` with the documented fallback;
2. sleeps until 22:00 on the next local calendar day;
3. checks whether the streak is still active and whether that local day has a
   confirmed publication;
4. sends the existing reminder only when the day is still empty;
5. exits after the local day ends without a publication; a later publication
   starts a new workflow.

A time-zone update replaces the user's active reminder workflow so its next
wake-up uses the new zone. Users with streak emails disabled are skipped.
Workflow activities query current database state after every sleep; they do
not rely on stale workflow arguments.

## Error Handling and Observability

- VK errors retain the VK error code and sanitized message without credentials.
- Missing VK response fields produce explicit provider failures rather than
  JavaScript property-access errors.
- Streak repository and workflow failures are logged; exceptions must not be
  silently swallowed.
- A failed streak/reminder update must not change a successfully published
  post back to `ERROR`.
- Time-zone validation errors return a client error and preserve the last
  valid stored zone.

## Testing

### VK provider

Provider tests will cover:

- VK error code `5` from a media-upload method becomes `RefreshToken`;
- another VK error becomes `BadBody` without leaking tokens;
- missing `upload_url` is rejected explicitly;
- missing `wall.post.post_id` is rejected and never returns a completed result;
- a valid response produces a real release ID and URL;
- an expired-token response followed by refresh succeeds through the workflow
  path.

### Publication persistence

Repository/service tests will prove that `publishedAt` is written only with a
verified successful publication and that failure states leave it null. The
migration's backfill predicate will be checked against real IDs, null IDs, and
the literal `undefined` regression case.

### Streak

Unit and integration tests will cover:

- three consecutive local calendar days with gaps greater than 24 hours;
- today empty while yesterday's streak remains active;
- reset after a fully missed local day;
- multiple channels and posts on one day counting once;
- users in different IANA zones seeing different local-day groupings from the
  same organization events;
- daylight-saving boundaries;
- invalid and missing time-zone values;
- timer/refetch behavior at `nextChangeAt` without a page reload;
- reminder scheduling at 22:00 local time and cancellation/replacement after a
  publication or time-zone change.

## Rollout and Production Recovery

1. Apply the additive database migration before or with the application
   release.
2. Deploy the VK response checks, `publishedAt` persistence, time-zone sync,
   streak endpoint/UI, and reminder workflow together.
3. Reconnect the current personal VK integration to obtain a valid access and
   refresh token.
4. Verify a non-publishing VK identity call and then publish one controlled
   test post with media.
5. Confirm the post has a real `releaseId`, a real VK URL, `publishedAt`, and a
   `PUBLISHED` state.
6. Leave historical false-positive VK rows unchanged for auditability. Any
   decision to retry them is a separate, explicitly approved operation because
   it can create duplicate public posts.

## Out of Scope

- Automatic retry or republication of historical posts.
- Rewriting the state of legacy false-positive VK rows.
- Changing VK community-token authentication.
- Per-author streaks or attribution of legacy posts to individual creators.
- A general redesign of posting analytics.
