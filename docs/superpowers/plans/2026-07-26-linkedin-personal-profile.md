# LinkedIn Personal Profile Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a Vezdepost user to connect a personal LinkedIn profile and publish to its feed with LinkedIn's self-service consumer permissions.

**Architecture:** Keep the existing `LinkedinProvider` as the personal-profile provider, but reduce its OAuth contract to OIDC plus `w_member_social`, use `userinfo` as the sole identity source, and reject missing credentials before redirecting. Keep `LinkedinPageProvider` unchanged, wire production credentials from the untracked server `.env`, and use an idempotent server script for the state-changing rollout.

**Tech Stack:** TypeScript, NestJS shared libraries, Vitest, PNPM, Docker Compose, Bash, LinkedIn OAuth 2.0/OIDC.

## Global Constraints

- Personal LinkedIn OAuth requests exactly `openid`, `profile`, and `w_member_social`.
- The personal authorization request must not contain `prompt=none`, `r_basicprofile`, or organization permissions.
- The exact production redirect URI is `https://app.vezdepost.ru/integrations/social/linkedin`.
- `LinkedinPageProvider` and organization functionality remain unchanged.
- Client Secret and access tokens must never enter Git, Docker image layers, logs, command output, or chat.
- Use PNPM only and run tests, lint, and build commands from the monorepo root.
- Execute implementation in an isolated git worktree and preserve unrelated files in the primary checkout.
- Prepare the production `.env` before merging Compose interpolation that requires non-empty LinkedIn credentials.

---

## File map

- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`: owns the personal OAuth URL, credential validation, token exchange, refresh, and OIDC identity mapping.
- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts`: focused tests for personal OAuth and identity behavior, alongside the existing publishing tests.
- `docker-compose.override.yaml`: forwards the production LinkedIn credential pair from the untracked server `.env` into the `postiz` container.
- `deploy/production-config.spec.ts`: statically verifies tracked production wiring and operator documentation.
- `deploy/README.md`: documents LinkedIn Developer Portal products, callback, and secret names.
- `docs/server-scripts/13-configure-linkedin-personal.sh`: validates server-side secrets, recreates the app container, and verifies only non-secret state.

---

### Task 1: Personal OAuth URL and credential validation

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts:29-42,141-156`
- Test: `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts`

**Interfaces:**
- Consumes: `FRONTEND_URL`, `LINKEDIN_CLIENT_ID`, and `LINKEDIN_CLIENT_SECRET`.
- Produces: `LinkedinProvider.generateAuthUrl(): Promise<GenerateAuthUrlResponse>` with exactly the personal scopes and a normal interactive authorization flow.
- Produces internally: `getClientCredentials(): { clientId: string; clientSecret: string }`, used by all personal OAuth operations.

- [ ] **Step 1: Extend the provider test harness with deterministic environment cleanup**

Change the Vitest import and test setup in `linkedin.provider.spec.ts` to include `afterEach`, a saved environment, and a mocked `checkScopes` method:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

// Inside the existing SocialAbstract mock class:
checkScopes() {
  return undefined;
}

// Replace the existing beforeEach and add afterEach:
beforeEach(() => {
  vi.restoreAllMocks();
  process.env = {
    ...originalEnv,
    FRONTEND_URL: 'https://app.vezdepost.ru',
    LINKEDIN_CLIENT_ID: 'linkedin-client-id',
    LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Write failing tests for the authorization URL and missing credentials**

Append this focused suite to `linkedin.provider.spec.ts`:

```ts
describe('LinkedinProvider personal OAuth configuration', () => {
  it('generates an interactive authorization URL with only personal scopes', async () => {
    const { url } = await new LinkedinProvider().generateAuthUrl();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://www.linkedin.com/oauth/v2/authorization'
    );
    expect(parsed.searchParams.get('client_id')).toBe('linkedin-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.vezdepost.ru/integrations/social/linkedin'
    );
    expect(parsed.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'profile',
      'w_member_social',
    ]);
    expect(parsed.searchParams.has('prompt')).toBe(false);
  });

  it('fails locally when the Client ID is missing', async () => {
    delete process.env.LINKEDIN_CLIENT_ID;

    await expect(new LinkedinProvider().generateAuthUrl()).rejects.toThrow(
      'LINKEDIN_CLIENT_ID is not configured'
    );
  });

  it('fails locally when the Client Secret is missing', async () => {
    delete process.env.LINKEDIN_CLIENT_SECRET;

    await expect(new LinkedinProvider().generateAuthUrl()).rejects.toThrow(
      'LINKEDIN_CLIENT_SECRET is not configured'
    );
  });
});
```

- [ ] **Step 3: Run the focused test and confirm it fails for the expected reasons**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
```

