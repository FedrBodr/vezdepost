# Interactive Social Connection Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous MAX, Moltbook, and Farcaster connection screens with localized, recoverable, permission-aware guides.

**Architecture:** MAX receives a typed server verification contract and a React state machine parallel to Telegram. Moltbook keeps registration and claim polling in its component but validates claim URLs and sends the secret only in POST bodies. Farcaster keeps Neynar authentication and adds clear wrapper guidance.

**Tech Stack:** TypeScript, NestJS, React, Vitest, Testing Library, i18next, MAX Bot API SDK, pnpm.

## Global Constraints

- Work in the existing isolated `feat/telegram-guided-connection` worktree.
- Use exact commands and finite polling windows.
- Cancel stale polling attempts on retry and unmount.
- Never render, log, copy, or place a Moltbook API key in a URL.
- Translate every new user-facing sentence in English and Russian.
- Keep upstream failures recoverable and free of raw error details.

---

### Task 1: Verify MAX commands and permissions on the server

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/max.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/max.provider.ts`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`

**Interfaces:**
- Produces: `MaxConnectionResult` with `waiting | ready | bot_not_admin | missing_permissions | max_error`.
- Produces: `parseMaxConnectionMessage(text)` and `evaluateMaxPermissions(member)` pure helpers.
- Consumes: `getUpdates`, `getChat`, and `getChatMembership` from an injectable MAX API client.

- [ ] **Step 1: Write failing tests**

Cover exact `/connect nonce`, rejection of near matches, marker advancement, ready membership, missing admin, missing `read_all_messages`, missing `write`, candidate retry without `getUpdates`, and SDK rejection mapped to `max_error`.

- [ ] **Step 2: Run the provider test and confirm RED**

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/max.provider.spec.ts
```

Expected: FAIL because the helpers, statuses, injection point, and permission checks do not exist.

- [ ] **Step 3: Implement the typed contract**

Use:

```ts
export type MaxConnectionResult =
  | { status: 'waiting'; lastChatId?: number }
  | { status: 'ready'; chatId: number }
  | { status: 'bot_not_admin' | 'missing_permissions'; candidateChatId: number }
  | { status: 'max_error' };
```

`evaluateMaxPermissions` requires `is_admin === true` and both
`read_all_messages` and `write`. `getBotId({ word, id?, chatId? })` directly
rechecks `chatId` when present. Normalize controller query strings with
`Number.isFinite(Number(value))` before calling the provider.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/max.provider.spec.ts
git add libraries/nestjs-libraries/src/integrations/social/max.provider.ts libraries/nestjs-libraries/src/integrations/social/max.provider.spec.ts apps/backend/src/api/routes/integrations.controller.ts
git commit -m "feat: verify MAX connection permissions"
```

### Task 2: Build the guided MAX component

**Files:**
- Create: `apps/frontend/src/components/launches/web3/providers/max.connection.ts`
- Create: `apps/frontend/src/components/launches/web3/providers/max.connection.spec.ts`
- Create: `apps/frontend/src/components/launches/web3/providers/max.provider.spec.tsx`
- Modify: `apps/frontend/src/components/launches/web3/providers/max.provider.tsx`
- Modify: English and Russian `translation.json` locale files.

**Interfaces:**
- Consumes: `MaxConnectionResult`, `/integrations/max/updates`, `maxBotName`, and `onComplete(chatId, nonce)`.
- Produces: `buildMaxBotUrl`, `buildMaxConnectCommand`, and a destination-aware UI state machine.

- [ ] **Step 1: Write failing helper and component tests**

