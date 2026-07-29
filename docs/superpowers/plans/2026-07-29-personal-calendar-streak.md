# Personal Calendar Streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the organization-wide rolling 24-hour streak with a per-viewer calendar-day streak based on all confirmed successful posts in the active organization and the viewer's IANA time zone.

**Architecture:** Persist canonical publication timestamps and user IANA zones, then derive distinct local publication dates in the repository and calculate the active streak in a focused pure service. Expose the result through an authenticated endpoint, make the UI revalidate at the calculated boundary, and replace the legacy organization workflow with one personal reminder workflow per organization user.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Temporal, React/Next.js, SWR, Day.js, Vitest.

## Global Constraints

- Count all confirmed successful posts in the active organization.
- Multiple posts or channels on one local day count once.
- Use each viewing user's validated IANA time zone.
- Keep yesterday's streak active through today; reset only after a completely missed local day.
- Do not count legacy rows with missing or literal `undefined` release IDs.
- Do not automatically retry, republish, or rewrite historical VK rows.
- Preserve Controller → Service → Repository layering.
- Use PNPM only and run lint/build commands from the repository root.

---

### Task 1: Confirmed publication and IANA-zone schema

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma`
- Create: `docs/server-scripts/09-backfill-published-at.sh`
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/backfill-published-at.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/backfill-published-at.spec.ts`

**Interfaces:**
- Produces: `Post.publishedAt: Date | null`, `User.timezoneName: string | null`.
- Produces: an idempotent production backfill script that never touches false-positive VK rows.

- [ ] **Step 1: Add a failing predicate test for the backfill selection**

Create a pure exported predicate used to document and test the SQL rule:

```ts
expect(isTrustedLegacyPublication({ state: 'PUBLISHED', releaseId: '77', releaseURL: 'https://vk.com/wall1_77' })).toBe(true);
expect(isTrustedLegacyPublication({ state: 'PUBLISHED', releaseId: 'undefined', releaseURL: 'https://vk.com/wall1_undefined' })).toBe(false);
expect(isTrustedLegacyPublication({ state: 'ERROR', releaseId: '77', releaseURL: 'https://vk.com/wall1_77' })).toBe(false);
expect(isTrustedLegacyPublication({ state: 'PUBLISHED', releaseId: null, releaseURL: null })).toBe(false);
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/streak/backfill-published-at.spec.ts`

Expected: FAIL because the helper and new schema fields do not exist.

- [ ] **Step 3: Add the additive Prisma fields**

```prisma
model User {
  timezoneName String?
}

model Post {
  publishedAt DateTime?
  @@index([publishedAt])
}
```

Keep existing `User.timezone` and `Organization.streakSince` fields for compatibility.

- [ ] **Step 4: Add the idempotent backfill script**

The script must run read-only counts first, then update only rows satisfying:

```sql
UPDATE "Post"
SET "publishedAt" = "updatedAt"
WHERE "publishedAt" IS NULL
  AND state = 'PUBLISHED'
  AND "releaseId" IS NOT NULL
  AND BTRIM("releaseId") <> ''
  AND "releaseId" <> 'undefined'
  AND COALESCE("releaseURL", '') NOT LIKE '%undefined%';
```

Follow `docs/devops/access-and-secrets.md`: no secrets in the script, use the
container's existing `POSTGRES_USER` and `POSTGRES_DB`, print before/after row
counts, and make reruns harmless.

- [ ] **Step 5: Generate Prisma and verify GREEN**

Run: `rtk pnpm run prisma-generate && rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/streak/backfill-published-at.spec.ts`

Expected: Prisma generation exits 0 and predicate tests PASS.

- [ ] **Step 6: Commit schema and backfill**

```bash
rtk git add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/streak/backfill-published-at.spec.ts docs/server-scripts/09-backfill-published-at.sh
rtk git commit -m "feat(streak): store confirmed publication timestamps"
```

### Task 2: Persist `publishedAt` atomically

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts:392-402`
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:80-82`
- Create: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.published-at.spec.ts`

**Interfaces:**
- Consumes: a verified `postId` and `releaseURL` from the provider workflow.
- Produces: `updatePost(id, postId, releaseURL, publishedAt?)` that writes publication identity, state, and time atomically.

- [ ] **Step 1: Write a failing repository test**

Freeze time and assert the Prisma update receives:

```ts
expect(model.post.update).toHaveBeenCalledWith({
  where: { id: 'post-1' },
  data: {
    state: 'PUBLISHED',
    releaseId: '77',
    releaseURL: 'https://vk.test/wall1_77',
    publishedAt: new Date('2026-07-29T07:00:00.000Z'),
  },
});
```

Add a guard test proving empty or `undefined` post IDs are rejected before the
repository update.

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.published-at.spec.ts`