Expected: the three new assertions fail because the provider still requests organization scopes, includes `prompt=none`, and does not reject empty credentials locally; existing publishing tests remain green.

- [ ] **Step 4: Implement validated credentials and the minimal authorization URL**

Replace the personal provider's `scopes` property with:

```ts
scopes = ['openid', 'profile', 'w_member_social'];
```

Add this private helper after `maxLength()`:

```ts
private getClientCredentials() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    throw new Error('LINKEDIN_CLIENT_ID is not configured');
  }

  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error('LINKEDIN_CLIENT_SECRET is not configured');
  }

  return { clientId, clientSecret };
}
```

Replace `generateAuthUrl()` with:

```ts
async generateAuthUrl() {
  const { clientId } = this.getClientCredentials();
  const state = makeId(6);
  const codeVerifier = makeId(30);
  const url = new URL(
    'https://www.linkedin.com/oauth/v2/authorization'
  );
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set(
    'redirect_uri',
    `${process.env.FRONTEND_URL}/integrations/social/linkedin`
  );
  url.searchParams.set('state', state);
  url.searchParams.set('scope', this.scopes.join(' '));

  return {
    url: url.toString(),
    codeVerifier,
    state,
  };
}
```

- [ ] **Step 5: Run the focused provider suite**

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
```

Expected: all tests pass; the suite performs no network requests.

- [ ] **Step 6: Commit the personal authorization behavior**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
rtk git commit -m "fix: use personal LinkedIn OAuth scopes"
```

---

### Task 2: OIDC-only identity for authentication and refresh

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts:87-137,158-211`
- Test: `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts`

**Interfaces:**
- Consumes: the `getClientCredentials()` helper from Task 1 and LinkedIn `userinfo` claims `{ sub, name, picture }`.
- Produces: `authenticate(...)` and `refreshToken(...)` results with `id = sub`, `name`, `picture`, and `username = ''` without requesting `/v2/me`.

- [ ] **Step 1: Add a JSON response helper to the test file**

Place this below `originalEnv`:

```ts
const jsonResponse = (body: unknown) =>
  ({
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;
```

- [ ] **Step 2: Write a failing authentication test**

Append this test inside `describe('LinkedinProvider personal OAuth configuration', ...)`:

```ts
it('authenticates with OIDC userinfo and does not request the legacy profile', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'openid profile w_member_social',
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        sub: 'person-1',
        name: 'Personal Profile',
        picture: 'https://cdn.test/profile.jpg',
      })
    );
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    new LinkedinProvider().authenticate({
      code: 'authorization-code',
      codeVerifier: 'unused-code-verifier',
    })
  ).resolves.toEqual({
    id: 'person-1',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 3600,
    name: 'Personal Profile',
    picture: 'https://cdn.test/profile.jpg',
    username: '',
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://www.linkedin.com/oauth/v2/accessToken',
    'https://api.linkedin.com/v2/userinfo',
  ]);
});
```

- [ ] **Step 3: Write a failing refresh test**

Append this test to the same suite:

```ts
it('refreshes identity through OIDC userinfo without requesting /v2/me', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        sub: 'person-1',
        name: 'Personal Profile',
        picture: 'https://cdn.test/profile.jpg',
      })
    );
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    new LinkedinProvider().refreshToken('old-refresh-token')
  ).resolves.toEqual({
    id: 'person-1',
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
    expiresIn: 7200,
    name: 'Personal Profile',
    picture: 'https://cdn.test/profile.jpg',
    username: '',
  });

  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://www.linkedin.com/oauth/v2/accessToken',
    'https://api.linkedin.com/v2/userinfo',
  ]);
});
```

- [ ] **Step 4: Run the tests and confirm both identity tests fail**

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
```

Expected: both new tests fail because the current implementation performs a third `/v2/me` request and returns `vanityName` instead of an empty username.

- [ ] **Step 5: Update the refresh flow to use validated credentials and `userinfo` only**

At the start of `refreshToken`, add:

```ts
const { clientId, clientSecret } = this.getClientCredentials();
```

Use `clientId` and `clientSecret` in the refresh token request body. Remove the
entire `/v2/me` fetch. Keep the existing `userinfo` request, and return:

```ts
return {
  id,
  accessToken,
  refreshToken,
  expiresIn: expires_in,
  name,
  picture: picture || '',
  username: '',
};
```

- [ ] **Step 6: Update authorization-code authentication to use `userinfo` only**

At the start of `authenticate`, add:

```ts
const { clientId, clientSecret } = this.getClientCredentials();
```

Append `clientId` and `clientSecret` to the token-exchange body instead of
reading `process.env` directly. Remove the entire `/v2/me` fetch, keep
`this.checkScopes(this.scopes, scope)`, and return:

```ts
return {
  id,
  accessToken,
  refreshToken,
  expiresIn,
  name,
  picture,
  username: '',
};
```

- [ ] **Step 7: Run the focused provider suite**

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
```

Expected: all authorization, identity, refresh, and existing publishing tests pass with no real network access.

- [ ] **Step 8: Commit OIDC identity handling**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
rtk git commit -m "fix: use LinkedIn OIDC profile identity"
```

---

### Task 3: Production environment wiring and operator documentation

**Files:**
- Modify: `docker-compose.override.yaml:1-10,36-60`
- Modify: `deploy/production-config.spec.ts`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: non-empty `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` entries in the untracked production `.env`.
- Produces: both variables in the `postiz` container and tracked setup documentation with the exact callback and LinkedIn product names.

- [ ] **Step 1: Write a failing production configuration test**

Append this test inside `describe('production configuration', ...)`:

```ts
it('requires personal LinkedIn credentials and documents the OAuth setup', () => {
  const override = readRootFile('docker-compose.override.yaml');
  const readme = readRootFile('deploy/README.md');

  expect(override).toContain(
    "LINKEDIN_CLIENT_ID: '${LINKEDIN_CLIENT_ID:?set in .env}'"
  );
  expect(override).toContain(
    "LINKEDIN_CLIENT_SECRET: '${LINKEDIN_CLIENT_SECRET:?set in .env}'"
  );
  expect(readme).toContain('Sign In with LinkedIn using OpenID Connect');
  expect(readme).toContain('Share on LinkedIn');
  expect(readme).toContain(
    'https://app.vezdepost.ru/integrations/social/linkedin'
  );
});
```

- [ ] **Step 2: Run the production configuration test and confirm it fails**

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
```

Expected: the new test fails because the production override and README do not yet contain LinkedIn configuration.

- [ ] **Step 3: Require the LinkedIn credential pair in the production override**

Add `LINKEDIN_CLIENT_ID=...` and `LINKEDIN_CLIENT_SECRET=...` to the secret-name
list in the header comment of `docker-compose.override.yaml`. Add these entries
below the Google credential pair in the `postiz.environment` block:

```yaml
      LINKEDIN_CLIENT_ID: '${LINKEDIN_CLIENT_ID:?set in .env}'
      LINKEDIN_CLIENT_SECRET: '${LINKEDIN_CLIENT_SECRET:?set in .env}'
```

- [ ] **Step 4: Document LinkedIn Developer Portal setup**

Add this section to `deploy/README.md` before `## X`:

```markdown
## LinkedIn personal profiles

Create an application in the LinkedIn Developer Portal and enable
**Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**. Add
this exact authorized redirect URL:

`https://app.vezdepost.ru/integrations/social/linkedin`

Put its Client ID in `LINKEDIN_CLIENT_ID` and Client Secret in
`LINKEDIN_CLIENT_SECRET` in the server `.env`. The personal integration asks
only for `openid profile w_member_social`. Never commit or print the Client
Secret.
```

Also extend the opening README secret list with the two LinkedIn variable names.

- [ ] **Step 5: Run static production checks**

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
rtk git diff --check
rtk rg -n "LINKEDIN_CLIENT_(ID|SECRET)" .env.example docker-compose.yaml docker-compose.override.yaml deploy/README.md
```

Expected: production configuration tests pass; the scan shows only empty examples, variable interpolation, and variable names—never real values.

- [ ] **Step 6: Commit environment wiring and documentation**

```bash
rtk git add docker-compose.override.yaml deploy/production-config.spec.ts deploy/README.md
rtk git commit -m "chore: wire LinkedIn production settings"
```

---

### Task 4: Idempotent production configuration script

**Files:**
- Create: `docs/server-scripts/13-configure-linkedin-personal.sh`

**Interfaces:**
- Consumes: `/root/postiz-app/.env` and the production Docker Compose project.
- Produces: a recreated `postiz` container with two confirmed non-empty LinkedIn variables; outputs names and pass/fail state only.

- [ ] **Step 1: Create the server script**

Create `docs/server-scripts/13-configure-linkedin-personal.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
cd "$REPO_DIR"

for name in LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET; do
  if ! grep -Eq "^${name}=.+" .env; then
    echo "Missing non-empty ${name} in $REPO_DIR/.env" >&2
    exit 1
  fi
done

docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate postiz

for name in LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET; do
  if ! docker exec postiz sh -lc "test -n \"\${${name}:-}\""; then
    echo "${name} is missing in the running container" >&2
    exit 1
  fi
done

echo 'LinkedIn personal OAuth credentials are present in the postiz container'
```

- [ ] **Step 2: Make the script executable and validate it**

