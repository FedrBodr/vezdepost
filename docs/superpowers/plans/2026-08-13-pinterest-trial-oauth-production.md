# Pinterest Trial OAuth Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the approved Pinterest Trial application in production Vezdepost, preserve rotated refresh tokens, and verify OAuth plus board discovery without publishing a Pin.

**Architecture:** Keep the existing Pinterest provider and integration persistence flow. Add one focused provider fix, require Pinterest credentials in the tracked production Compose override, and deploy both code and credentials through one guarded script that locks autodeploy, backs up state, recreates only `postiz`, and rolls back on failure.

**Tech Stack:** TypeScript, Vitest, Bash, Docker Compose, PNPM, Pinterest API v5 OAuth.

## Global Constraints

- Every shell command is prefixed with `rtk`.
- Never print or commit Pinterest client credentials, OAuth tokens, authorization codes, cookies, passwords, or production `.env` contents.
- Report credential state only as `set` or `missing`.
- Preserve existing user changes and untracked files.
- Back up every production configuration file before changing it.
- Recreate only the `postiz` service; do not restart Docker or unrelated services.
- Do not create or publish a public Pinterest Pin in this phase.
- Trial access is sufficient only for OAuth, account, boards, and unpublished-draft validation; Standard access remains a follow-up.

## File map

- Create `libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts`: isolate and verify Pinterest refresh-token behavior.
- Modify `libraries/nestjs-libraries/src/integrations/social/pinterest.provider.ts`: retain Pinterest's rotated refresh token with a safe fallback.
- Modify `deploy/production-config.spec.ts`: require tracked Pinterest environment pass-through and documentation.
- Modify `docker-compose.override.yaml`: require Pinterest credentials from the untracked production `.env`.
- Modify `deploy/README.md`: document the callback, hidden credential workflow, Trial boundary, and exact guarded deployment command.
- Create `docs/server-scripts/19-deploy-pinterest-trial.sh`: configure and deploy Pinterest safely at one exact revision.
- Create `docs/server-scripts/19-deploy-pinterest-trial.spec.sh`: test redaction, backups, minimal service scope, health checks, and rollback with command stubs.

---

### Task 1: Preserve Pinterest refresh-token rotation

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/pinterest.provider.ts:129-164`

**Interfaces:**
- Consumes: `PinterestProvider.refreshToken(refreshToken: string): Promise<AuthTokenDetails>` and the existing `AuthTokenDetails.refreshToken` field.
- Produces: the same method signature, returning the response `refresh_token` when present and its input token otherwise.

- [ ] **Step 1: Write failing refresh-token tests**

Create a focused Vitest file with hoisted `fetch` mocks and the same dependency-isolation pattern as `tumblr.provider.spec.ts`. The two test cases must use sequential token and profile responses:

```ts
it('returns the rotated refresh token from Pinterest', async () => {
  mocks.fetch
    .mockResolvedValueOnce(response({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 2592000,
    }))
    .mockResolvedValueOnce(response({
      id: 'account-1',
      username: 'vezdepost',
      profile_image: 'https://cdn.example/avatar.png',
    }));

  await expect(
    new PinterestProvider().refreshToken('old-refresh-token')
  ).resolves.toMatchObject({
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
    expiresIn: 2592000,
  });
});

it('keeps the previous refresh token when Pinterest omits a replacement', async () => {
  mocks.fetch
    .mockResolvedValueOnce(response({
      access_token: 'new-access-token',
      expires_in: 2592000,
    }))
    .mockResolvedValueOnce(response({
      id: 'account-1',
      username: 'vezdepost',
      profile_image: '',
    }));

  await expect(
    new PinterestProvider().refreshToken('old-refresh-token')
  ).resolves.toMatchObject({ refreshToken: 'old-refresh-token' });
});
```

Set `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`, and `FRONTEND_URL` to non-secret fixtures in `beforeEach`. The response helper is:

```ts
const response = (body: Record<string, unknown>) =>
  ({ json: vi.fn().mockResolvedValue(body) }) as unknown as Response;
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts
```

Expected: the rotated-token test fails because the provider returns `old-refresh-token`.

- [ ] **Step 3: Implement the minimal provider change**

Change only the refresh response destructuring and returned token:

```ts
const { access_token, refresh_token, expires_in } = await (
  await fetch('https://api.pinterest.com/v5/oauth/token', {
    // existing request remains unchanged
  })
).json();

