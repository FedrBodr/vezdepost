# Google OAuth Login Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple Google account login from YouTube OAuth configuration and deploy a working Google sign-in flow on `https://app.vezdepost.ru`.

**Architecture:** The backend `GOOGLE` auth provider will use a dedicated Google credential pair and a Google-specific `/auth?provider=GOOGLE` callback, with an atomic fallback to the legacy YouTube pair for existing installations. Compose will explicitly pass the new production secrets, while an idempotent server script validates configuration and the generated authorization URL without revealing credentials.

**Tech Stack:** TypeScript, NestJS, `googleapis`, Vitest, Docker Compose, Bash.

## Global Constraints

- Google login requests only `userinfo.profile` and `userinfo.email`; it must not request Gmail mailbox or YouTube permissions.
- Production credentials live only in the untracked server `.env` and must never appear in source, git history, build arguments, logs, or command output.
- Preserve compatibility for installations that configure only `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
- Do not modify the YouTube social integration.
- Use PNPM only and run lint/build commands from the repository root.
- Execute implementation in an isolated git worktree and preserve unrelated files in the primary checkout.

---

### Task 1: Dedicated Google OAuth provider configuration

**Files:**
- Create: `apps/backend/src/services/auth/providers/google.provider.spec.ts`
- Modify: `apps/backend/src/services/auth/providers/google.provider.ts`

**Interfaces:**
- Consumes: `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the legacy `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` environment variables.
- Produces: `GoogleProvider.generateLink(query?: { redirect_uri?: string }): string` and the existing token/profile methods, all using one validated credential pair.

- [ ] **Step 1: Write the failing provider tests**

Create `apps/backend/src/services/auth/providers/google.provider.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoogleProvider } from './google.provider';

const originalEnv = { ...process.env };

describe('GoogleProvider OAuth configuration', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FRONTEND_URL: 'https://app.vezdepost.ru',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      YOUTUBE_CLIENT_ID: 'youtube-client-id',
      YOUTUBE_CLIENT_SECRET: 'youtube-client-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers dedicated Google credentials and callback', () => {
    const url = new URL(new GoogleProvider().generateLink());

    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.vezdepost.ru/auth?provider=GOOGLE'
    );
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
  });

  it('uses an explicitly supplied redirect URI', () => {
    const url = new URL(
      new GoogleProvider().generateLink({
        redirect_uri: 'postiz://auth/callback',
      })
    );

    expect(url.searchParams.get('redirect_uri')).toBe(
      'postiz://auth/callback'
    );
  });

  it('falls back atomically to the legacy YouTube credential pair', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const url = new URL(new GoogleProvider().generateLink());

    expect(url.searchParams.get('client_id')).toBe('youtube-client-id');
  });

  it('rejects an incomplete dedicated Google credential pair', () => {
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => new GoogleProvider().generateLink()).toThrow(
      'Google OAuth is misconfigured: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  });

  it('fails clearly when no credential pair is configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;

    expect(() => new GoogleProvider().generateLink()).toThrow(
      'Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the current provider fails**

Run:

```bash
rtk pnpm exec vitest run apps/backend/src/services/auth/providers/google.provider.spec.ts
```

Expected: at least the dedicated client ID, Google callback, and missing-configuration assertions fail because the provider still reads `YOUTUBE_*` and uses the YouTube callback.

- [ ] **Step 3: Implement atomic credential selection and the new callback**

Replace the configuration helpers at the top of `google.provider.ts` with:

```ts
const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/auth?provider=GOOGLE`;

const getCredentials = () => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (googleClientId || googleClientSecret) {
    if (!googleClientId || !googleClientSecret) {
      throw new Error(
        'Google OAuth is misconfigured: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
      );
    }

    return { clientId: googleClientId, clientSecret: googleClientSecret };
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  }

  return { clientId, clientSecret };
};

const makeClient = (redirectUri: string) => {
  const { clientId, clientSecret } = getCredentials();
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
};
```