```bash
chmod +x docs/server-scripts/13-configure-linkedin-personal.sh
rtk bash -n docs/server-scripts/13-configure-linkedin-personal.sh
rtk git diff --check
```

Expected: syntax and whitespace checks exit `0`; no secret value is printed.

- [ ] **Step 3: Commit the operations script**

```bash
rtk git add docs/server-scripts/13-configure-linkedin-personal.sh
rtk git commit -m "ops: configure personal LinkedIn OAuth"
```

---

### Task 5: Repository verification before production rollout

**Files:**
- Test only; no new files.

**Interfaces:**
- Consumes: committed changes from Tasks 1–4.
- Produces: test, build, diff, and credential-hygiene evidence before merge.

- [ ] **Step 1: Run all focused tests**

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts deploy/production-config.spec.ts
```

Expected: all focused tests pass with no real LinkedIn requests.

- [ ] **Step 2: Build both consumers of the shared provider**

```bash
rtk pnpm run build:backend
rtk pnpm run build:orchestrator
```

Expected: both builds exit `0`.

- [ ] **Step 3: Check the implementation branch diff**

```bash
rtk git diff --check prod...HEAD
rtk git status --short
```

Expected: no whitespace errors and no uncommitted implementation files.

- [ ] **Step 4: Scan the tracked implementation diff for LinkedIn secrets**

```bash
rtk git diff prod...HEAD -- . ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*' | rtk rg -n "LINKEDIN_CLIENT_(ID|SECRET): '[^$]|client_secret=[A-Za-z0-9]" || true
```

Expected: no matches. Interpolation such as `${LINKEDIN_CLIENT_ID:?...}` is allowed and is excluded by the pattern.

---

### Task 6: LinkedIn application setup and production acceptance

**Files:**
- Modify on server only: `/root/postiz-app/.env` (untracked; never display or commit).

**Interfaces:**
- Consumes: a LinkedIn Developer application with the two self-service products and exact Vezdepost redirect URI.
- Produces: a connected personal LinkedIn channel and a successfully published personal text post.

- [ ] **Step 1: Configure the LinkedIn Developer application**

In the LinkedIn Developer Portal, enable these products:

```text
Sign In with LinkedIn using OpenID Connect
Share on LinkedIn
```

Under OAuth 2.0 authorized redirect URLs, add exactly:

```text
https://app.vezdepost.ru/integrations/social/linkedin
```

Copy the Client ID and Client Secret directly into the secure server editor;
do not paste either value into chat, a commit, or command output.

- [ ] **Step 2: Prepare production secrets before merging the required Compose interpolation**

Connect with `ssh vezdepost`, open `/root/postiz-app/.env` in a server-side
editor, set `LINKEDIN_CLIENT_ID` to the Client ID copied from the LinkedIn
Developer Portal, and set `LINKEDIN_CLIENT_SECRET` to the corresponding Client
Secret. Enter the values only in that editor.

Save the file with mode `600`. Verify names and non-empty state without values:

```bash
for name in LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET; do grep -Eq "^${name}=.+" /root/postiz-app/.env && echo "${name} SET" || exit 1; done
```

Expected: two `SET` lines and no credential values.

- [ ] **Step 3: Merge/deploy the verified implementation and recreate the app service**

After the implementation commits reach the production branch, run the tracked
script from the operator machine:

```bash
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost 'bash -s' < docs/server-scripts/13-configure-linkedin-personal.sh
```

Expected: Compose validation succeeds, `postiz` is recreated, and the script
prints only `LinkedIn personal OAuth credentials are present in the postiz container`.

- [ ] **Step 4: Verify the personal authorization request in the browser**

In Vezdepost, choose Add channel → LinkedIn personal profile. Before granting
access, confirm `client_id` is present and non-empty, and confirm these decoded
query parameter values:

```text
redirect_uri=https://app.vezdepost.ru/integrations/social/linkedin
scope=openid profile w_member_social
```

Confirm it does not contain `prompt=none`, `r_basicprofile`,
`rw_organization_admin`, `w_organization_social`, or `r_organization_social`.

- [ ] **Step 5: Complete OAuth and publish a plain-text acceptance post**

Grant access in LinkedIn, confirm the callback returns to Vezdepost and the
personal profile appears in the channel list. Publish a temporary plain-text
post to that channel and verify it appears on the authenticated member's
LinkedIn feed. Remove the temporary post from LinkedIn after verification if
it should not remain public.

- [ ] **Step 6: Capture non-secret acceptance evidence**

Record only:

```text
OAuth callback completed: yes/no
Personal channel visible: yes/no
Plain-text post published: yes/no
```

Do not record the authorization code, access token, refresh token, Client ID,
or Client Secret.