return {
  id,
  name: username,
  accessToken: access_token,
  refreshToken: refresh_token || refreshToken,
  expiresIn: expires_in,
  picture: profile_image || '',
  username,
};
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit the provider fix**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/pinterest.provider.ts libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts
rtk git commit -m 'fix: preserve rotated Pinterest refresh tokens'
```

---

### Task 2: Track required Pinterest production configuration

**Files:**
- Modify: `deploy/production-config.spec.ts`
- Modify: `docker-compose.override.yaml`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: untracked `.env` keys `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`.
- Produces: required environment values inside every recreated `postiz` container and documented callback `https://app.vezdepost.ru/integrations/social/pinterest`.

- [ ] **Step 1: Add the failing production configuration test**

Append this test to `deploy/production-config.spec.ts`:

```ts
it('requires Pinterest credentials and documents the Trial OAuth setup', () => {
  const override = readRootFile('docker-compose.override.yaml');
  const readme = readRootFile('deploy/README.md');

  expect(override).toContain(
    "PINTEREST_CLIENT_ID: '${PINTEREST_CLIENT_ID:?set in .env}'"
  );
  expect(override).toContain(
    "PINTEREST_CLIENT_SECRET: '${PINTEREST_CLIENT_SECRET:?set in .env}'"
  );
  expect(readme).toContain(
    'https://app.vezdepost.ru/integrations/social/pinterest'
  );
  expect(readme).toContain('Trial access');
  expect(readme).toContain('19-deploy-pinterest-trial.sh');
});
```

- [ ] **Step 2: Run the production configuration test and verify RED**

Run:

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
```

Expected: the new test fails because the production override and README do not yet configure Pinterest.

- [ ] **Step 3: Add required Compose interpolation**

Add the two variable names to the secret inventory comment and add these entries beside the other social OAuth credentials:

```yaml
      PINTEREST_CLIENT_ID: '${PINTEREST_CLIENT_ID:?set in .env}'
      PINTEREST_CLIENT_SECRET: '${PINTEREST_CLIENT_SECRET:?set in .env}'
```

- [ ] **Step 4: Document the production Pinterest flow**

Add a `## Pinterest` section to `deploy/README.md` containing:

```markdown
## Pinterest

Use the exact OAuth callback URL:

`https://app.vezdepost.ru/integrations/social/pinterest`

The provider requests only `boards:read`, `boards:write`, `pins:read`,
`pins:write`, and `user_accounts:read`. Configure
`PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET` through the guarded script;
enter both values only at its hidden prompts.

Trial access is used to validate OAuth, the authenticated Business account,
board discovery, and an unpublished draft. Do not publish a public Pin until
Standard access is active and the user explicitly approves the test.
```

Document the exact `scp` and interactive `ssh -tt` commands for script 19, following the Tumblr section's copy-first pattern. State that the script recreates only `postiz`, rolls back on failure, and never publishes a Pin.

- [ ] **Step 5: Run the production configuration test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
```

Expected: all production configuration tests pass.

- [ ] **Step 6: Commit production configuration**

```bash
rtk git add docker-compose.override.yaml deploy/production-config.spec.ts deploy/README.md
rtk git commit -m 'ops: require Pinterest production credentials'
```

---

### Task 3: Add the guarded Pinterest configuration and deployment script

**Files:**
- Create: `docs/server-scripts/19-deploy-pinterest-trial.spec.sh`
- Create: `docs/server-scripts/19-deploy-pinterest-trial.sh`

**Interfaces:**
- Consumes: one lowercase 40-character expected SHA, hidden stdin values for `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`, `/root/postiz-app`, the existing autodeploy lock, Docker Compose, and the production `.env`.
- Produces: backed-up and atomically updated `.env`, exact deployed revision marker, a healthy minimally recreated `postiz`, and status-only output.

- [ ] **Step 1: Write the failing shell contract tests**

Create a self-contained shell spec based on the stub structure of `18-deploy-tumblr-multipart.spec.sh`. It must provide stubbed `git`, `docker`, `curl`, `flock`, and `sleep` executables and run these cases:

```bash
run_success_case
run_invalid_sha_case
run_missing_credential_case
run_compose_validation_failure_case
run_build_failure_rollback_case
run_environment_retry_case
run_secret_redaction_case
echo 'Pinterest trial deployment script tests passed'
```

The success case pipes two fixture values through stdin and asserts all of these exact observable contracts:

```bash
grep -q '^fetch --no-recurse-submodules origin prod$' "$git_calls"
grep -q "^reset --hard $expected_rev$" "$git_calls"
grep -q '^compose config -q$' "$docker_calls"
grep -q '^compose build postiz$' "$docker_calls"
grep -q '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls"
grep -q '^exec postiz sh -lc .*PINTEREST_CLIENT_ID' "$docker_calls"
! grep -Eq '^compose (down|restart)|^restart ' "$docker_calls"
grep -q '^PINTEREST_CLIENT_ID=client-id-fixture$' "$repo/.env"
grep -q '^PINTEREST_CLIENT_SECRET=client-secret-fixture$' "$repo/.env"
[[ "$(stat -f '%Lp' "$repo/.env" 2>/dev/null || stat -c '%a' "$repo/.env")" == 600 ]]
```

The rollback cases assert that the original `.env` bytes, previous Git revision, prior image tag, and minimally recreated old `postiz` are restored. The redaction case searches combined stdout/stderr, Git calls, Docker calls, and curl calls and fails if either fixture credential appears outside the resulting `.env` test fixture.

- [ ] **Step 2: Run the shell spec and verify RED**

Run:

```bash
rtk bash docs/server-scripts/19-deploy-pinterest-trial.spec.sh
```

Expected: failure because `19-deploy-pinterest-trial.sh` does not exist.

- [ ] **Step 3: Implement safe credential input and atomic `.env` update**

Start the script with strict mode, validate the SHA, acquire the lock, then use hidden prompts only when stdin is a terminal:

```bash
read_secret() {
  local prompt=$1
  local value
  if [[ -t 0 ]]; then
    IFS= read -r -s -p "$prompt" value
    printf '\n' >&2
  else
    IFS= read -r value
  fi
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

PINTEREST_CLIENT_ID_VALUE=$(read_secret 'Pinterest App ID: ') || {
  echo 'Pinterest App ID is required' >&2
  exit 2
}
PINTEREST_CLIENT_SECRET_VALUE=$(read_secret 'Pinterest App secret: ') || {
  echo 'Pinterest App secret is required' >&2
  exit 2
}
```

Create `$REPO_DIR/.env.backup-$TIMESTAMP`, copy the original `.env` with mode preservation, and install an atomically generated replacement with mode `600`. Remove only existing `PINTEREST_CLIENT_ID=` and `PINTEREST_CLIENT_SECRET=` lines, then append the two new shell-safe values without printing them. Reject values containing newline or carriage-return characters.

- [ ] **Step 4: Implement exact-revision deployment and verification**

Follow the proven script 18 deployment sequence with these Pinterest-specific requirements:

```bash
git fetch --no-recurse-submodules origin prod
git reset --hard "$EXPECTED_REV"
docker compose config -q
docker compose build postiz
docker compose up -d --no-deps --force-recreate postiz
```

Poll status without expanding values:

```bash
docker exec "$POSTIZ_CONTAINER" sh -lc \
  'test -n "${PINTEREST_CLIENT_ID:-}" && test -n "${PINTEREST_CLIENT_SECRET:-}"'
```

Reuse the established port checks for `3000`, `4200`, and `5000`, accept a non-`000`/non-`502` response from `https://app.vezdepost.ru/api/user/self`, verify the Temporal `main` workflow queue, and retain the `mastra_ai_spans` attribute-limit guard.

On any failure after configuration mutation, restore the exact `.env` backup, previous revision, and previous `postiz-max:local` image, then recreate only `postiz`. On success print only completion, backup paths, revision, and status labels; never print credentials.

- [ ] **Step 5: Run the shell spec and verify GREEN**

Run:

```bash
rtk bash docs/server-scripts/19-deploy-pinterest-trial.spec.sh
```

Expected: `Pinterest trial deployment script tests passed`.

- [ ] **Step 6: Run static shell validation**

Run:

```bash
rtk bash -n docs/server-scripts/19-deploy-pinterest-trial.sh
rtk bash -n docs/server-scripts/19-deploy-pinterest-trial.spec.sh
```

Expected: both commands exit 0 with no output.

- [ ] **Step 7: Commit the guarded deployment workflow**

```bash
rtk git add docs/server-scripts/19-deploy-pinterest-trial.sh docs/server-scripts/19-deploy-pinterest-trial.spec.sh deploy/README.md
rtk git commit -m 'ops: deploy Pinterest trial OAuth safely'
```

---

### Task 4: Verify the complete local change set

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: evidence that the exact focused tests and workspace verification pass before production work.