Expected: FAIL because `publishedAt` is not written and invalid IDs are accepted.

- [ ] **Step 3: Implement the atomic success update**

Validate the provider ID in `PostsService.updatePost`, then set
`publishedAt: new Date()` in the repository's existing update. Do not set or
clear `publishedAt` in `changeState(ERROR)`.

- [ ] **Step 4: Run and verify GREEN**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.published-at.spec.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit publication persistence**

```bash
rtk git add libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.published-at.spec.ts
rtk git commit -m "feat(streak): timestamp verified publications"
```

### Task 3: Store and validate each user's IANA time zone

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/users/user-timezone.dto.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/users/user-timezone.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/users/user-timezone.spec.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/users/users.repository.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/users/users.service.ts`
- Modify: `apps/backend/src/api/routes/users.controller.ts`

**Interfaces:**
- Produces: `resolveUserCalendarZone(timezoneName: string | null, offsetMinutes: number): UserCalendarZone`.
- Produces: `PUT /user/timezone` accepting `{ timezoneName: string }`.
- Produces: `UsersService.updateTimezone(userId: string, timezoneName: string)`.

- [ ] **Step 1: Write failing time-zone tests**

```ts
expect(resolveUserCalendarZone('Europe/Moscow', 0)).toEqual({
  kind: 'iana',
  name: 'Europe/Moscow',
  label: 'Europe/Moscow',
});
expect(resolveUserCalendarZone('America/New_York', 0).kind).toBe('iana');
expect(() => resolveUserCalendarZone('Mars/Olympus', 0)).toThrow();
expect(resolveUserCalendarZone(null, 330)).toEqual({
  kind: 'offset',
  minutes: 330,
  label: 'UTC+05:30',
});
expect(resolveUserCalendarZone(null, 0)).toEqual({
  kind: 'iana',
  name: 'UTC',
  label: 'UTC',
});
```

Use `Intl.DateTimeFormat(undefined, { timeZone })` for IANA validation. Define
`UserCalendarZone` as a discriminated union so legacy fractional offsets do
not get passed to APIs that require an IANA identifier:

```ts
export type UserCalendarZone =
  | { kind: 'iana'; name: string; label: string }
  | { kind: 'offset'; minutes: number; label: string };
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/users/user-timezone.spec.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement validation and three-layer persistence**

The DTO validates a non-empty bounded string. The controller endpoint obtains
the authenticated `User`, calls the service, and returns the normalized stored
zone. The service validates before calling the repository. The repository uses:

```ts
return this._user.model.user.update({
  where: { id: userId },
  data: { timezoneName },
  select: { timezoneName: true },
});
```

Return `timezoneName` from `/user/self`.

- [ ] **Step 4: Run focused tests and backend build**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/users/user-timezone.spec.ts && rtk pnpm run build:backend`

Expected: test PASS and backend build exits 0.

- [ ] **Step 5: Commit user time-zone persistence**

```bash
rtk git add libraries/nestjs-libraries/src/dtos/users/user-timezone.dto.ts libraries/nestjs-libraries/src/database/prisma/users/user-timezone.ts libraries/nestjs-libraries/src/database/prisma/users/user-timezone.spec.ts libraries/nestjs-libraries/src/database/prisma/users/users.repository.ts libraries/nestjs-libraries/src/database/prisma/users/users.service.ts apps/backend/src/api/routes/users.controller.ts
rtk git commit -m "feat(streak): persist user calendar timezone"
```

### Task 4: Derive the personal calendar streak

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/streak.types.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/streak.calculator.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/streak.calculator.spec.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/streak.repository.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/streak/streak.service.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/database.module.ts`
- Modify: `apps/backend/src/api/routes/users.controller.ts`

**Interfaces:**
- Produces: `calculatePersonalStreak(localDates: string[], now: Date, timezone: UserCalendarZone): PersonalStreak`.
- Produces: `StreakRepository.getDistinctPublicationDates(orgId: string, timezone: UserCalendarZone): Promise<string[]>`.
- Produces: `GET /user/streak` returning `PersonalStreak`.

- [ ] **Step 1: Write failing pure calculator tests**

Use fake time and include these exact scenarios:

```ts
expect(calculatePersonalStreak(['2026-07-29', '2026-07-28', '2026-07-27'], now, 'Europe/Moscow').days).toBe(3);
expect(calculatePersonalStreak(['2026-07-28', '2026-07-27'], nowOnJuly29, 'Europe/Moscow').days).toBe(2);
expect(calculatePersonalStreak(['2026-07-27'], nowOnJuly29, 'Europe/Moscow').days).toBe(0);
expect(calculatePersonalStreak(['2026-07-29', '2026-07-29', '2026-07-28'], now, 'Europe/Moscow').days).toBe(2);
```