Keep `generateLink`, `getToken`, and `getUser` otherwise unchanged so explicit mobile redirect URIs and the existing account flow are preserved.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
rtk pnpm exec vitest run apps/backend/src/services/auth/providers/google.provider.spec.ts
```

Expected: `5 passed` and no network calls.

- [ ] **Step 5: Commit the provider change**

```bash
rtk git add apps/backend/src/services/auth/providers/google.provider.ts apps/backend/src/services/auth/providers/google.provider.spec.ts
rtk git commit -m "fix: separate Google login OAuth configuration"
```

---

### Task 2: Document and pass the dedicated environment variables

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yaml`
- Modify: `docker-compose.override.yaml`

**Interfaces:**
- Consumes: untracked server `.env` entries `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Produces: both variables in the `postiz` container environment; the base Compose example keeps optional empty defaults while the production override requires non-empty interpolation inputs.

- [ ] **Step 1: Add Google login variables to the configuration reference**

Insert immediately before `YOUTUBE_CLIENT_ID` in `.env.example`:

```dotenv
# Google account login (OAuth 2.0 Web application)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Insert immediately before `YOUTUBE_CLIENT_ID` in the base `docker-compose.yaml` environment block:

```yaml
      GOOGLE_CLIENT_ID: ''
      GOOGLE_CLIENT_SECRET: ''
```

- [ ] **Step 2: Require the variables in the Vezdepost production override**

Add below `VK_ID` in `docker-compose.override.yaml`:

```yaml
      GOOGLE_CLIENT_ID: '${GOOGLE_CLIENT_ID:?set in .env}'
      GOOGLE_CLIENT_SECRET: '${GOOGLE_CLIENT_SECRET:?set in .env}'
```

Also extend the header comment's secret list with `GOOGLE_CLIENT_ID=...` and `GOOGLE_CLIENT_SECRET=...`; include names only, never values.

- [ ] **Step 3: Validate the static configuration without production secrets**

Run the provider test again:

```bash
rtk pnpm exec vitest run apps/backend/src/services/auth/providers/google.provider.spec.ts
```

Expected: `5 passed`.

Check formatting and secret hygiene:

```bash
rtk git diff --check
rtk rg -n "GOOGLE_CLIENT_(ID|SECRET)" .env.example docker-compose.yaml docker-compose.override.yaml
```

Expected: only variable names, empty example values, and `${...}` interpolation appear; no real credential value is present.

- [ ] **Step 4: Commit environment wiring**

```bash
rtk git add .env.example docker-compose.yaml docker-compose.override.yaml
rtk git commit -m "chore: wire Google OAuth production settings"
```

---

### Task 3: Add an idempotent production verification script

**Files:**
- Create: `docs/server-scripts/09-configure-google-auth.sh`

**Interfaces:**
- Consumes: `/root/postiz-app/.env`, the production Compose project, and local HTTP endpoint `http://127.0.0.1:4007/api/auth/oauth/GOOGLE`.
- Produces: a recreated `postiz` service and non-secret pass/fail evidence for container variables, Google authorization host, client ID presence, and exact redirect URI.

- [ ] **Step 1: Write the server script**

Create `docs/server-scripts/09-configure-google-auth.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
EXPECTED_REDIRECT=${EXPECTED_REDIRECT:-https://app.vezdepost.ru/auth?provider=GOOGLE}
cd "$REPO_DIR"

for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if ! grep -Eq "^${name}=.+" .env; then
    echo "Missing non-empty ${name} in $REPO_DIR/.env" >&2
    exit 1
  fi
done

docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate postiz

for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if ! docker exec postiz sh -lc "test -n \"\${${name}:-}\""; then
    echo "${name} is missing in the running container" >&2
    exit 1
  fi
done

oauth_url=$(curl --fail --silent --show-error \
  --retry 10 --retry-delay 3 --retry-connrefused \
  http://127.0.0.1:4007/api/auth/oauth/GOOGLE)

EXPECTED_REDIRECT="$EXPECTED_REDIRECT" node -e '
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const url = new URL(body);
  if (url.hostname !== "accounts.google.com") {
    throw new Error("unexpected OAuth host");
  }
  if (!url.searchParams.get("client_id")) {
    throw new Error("missing client_id");
  }
  if (url.searchParams.get("redirect_uri") !== process.env.EXPECTED_REDIRECT) {
    throw new Error("unexpected redirect_uri");
  }
  console.log("Google OAuth configuration verified");
});
' <<<"$oauth_url"
```