- [ ] **Step 1: Run focused tests together**

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts deploy/production-config.spec.ts
rtk bash docs/server-scripts/19-deploy-pinterest-trial.spec.sh
```

Expected: all Vitest and shell cases pass.

- [ ] **Step 2: Verify the workspace bootstrap and formatting**

```bash
rtk pnpm run verify:workspace
rtk pnpm exec prettier --check libraries/nestjs-libraries/src/integrations/social/pinterest.provider.ts libraries/nestjs-libraries/src/integrations/social/pinterest.provider.spec.ts deploy/production-config.spec.ts deploy/README.md docker-compose.override.yaml docs/superpowers/specs/2026-08-13-pinterest-trial-oauth-production-design.md docs/superpowers/plans/2026-08-13-pinterest-trial-oauth-production.md
rtk git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Review scope and secret hygiene**

```bash
rtk git status --short
rtk git log --oneline -6
rtk rg -n 'PINTEREST_CLIENT_(ID|SECRET)' docker-compose.override.yaml deploy/README.md docs/server-scripts/19-deploy-pinterest-trial.sh
```

Expected: only intended tracked files changed; tracked files contain variable names and safe interpolation only, never real values.

---

### Task 5: Configure and deploy production safely

**Files:**
- Production mutation: `/root/postiz-app/.env`, `/root/postiz-app` checkout, and `postiz-max:local` image.
- Production backups: timestamped `.env` backup and `postiz-max:pinterest-trial-backup-*` image.

**Interfaces:**
- Consumes: verified local HEAD, hidden Pinterest App ID and App secret, SSH alias `vezdepost`, and fast-forward access to `origin/prod`.
- Produces: exact production SHA with Pinterest credentials present in only the `postiz` container.

- [ ] **Step 1: Confirm production is ready without revealing secrets**

Use read-only checks for server revision, branch, autodeploy state, service health, and presence-only status for both Pinterest variables. Do not read or print `.env`.

- [ ] **Step 2: Copy and start the guarded script before pushing**

```bash
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/19-deploy-pinterest-trial.sh vezdepost:/tmp/vezdepost-deploy-pinterest-trial.sh
rtk ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost "status=0; bash /tmp/vezdepost-deploy-pinterest-trial.sh $(rtk git rev-parse HEAD) || status=\$?; rm -f /tmp/vezdepost-deploy-pinterest-trial.sh; exit \"\$status\""
```

At this point stop and give the user one exact instruction: enter the Pinterest App ID and App secret at the two hidden prompts, then report `готово`. Never request either value in chat.

- [ ] **Step 3: Push the exact verified revision while the guarded script holds the lock**

After the hidden inputs are accepted and the script waits for the revision:

```bash
rtk git push origin HEAD:prod
```

Expected: fast-forward push succeeds; the remote script builds and recreates only `postiz`.

- [ ] **Step 4: Verify the completed deployment read-only**

Confirm the server HEAD and deployed-revision marker equal local HEAD; `postiz` is healthy; the public API is not `000` or `502`; the Temporal worker is present; and both Pinterest variables report `set` inside the container. Do not reveal their values.

---

### Task 6: Complete Pinterest Trial OAuth and board validation

**Files:**
- No repository or production configuration modifications expected.

**Interfaces:**
- Consumes: production Vezdepost UI, approved Pinterest Trial application, exact callback, and the user's signed-in Pinterest Business session.
- Produces: visible Pinterest integration, discovered boards, and a valid unpublished draft.

- [ ] **Step 1: Start OAuth in production UI**

Ask the user to open Vezdepost Integrations and click Pinterest. If Pinterest requests login, 2FA, CAPTCHA, or consent, stop and provide one exact UI instruction at a time.

- [ ] **Step 2: Verify the OAuth result**

Success requires returning to Vezdepost without an OAuth error and seeing the intended Pinterest Business account in Integrations. If it fails, inspect redacted production logs and report no credential or token values.

- [ ] **Step 3: Verify board discovery**

Open a Pinterest draft and confirm the board selector loads the authenticated account's boards. Verify the selected board belongs to the intended test Business account.

- [ ] **Step 4: Validate an unpublished draft**

Prepare a draft with one existing image, a title, description, optional destination link, and selected board. Save or leave it unpublished according to the UI's safe draft behavior. Do not click a control that publishes or schedules it.

- [ ] **Step 5: Record the phase result**

Record provider enabled, environment variables set, callback match, OAuth result, account visibility, board discovery, and draft result. Record `Pinterest Standard access` as the concrete external blocker for public publishing and request a separate confirmation before any eventual public test.