Add two users on opposite sides of UTC midnight and a DST transition in
`America/New_York`. Assert `nextChangeAt` is the correct future UTC instant.

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/streak/streak.calculator.spec.ts`

Expected: FAIL because the calculator does not exist.

- [ ] **Step 3: Implement the pure calculator**

Normalize and deduplicate `YYYY-MM-DD` inputs, compare them with today and
yesterday in the provided zone, walk backward one calendar day at a time, and
compute the first midnight where an unchanged streak can expire. Do not use
`milliseconds / 86_400_000`.

- [ ] **Step 4: Implement repository, service, and endpoint**

The repository must parameterize organization ID and every zone value. For an
IANA zone it converts UTC timestamps with PostgreSQL `timezone(zoneName, ...)`;
for a legacy fixed offset it adds `make_interval(mins => offsetMinutes)` before
casting to `date`. Both branches select distinct local dates only from rows
where `publishedAt IS NOT NULL` and `state = PUBLISHED`. The service obtains
the authenticated user's stored/fallback `UserCalendarZone` and passes sorted
dates to the calculator. The controller uses both `GetUserFromRequest` and
`GetOrgFromRequest`.

- [ ] **Step 5: Run calculator tests and backend build**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/streak/streak.calculator.spec.ts && rtk pnpm run build:backend`

Expected: tests PASS and build exits 0.

- [ ] **Step 6: Commit streak calculation**

```bash
rtk git add libraries/nestjs-libraries/src/database/prisma/streak apps/backend/src/api/routes/users.controller.ts libraries/nestjs-libraries/src/database/prisma/database.module.ts
rtk git commit -m "feat(streak): calculate personal calendar-day streaks"
```

### Task 5: Sync time zone and refresh the streak UI

**Files:**
- Create: `apps/frontend/src/components/layout/use.personal.streak.ts`
- Create: `apps/frontend/src/components/layout/streak.component.spec.tsx`
- Modify: `apps/frontend/src/components/layout/streak.component.tsx`
- Modify: `apps/frontend/src/components/new-layout/layout.component.tsx:62-69`
- Modify: `apps/frontend/src/components/layout/user.context.tsx`

**Interfaces:**
- Consumes: `GET /user/streak`, `PUT /user/timezone`, and existing `getTimezone()`.
- Produces: `usePersonalStreak()` with focus/reconnect/interval/boundary revalidation.

- [ ] **Step 1: Write failing component and hook tests**

With React Testing Library and fake timers, cover:

- `days: 3` renders `3` and the three-day tooltip;
- `days: 0` renders nothing;
- advancing to `nextChangeAt` invokes SWR mutate/refetch;
- focus/reconnect revalidation is enabled;
- a changed browser zone sends `PUT /user/timezone` once and revalidates user
  and streak data;
- the same stored/browser zone sends no update.

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run apps/frontend/src/components/layout/streak.component.spec.tsx`

Expected: FAIL because the component still derives elapsed milliseconds from `streakSince`.

- [ ] **Step 3: Implement the SWR hook and boundary timer**

Use a separate hook, as required by `CLAUDE.md`:

```ts
export const usePersonalStreak = () => useSWR<PersonalStreak>('/user/streak', loadStreak, {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 300_000,
});
```

Add an effect that schedules a timeout for `nextChangeAt`, calls `mutate`, and
clears the timeout on dependency change/unmount. Clamp delays above the browser
maximum timeout and reschedule rather than overflowing.

- [ ] **Step 4: Sync the selected/browser IANA zone**

After `/user/self` loads, compare `getTimezone()` with `user.timezoneName`.
When different, `PUT /user/timezone`, then call both user and streak mutate.
Guard the effect against repeated requests for the same zone.

- [ ] **Step 5: Run frontend tests and build**

Run: `rtk pnpm exec vitest run apps/frontend/src/components/layout/streak.component.spec.tsx && rtk pnpm run build:frontend`

Expected: tests PASS and frontend build exits 0.

- [ ] **Step 6: Commit the frontend behavior**

```bash
rtk git add apps/frontend/src/components/layout/use.personal.streak.ts apps/frontend/src/components/layout/streak.component.tsx apps/frontend/src/components/layout/streak.component.spec.tsx apps/frontend/src/components/new-layout/layout.component.tsx apps/frontend/src/components/layout/user.context.tsx
rtk git commit -m "feat(streak): show personal calendar streaks"
```

### Task 6: Replace rolling workflow with personal local-day reminders

**Files:**
- Create: `apps/orchestrator/src/workflows/personal-streak-reminder.workflow.ts`
- Create: `apps/orchestrator/src/workflows/personal-streak-reminder.workflow.spec.ts`
- Modify: `apps/orchestrator/src/workflows/index.ts`
- Modify: `apps/orchestrator/src/activities/email.activity.ts`
- Modify: `apps/orchestrator/src/activities/post.activity.ts:253-266`
- Modify: streak service/repository files from Task 4 to expose reminder checks.
- Modify: `libraries/nestjs-libraries/src/database/prisma/users/users.service.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/users/users.repository.ts`

**Interfaces:**
- Produces: `personalStreakReminderWorkflow({ organizationId, userId })`.
- Produces: activities `getStreakReminderContext`, `hasPublishedOnLocalDate`, and `sendStreakReminder`.
- Produces: workflow ID `streak_<organizationId>_<userId>`.

- [ ] **Step 1: Write failing workflow tests**

Mock workflow time and activities to prove:

- after a confirmed post, the workflow targets 22:00 on the next local day;
- it sends one reminder when the streak is active and that day has no post;
- it sends nothing when the user disabled streak emails;
- it sends nothing when a post exists on that local day;
- a replacement workflow uses an updated time zone;
- after the local day ends empty, the workflow exits.

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run apps/orchestrator/src/workflows/personal-streak-reminder.workflow.spec.ts`