Assert safe bot URL normalization, command generation, group/channel choice,
visible command before polling, copy feedback, success callback, distinct
permission messages, candidate retry, 90-second timeout, and unmount
cancellation.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/max.connection.spec.ts apps/frontend/src/components/launches/web3/providers/max.provider.spec.tsx
```

- [ ] **Step 3: Implement the state machine and locales**

Render destination buttons first. The guide then links to
`https://max.ru/<bot-name>`, lists administrator permissions, shows and copies
`/connect <nonce>`, and starts/retries a cancellable polling attempt. Add all
copy under `max_connection_*` locale keys and assert both locales in the helper
test.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/max.connection.spec.ts apps/frontend/src/components/launches/web3/providers/max.provider.spec.tsx
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
git add apps/frontend/src/components/launches/web3/providers/max.connection.ts apps/frontend/src/components/launches/web3/providers/max.connection.spec.ts apps/frontend/src/components/launches/web3/providers/max.provider.tsx apps/frontend/src/components/launches/web3/providers/max.provider.spec.tsx libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: guide MAX channel connection"
```

### Task 3: Harden the Moltbook claim flow

**Files:**
- Create: `apps/frontend/src/components/launches/web3/providers/moltbook.connection.ts`
- Create: `apps/frontend/src/components/launches/web3/providers/moltbook.connection.spec.ts`
- Create: `apps/frontend/src/components/launches/web3/providers/moltbook.provider.spec.tsx`
- Modify: `apps/frontend/src/components/launches/web3/providers/moltbook.provider.tsx`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`
- Modify: English and Russian locale files.

**Interfaces:**
- Produces: `isAllowedMoltbookClaimUrl(url)` accepting only HTTPS,
  `www.moltbook.com`, and `/claim/`.
- Changes: `/integrations/moltbook/status` from GET query to POST JSON body `{ apiKey }`.

- [ ] **Step 1: Write failing helper/component tests**

Test the URL allowlist against protocol, hostname, credentials, and path
spoofs. Test explanation, successful registration, invalid claim URL, safe
registration error, POST-body status polling, success, two-minute timeout,
retry, and unmount cancellation.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/moltbook.connection.spec.ts apps/frontend/src/components/launches/web3/providers/moltbook.provider.spec.tsx
```

- [ ] **Step 3: Implement the safe flow**

Keep the API key only in a ref. Validate `claimUrl` before storing it. Poll the
backend with `POST` and `JSON.stringify({ apiKey })`. After two minutes show a
recoverable timeout and retain the claim page plus “Check again”. Return only
translated local errors from the component and generic errors from the route.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/moltbook.connection.spec.ts apps/frontend/src/components/launches/web3/providers/moltbook.provider.spec.tsx
git add apps/frontend/src/components/launches/web3/providers/moltbook.connection.ts apps/frontend/src/components/launches/web3/providers/moltbook.connection.spec.ts apps/frontend/src/components/launches/web3/providers/moltbook.provider.tsx apps/frontend/src/components/launches/web3/providers/moltbook.provider.spec.tsx apps/backend/src/api/routes/integrations.controller.ts libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: guide Moltbook agent claim"
```

### Task 4: Explain Farcaster authorization

**Files:**
- Create: `apps/frontend/src/components/launches/web3/providers/wrapcaster.provider.spec.tsx`
- Modify: `apps/frontend/src/components/launches/web3/providers/wrapcaster.provider.tsx`
- Modify: English and Russian locale files.

**Interfaces:**
- Consumes: existing `ButtonCaster` and `onComplete(code, state)`.
- Produces: localized pre-auth guidance without changing Neynar behavior.

- [ ] **Step 1: Write a failing UI test**

Mock `ButtonCaster`; assert two explanatory steps, the no-password/recovery
phrase warning, and callback forwarding.

- [ ] **Step 2: Run RED, implement copy, and run GREEN**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/wrapcaster.provider.spec.tsx
```

Remove unused imports, replace the broken placeholder sentence, add
`farcaster_connection_*` EN/RU keys, and retain the existing loading state.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/launches/web3/providers/wrapcaster.provider.tsx apps/frontend/src/components/launches/web3/providers/wrapcaster.provider.spec.tsx libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: explain Farcaster authorization"
```

### Task 5: Combined verification

**Files:** Verify only.

- [ ] **Step 1: Run all onboarding tests and static checks**

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/max.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx apps/frontend/src/components/launches/web3/providers/max.connection.spec.ts apps/frontend/src/components/launches/web3/providers/max.provider.spec.tsx apps/frontend/src/components/launches/web3/providers/moltbook.connection.spec.ts apps/frontend/src/components/launches/web3/providers/moltbook.provider.spec.tsx apps/frontend/src/components/launches/web3/providers/wrapcaster.provider.spec.tsx apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
pnpm run verify:workspace
git diff --check
git status --short
```

Expected: all tests and checks exit 0 and the worktree is clean.
