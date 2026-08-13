# Tumblr Multipart Upload Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish valid images and videos through the existing Tumblr provider by emitting the exact multipart format required by Tumblr's Neue Post Format API.

**Architecture:** Replace native `FormData` serialization with a small private Buffer-based multipart builder so the JSON part has `application/json` and no filename. Keep media download, NPF identifiers, OAuth, error mapping, and text-only JSON posts unchanged. Deploy through one tested numbered server script that builds and recreates only `postiz` while holding the existing autodeploy lock.

**Tech Stack:** TypeScript, Node.js 22, Buffer, Vitest, Bash, Docker Compose, Tumblr NPF API

## Global Constraints

- Do not add a runtime dependency for multipart encoding.
- Do not change Tumblr OAuth, scopes, callback URLs, credentials, or token storage.
- Do not convert or recompress valid media.
- Do not change any other social provider.
- Never print tokens, secrets, production `.env`, cookies, post content, or media URLs.
- Prefix every operator shell command with `rtk`.
- Preserve unrelated tracked and untracked files.
- Use TDD: observe the regression test fail before changing provider code.
- Deploy only the `postiz` Compose service; do not restart PostgreSQL, Redis, Temporal, Caddy, or the full stack.
- Do not automatically retry failed calendar posts.
- Do not make another public test publication without explicit confirmation.

---

### Task 1: Standards-compliant Tumblr multipart body

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/tumblr.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/tumblr.provider.ts`

**Interfaces:**
- Consumes: the existing `TumblrProvider.post`, NPF payload, and downloaded media bytes.
- Produces: private `createMultipartBody(payload, media)` returning `{ body: Buffer; contentType: string }`.

- [ ] **Step 1: Write the failing provider tests**

Create `tumblr.provider.spec.ts` with the following focused harness and tests:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('axios', () => ({ default: { get: mocks.axiosGet } }));
vi.mock(
  '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: vi.fn(() => 'state-id'),
}));
vi.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: vi.fn((path: string, extension: string) =>
    path.split('?')[0].toLowerCase().endsWith(`.${extension}`)
  ),
}));
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tumblr.dto',
  () => ({ TumblrDto: class {} })
);
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {
    fetch = mocks.fetch;
    async getImageDimensions() {
      return { width: 912, height: 978 };
    }
    checkScopes() {
      return true;
    }
  },
}));

import { TumblrProvider } from './tumblr.provider';

const response = () =>
  ({
    json: vi.fn().mockResolvedValue({ response: { id_string: '42' } }),
  }) as unknown as Response;

const integration = {
  profile: 'https://test-blog.tumblr.com',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(response());
  mocks.axiosGet.mockResolvedValue({
    data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  });
});

describe('TumblrProvider multipart uploads', () => {
  it('sends JSON without a filename and image bytes in the matching media part', async () => {
    await new TumblrProvider().post(
      'test-blog',
      'access-token',
      [
        {
          id: 'post-1',
          message: 'image test',
          media: [
            {
              id: 'media-1',
              path: 'https://cdn.test/path/test image.png?signature=redacted',
              type: 'image',
            },
          ],
          settings: {},
        } as any,
      ],
      integration
    );

    const options = mocks.fetch.mock.calls[0][1] as RequestInit;
    const contentType = (options.headers as Record<string, string>)[
      'Content-Type'
    ];
    const boundary = contentType.replace('multipart/form-data; boundary=', '');
    const body = options.body as Buffer;
    const serialized = body.toString('latin1');

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(serialized).toContain(
      'Content-Disposition: form-data; name="json"\r\n' +
        'Content-Type: application/json\r\n\r\n'
    );
    expect(serialized).not.toContain('name="json"; filename=');
    expect(serialized).toContain(
      'Content-Disposition: form-data; name="media-0"; filename="test_image.png"\r\n' +
        'Content-Type: image/png\r\n\r\n'
    );
    expect(body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(serialized.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('keeps text-only posts as application/json requests', async () => {
    await new TumblrProvider().post(
      'test-blog',
      'access-token',
      [{ id: 'post-2', message: 'text only', media: [], settings: {} } as any],
      integration
    );

    const options = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    expect(typeof options.body).toBe('string');
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });

  it('keeps the safe Tumblr 8005 error message', () => {
    expect(
      new TumblrProvider().handleErrors(
        '{"errors":[{"code":8005,"detail":"unsupported"}]}',
        400
      )
    ).toEqual({
      type: 'bad-body',
      value: 'Tumblr rejected one of the uploaded media files.',
    });
  });
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/tumblr.provider.spec.ts
```

Expected: the multipart test fails because the current body is native
`FormData`, and its JSON part serializes with `filename="blob"`.

- [ ] **Step 3: Implement the minimal multipart builder**