Expected: FAIL because the personal workflow does not exist.

- [ ] **Step 3: Implement current-state activities**

Every activity reloads the user, organization membership, email preference,
time zone, and confirmed publication state from the database. Return plain
serializable values. Log failures with organization/user IDs but no email or
credentials.

- [ ] **Step 4: Implement and register the personal workflow**

Use calendar calculations to derive the next local 22:00 and midnight UTC
instants. Sleep until 22:00, reload state, conditionally send the existing
reminder copy, then sleep until midnight and exit if the local day remained
empty.

- [ ] **Step 5: Start one workflow per enabled organization user**

After a confirmed provider return, load enabled team users and start each
workflow with `workflowIdConflictPolicy: 'TERMINATE_EXISTING'`. Remove the call
that starts the legacy organization-only `streakWorkflow`. A failure to start
reminders is logged but must not cause the already-successful post to become
`ERROR`.

- [ ] **Step 6: Run workflow tests and orchestrator build**

Run: `rtk pnpm exec vitest run apps/orchestrator/src/workflows/personal-streak-reminder.workflow.spec.ts && rtk pnpm run build:orchestrator`

Expected: tests PASS and build exits 0.

- [ ] **Step 7: Commit personal reminders**

```bash
rtk git add apps/orchestrator/src/workflows/personal-streak-reminder.workflow.ts apps/orchestrator/src/workflows/personal-streak-reminder.workflow.spec.ts apps/orchestrator/src/workflows/index.ts apps/orchestrator/src/activities/email.activity.ts apps/orchestrator/src/activities/post.activity.ts libraries/nestjs-libraries/src/database/prisma/streak libraries/nestjs-libraries/src/database/prisma/users
rtk git commit -m "feat(streak): schedule personal local-day reminders"
```

### Task 7: Combined verification and rollout evidence

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1-6 and the completed VK reliability plan.
- Produces: fresh test/build evidence and a safe production rollout checklist.

- [ ] **Step 1: Generate Prisma and run all focused tests**

Run: `rtk pnpm run prisma-generate && rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.published-at.spec.ts libraries/nestjs-libraries/src/database/prisma/users/user-timezone.spec.ts libraries/nestjs-libraries/src/database/prisma/streak/streak.calculator.spec.ts apps/frontend/src/components/layout/streak.component.spec.tsx apps/orchestrator/src/workflows/personal-streak-reminder.workflow.spec.ts`

Expected: all focused tests PASS.

- [ ] **Step 2: Run affected builds**

Run: `rtk pnpm run build:backend && rtk pnpm run build:orchestrator && rtk pnpm run build:frontend`

Expected: all builds exit 0.

- [ ] **Step 3: Run repository-wide tests**

Run: `rtk pnpm test -- --runInBand`

Expected: exit 0 with no test failures.

- [ ] **Step 4: Inspect final branch state**

Run: `rtk git diff --check $(git merge-base HEAD prod)..HEAD && rtk git status --short`

Expected: no whitespace errors and no uncommitted implementation files.

- [ ] **Step 5: Prepare rollout without executing it**

Record this order in the handoff:

1. deploy schema/application;
2. run `docs/server-scripts/09-backfill-published-at.sh` once and record counts;
3. reconnect the personal VK channel;
4. publish one explicitly approved controlled media post;
5. verify real `releaseId`, VK URL, `publishedAt`, and streak endpoint output;
6. do not replay historical posts without separate approval.