- [ ] **Step 2: Validate script syntax and formatting**

```bash
rtk bash -n docs/server-scripts/09-configure-google-auth.sh
rtk git diff --check
```

Expected: both commands exit `0` with no secret values printed.

- [ ] **Step 3: Commit the operations script**

```bash
rtk git add docs/server-scripts/09-configure-google-auth.sh
rtk git commit -m "ops: verify Google OAuth production config"
```

---

### Task 4: Verify the repository change

**Files:**
- Test only; no new files.

**Interfaces:**
- Consumes: committed changes from Tasks 1–3.
- Produces: test, build, diff, and secret-scan evidence before deployment.

- [ ] **Step 1: Run the focused provider suite**

```bash
rtk pnpm exec vitest run apps/backend/src/services/auth/providers/google.provider.spec.ts
```

Expected: `5 passed`.

- [ ] **Step 2: Build the backend from the repository root**

```bash
rtk pnpm run build:backend
```

Expected: backend compilation exits `0`.

- [ ] **Step 3: Check the complete branch diff**

```bash
rtk git diff --check prod...HEAD
rtk git status --short
```

Expected: no whitespace errors and no uncommitted implementation files.

- [ ] **Step 4: Confirm no credential-shaped value entered git**

```bash
rtk git diff prod...HEAD -- . ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*' | rtk rg -n "GOCSPX-|[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com" || true
```

Expected: no matches.

---

### Task 5: Configure Google Cloud and deploy production secrets

**Files:**
- Modify on server only: `/root/postiz-app/.env` (untracked; never display or commit).

**Interfaces:**
- Consumes: a Google Cloud OAuth 2.0 **Web application** client with authorized redirect URI `https://app.vezdepost.ru/auth?provider=GOOGLE`.
- Produces: a working production Google consent, callback, token exchange, and Vezdepost session.

- [ ] **Step 1: Configure the Google OAuth client**

In Google Cloud Console, enable the Google Auth Platform for the selected project, configure its audience and consent information, and create an OAuth client of type **Web application**. Add this exact authorized redirect URI:

```text
https://app.vezdepost.ru/auth?provider=GOOGLE
```

No Gmail or YouTube API scope is required.

- [ ] **Step 2: Store credentials directly in the server `.env`**

Using a private interactive SSH session and a terminal editor, add
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with the exact values displayed
by Google Cloud. Then run `chmod 600 /root/postiz-app/.env` without reading the
file back to the terminal.

Do not paste either value into chat or run commands that echo the file.

- [ ] **Step 3: Deploy the implementation branch to `prod`**

Rebase the implementation branch onto the current deployment branch and push
the verified HEAD directly to `prod`:

```bash
rtk git fetch origin prod
rtk git rebase origin/prod
rtk git push origin HEAD:prod
```

Expected: the push succeeds without force. Poll the server using only commit
hashes until autodeploy reaches that HEAD:

```bash
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'cd /root/postiz-app && git rev-parse HEAD && docker ps --filter name=postiz --format "{{.Names}} {{.Status}}"'
```

Do not print `.env`.

- [ ] **Step 4: Run the idempotent server verification**

From the repository root on the operator machine:

```bash
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'bash -s' < docs/server-scripts/09-configure-google-auth.sh
```

Expected: `Google OAuth configuration verified` and no credentials in output.

- [ ] **Step 5: Complete a real browser acceptance test**

Open `https://app.vezdepost.ru/auth/login`, select **Continue with Google**, and verify:

1. Google displays the configured application consent/account chooser without `400: invalid_request` or `redirect_uri_mismatch`.
2. The browser returns to `https://app.vezdepost.ru/auth?provider=GOOGLE`.
3. An existing Google-linked user reaches the application, or a new Google user reaches the registration continuation.
4. No Gmail mailbox or YouTube permission is requested.

- [ ] **Step 6: Record final evidence**

Record the deployed commit hash, focused test result, backend build result, server script success, and browser acceptance result. Never record the client ID, client secret, or complete authorization URL.