In `tumblr.provider.ts`, add:

```ts
import { randomBytes } from 'node:crypto';

type TumblrMultipartMedia = {
  identifier: string;
  mimeType: string;
  filename: string;
  data: Buffer;
};
```

Add these private methods to `TumblrProvider`:

```ts
private sanitizeMediaFilename(path: string, fallback: string) {
  const withoutQuery = path.split('?')[0];
  const basename = withoutQuery.split('/').pop() || fallback;
  const sanitized = basename.replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized || fallback;
}

private createMultipartBody(
  payload: { content: TumblrContentBlock[]; [key: string]: any },
  media: TumblrMultipartMedia[]
) {
  const boundary = `PostizTumblr${randomBytes(12).toString('hex')}`;
  const chunks: Buffer[] = [];
  const appendText = (value: string) => {
    chunks.push(Buffer.from(value, 'utf8'));
  };

  appendText(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="json"\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      `${JSON.stringify(payload)}\r\n`
  );

  for (const part of media) {
    appendText(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${part.identifier}"; filename="${part.filename}"\r\n` +
        `Content-Type: ${part.mimeType}\r\n\r\n`
    );
    chunks.push(part.data);
    appendText('\r\n');
  }

  appendText(`--${boundary}--\r\n`);

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
```

Replace only the body of `createMultipartPost` with:

```ts
const parts: TumblrMultipartMedia[] = [];

for (const [index, item] of media.entries()) {
  const identifier = `media-${index}`;
  const mimeType = this.getMimeType(item.path);
  const { data } = await axios.get(this.getMediaUrl(item.path), {
    responseType: 'arraybuffer',
  });
  parts.push({
    identifier,
    mimeType,
    filename: this.sanitizeMediaFilename(item.path, identifier),
    data: Buffer.from(data),
  });
}

const multipart = this.createMultipartBody(payload, parts);
return (await (
  await this.fetch(
    `${TUMBLR_API_URL}/blog/${encodeURIComponent(blogName)}/posts`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': multipart.contentType,
        'User-Agent': TUMBLR_USER_AGENT,
      },
      body: multipart.body,
    }
  )
).json()) as TumblrCreatePostResponse;
```

- [ ] **Step 4: Run focused and adjacent verification**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/tumblr.provider.spec.ts
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts
rtk pnpm exec tsc --noEmit -p libraries/nestjs-libraries/tsconfig.lib.json
rtk git diff --check
```

Expected: all Vitest cases pass, TypeScript exits 0, and diff check is clean.

- [ ] **Step 5: Commit the provider fix**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/tumblr.provider.ts libraries/nestjs-libraries/src/integrations/social/tumblr.provider.spec.ts
rtk git commit -m 'fix: encode Tumblr media multipart correctly'
```

---

### Task 2: Guarded minimal production deployment

**Files:**
- Create: `docs/server-scripts/18-deploy-tumblr-multipart.sh`
- Create: `docs/server-scripts/18-deploy-tumblr-multipart.spec.sh`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: one validated 40-character production commit SHA as `$1`.
- Produces: a backed-up `postiz-max:local` image, server checkout at the exact SHA, and a healthy recreated `postiz` service.

- [ ] **Step 1: Write a failing shell contract test**

The spec must stub `git`, `docker`, `curl`, `flock`, and `sleep`, then assert:

```bash
grep -q '^fetch --no-recurse-submodules origin prod$' "$git_calls"
grep -q "^reset --hard $expected_rev$" "$git_calls"
grep -q '^tag postiz-max:local postiz-max:tumblr-multipart-backup-' "$docker_calls"
grep -q '^compose build postiz$' "$docker_calls"
grep -q '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls"
! grep -Eq '^compose (down|restart)|^restart ' "$docker_calls"
grep -q '^exec postiz sh -lc ' "$docker_calls"
grep -q '^exec temporal-admin-tools temporal task-queue describe ' "$docker_calls"
```

It must also assert that an invalid SHA exits before any `git reset`, Docker,
or curl call. Run it once before creating the deployment script and confirm the
missing-script failure.

- [ ] **Step 2: Implement the numbered deployment script**

Create `18-deploy-tumblr-multipart.sh` with these behaviors:

1. `set -euo pipefail`; validate `$1` against `^[0-9a-f]{40}$`.
2. Acquire `/var/lock/vezdepost-autodeploy.lock` with `flock -n 9` before any
   fetch, build, reset, or recreate.
3. Record the current server revision and tag `postiz-max:local` as
   `postiz-max:tumblr-multipart-backup-<UTC timestamp>`.
4. Poll `git fetch --no-recurse-submodules origin prod` until
   `origin/prod == $1`, with a maximum of 60 attempts at two seconds.
5. Run `git reset --hard "$expected_rev"`, `docker compose build postiz`, and
   `docker compose up -d --no-deps --force-recreate postiz`.
6. Verify non-empty `TUMBLR_CLIENT_ID` and `TUMBLR_CLIENT_SECRET` inside the
   container without printing values.
7. Poll container ports 3000, 4200, and 5000; require public `/api/user/self`
   to be neither 502 nor 000; require the Temporal `main` workflow poller.
8. Verify `mastra_ai_spans` has fewer than 1600 total attribute slots and print
   only the active/dropped/max counts.
9. Write the expected SHA to `/var/lib/vezdepost-deployed-rev` only after all
   checks pass.
10. On failure after checkout/build mutation, restore the recorded revision and
    backup image tag, recreate only `postiz`, and leave the backup image intact.

The script must never output environment values, `.env`, tokens, media URLs, or
post content.

- [ ] **Step 3: Document the operator sequence**

Append to `deploy/README.md`:

```bash
scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/18-deploy-tumblr-multipart.sh \
  vezdepost:/tmp/vezdepost-deploy-tumblr-multipart.sh
ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  "bash /tmp/vezdepost-deploy-tumblr-multipart.sh <40-char-prod-sha>"
```

Document that the remote script must be started before pushing the expected SHA
to `origin/prod`, so it holds the autodeploy lock while waiting.

- [ ] **Step 4: Verify and commit deployment tooling**

```bash
rtk bash docs/server-scripts/18-deploy-tumblr-multipart.spec.sh
rtk bash -n docs/server-scripts/18-deploy-tumblr-multipart.sh
rtk git diff --check
rtk git add docs/server-scripts/18-deploy-tumblr-multipart.sh docs/server-scripts/18-deploy-tumblr-multipart.spec.sh deploy/README.md
rtk git commit -m 'ops: deploy Tumblr multipart fix safely'
```

Expected: shell spec prints `Tumblr multipart deployment script tests passed`;
all other commands exit 0.

---

### Task 3: Integrate and deploy the exact production revision

**Files:**
- No new source files.
- Remote tracked checkout: `/root/postiz-app`.
- Remote image backup: `postiz-max:tumblr-multipart-backup-<timestamp>`.

**Interfaces:**
- Consumes: the tested feature branch and guarded deployment script.
- Produces: `origin/prod` and production at the same verified commit.

- [ ] **Step 1: Rebase on current production safely**

```bash
rtk git fetch origin prod
rtk git rebase origin/prod
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/tumblr.provider.spec.ts
rtk bash docs/server-scripts/18-deploy-tumblr-multipart.spec.sh
rtk git diff --check
```

Expected: rebase succeeds without losing task commits and all verification is
green. If rebase conflicts, stop and resolve only task-owned files.

- [ ] **Step 2: Start the guarded remote waiter**

Resolve the exact commit with `rtk git rev-parse HEAD`, copy script 18 to
`/tmp`, and start it against that SHA in an ongoing SSH session. Confirm it has
acquired the lock and is waiting for `origin/prod` before pushing.

- [ ] **Step 3: Push only a fast-forward production update**

```bash
rtk git push origin HEAD:prod
```

Expected: fast-forward success. A rejection means stop; do not force-push.

- [ ] **Step 4: Wait for deployment and independently verify**

Wait for script 18 to finish, then run read-only checks for:

- server `HEAD` equals the expected commit;
- `docker compose ps` shows every existing service running;
- both Tumblr environment variables report only `задана`;
- public API returns a non-502/non-000 status;
- ports 3000, 4200, and 5000 listen;
- backend, frontend, and orchestrator PM2 processes are stable;
- Temporal has a `main` poller;
- public `mastra_ai_spans` remains below the PostgreSQL attribute limit.

Do not print credentials or `.env` contents.

---

### Task 4: User-confirmed production image retry

**Files:**
- No repository or server file changes.

**Interfaces:**
- Consumes: healthy deployed provider and the existing failed Tumblr calendar post.
- Produces: one confirmed public PNG post or one concrete external blocker.

- [ ] **Step 1: Obtain explicit publication confirmation**

Ask the user once whether to retry one PNG publicly. Do not act without a clear
yes, even though the earlier pre-fix test was approved.

- [ ] **Step 2: Publish one PNG through Vezdepost**

Use only the test Tumblr integration. Prefer a fresh post to avoid ambiguous
Temporal history from the two failed records. Publish once and do not click a
second time while the first job is running.

- [ ] **Step 3: Verify the complete result**

Confirm:

- Vezdepost state is `PUBLISHED` with no error;
- a non-empty Tumblr release URL is stored;
- the public Tumblr post displays the PNG and full text;
- no duplicate post exists;
- provider logs contain no new Tumblr 8005 failure.

Record the remaining untested capability: video upload is not proven by this
PNG test.
