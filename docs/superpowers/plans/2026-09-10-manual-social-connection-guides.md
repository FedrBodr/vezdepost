# Manual Social Connection Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every registered custom-field social integration an always-visible, localized, novice-friendly connection guide.

**Architecture:** Provider classes continue to publish guide metadata through `customFieldsInstructions`; `IntegrationManager` already transports it and the existing `CustomFieldsInstructions` component renders it. A single metadata contract test prevents future manual integrations from shipping without guidance, while locale tests keep English and Russian complete.

**Tech Stack:** TypeScript, NestJS provider classes, React, i18next JSON locales, Vitest, pnpm.

## Global Constraints

- Cover Bluesky, DEV Community, Hashnode, Lemmy, Listmonk, Medium, Nostr, VK Group, and WordPress.
- Show the new guides expanded by default by omitting `collapsible`.
- Keep credential submission in the existing POST body; never put credentials in callback URLs.
- Prefer a dedicated or revocable credential whenever the platform provides one.
- Never ask users to send secrets to support or expose them in screenshots.
- Disclose that the Medium API is unsupported and retained only for existing integration-token users.
- Ship every new sentence in both English and Russian.

---

### Task 1: Enforce guide coverage for manual providers

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts`

**Interfaces:**
- Consumes: `SocialProvider.customFields`, `SocialProvider.customFieldsInstructions`.
- Produces: a regression contract requiring every registered provider with `customFields()` to expose a usable guide.

- [ ] **Step 1: Write the failing metadata test**

Create a table containing instances of `BlueskyProvider`, `DevToProvider`, `HashnodeProvider`, `LemmyProvider`, `ListmonkProvider`, `MediumProvider`, `NostrProvider`, `VkGroupProvider`, and `WordpressProvider`. For every item assert:

```ts
expect(provider.customFields).toBeTypeOf('function');
expect(provider.customFieldsInstructions?.title.trim()).not.toBe('');
expect(provider.customFieldsInstructions?.items.length).toBeGreaterThanOrEqual(2);
expect(provider.customFieldsInstructions?.collapsible).not.toBe(true);
```

Add focused assertions:

```ts
expect(bluesky.customFieldsInstructions?.items.join(' ')).toContain('App Password');
expect(wordpress.customFieldsInstructions?.items.join(' ')).toContain('Application Password');
expect(medium.customFieldsInstructions?.warning).toContain('no longer supports');
expect(nostr.customFieldsInstructions?.warning).toContain('private key');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts
```

Expected: FAIL because eight providers do not yet define `customFieldsInstructions`.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts
git commit -m "test: require manual connection guides"
```

### Task 2: Add novice-friendly provider metadata

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/dev.to.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/hashnode.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/lemmy.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/listmonk.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/medium.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/nostr.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/wordpress.provider.ts`

**Interfaces:**
- Consumes: `CustomFieldsInstructionsDefinition` as already serialized by `IntegrationManager`.
- Produces: `customFieldsInstructions` metadata on each manual provider.

- [ ] **Step 1: Add complete guide metadata**

Add these provider-owned guides, leaving `collapsible` unset:

```ts
// Bluesky
{
  title: 'Connect your Bluesky account',
  items: [
    'Open Bluesky Settings → Privacy and security → App passwords.',
    'Create an App Password named Vezdepost and copy it.',
    'Enter your Bluesky handle in Identifier and paste the App Password in Password.',
    'Keep https://bsky.social in Service unless your account uses another provider.',
  ],
  warning: 'Use an App Password, not your main Bluesky password. Treat it as a secret.',
}

// DEV Community
{
  title: 'Connect your DEV Community account',
  items: [
    'Open DEV Settings and go to Extensions.',
    'In DEV Community API Keys, enter Vezdepost as the description and generate a key.',
    'Copy the generated key and paste it into API key below.',
  ],
  warning: 'The API key is secret. Do not send it to support or include it in screenshots.',
}

// Hashnode
{
  title: 'Connect your Hashnode account',
  items: [
    'Open Hashnode Account Settings → Developer → API tokens.',
    'Create a Personal Access Token and copy it.',
    'Paste the token into API key below.',
  ],
  note: 'Publishing through the Hashnode API requires a publication with API publishing access.',
  warning: 'The token is secret. Do not send it to support or include it in screenshots.',
}

// Lemmy
{
  title: 'Connect your Lemmy account',
  items: [
    'In Service, enter the home address of the Lemmy website where your account was created.',
    'In Identifier, enter the username or email you use to sign in to that Lemmy website.',
    'Enter that account password and select Connect.',
  ],
  note: 'You do not need to create a developer application or API key.',
  warning: 'Your credentials must belong to the same Lemmy website entered in Service.',
}

// Listmonk
{
  title: 'Connect your Listmonk installation',
  items: [
    'In URL, enter the public base address of your Listmonk installation.',
    'Enter a Listmonk username and password that can access settings through the API.',
    'Select Connect; Vezdepost will verify the address and credentials.',
  ],
  note: 'Listmonk must already be installed and reachable from the internet over HTTP or HTTPS.',
  warning: 'Use a dedicated account when possible and do not share its password with support.',
}

// Medium
{
  title: 'Connect an existing Medium integration token',
  items: [
    'Open your Medium account settings and look for Integration tokens.',
    'If that section is available, create a token named Vezdepost and copy it.',
    'Paste the token into API key below.',
  ],
  note: 'If your settings do not show Integration tokens, this connection method is not available for your account.',
  warning: 'Medium no longer supports its API or accepts new integrations. Existing tokens may stop working, and the token must be treated as a secret.',
}

// Nostr
{
  title: 'Connect your Nostr account',
  items: [
    'Locate the private key for the Nostr account you want Vezdepost to publish from.',
    'Use the 64-character hexadecimal form of the key (hex), not an npub public key.',
    'Paste the hexadecimal private key into Nostr private key below.',
  ],
  note: 'If your wallet or client does not show a hexadecimal private key, do not use an unknown conversion website.',
  warning: 'A Nostr private key controls the account. Never send it to support, reuse it in screenshots, or share it with anyone.',
}

// WordPress
{
  title: 'Connect your WordPress site',
  items: [
    'Open WordPress admin, then go to Users → Profile → Application Passwords.',
    'Create an Application Password named Vezdepost and copy it when WordPress shows it.',
    'Enter the public HTTPS address of the site in Domain URL.',
    'Enter the WordPress username and paste the Application Password in Password.',
  ],
  note: 'The WordPress user must be allowed to create posts and upload media.',
  warning: 'Do not enter your normal wp-admin password. Application Passwords are separate and can be revoked.',
}
```

Update ambiguous password field hints so Bluesky says `App Password` and WordPress says `Application Password`.

- [ ] **Step 2: Run the metadata test and verify it passes**

Run the Task 1 Vitest command. Expected: 9 providers pass the common contract and all focused assertions pass.

- [ ] **Step 3: Commit provider metadata**

```bash
git add libraries/nestjs-libraries/src/integrations/social/*.provider.ts
git commit -m "feat: guide manual social connections"
```

### Task 3: Localize and verify every guide

**Files:**
- Modify: `libraries/react-shared-libraries/src/translation/locales/en/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ru/translation.json`
- Modify: `libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts`

**Interfaces:**
- Consumes: every string in provider `customFieldsInstructions`.
- Produces: complete English and Russian guide copy addressable through the existing `t(value, value)` convention.

- [ ] **Step 1: Extend the test to collect every guide string**

For each provider flatten `title`, `items`, `note`, `notRequired`, and `warning`, then assert that both locale JSON objects contain each string as a key. Switch i18next to Russian and assert every translated value differs from the English key.

- [ ] **Step 2: Run the test and verify it fails**

Run the Task 1 Vitest command. Expected: FAIL listing the new untranslated guide strings.

- [ ] **Step 3: Add English and natural Russian translations**

Add every string from Task 2 to both locale files. English values equal their keys. Russian copy must use familiar UI terms: «Настройки», «Пароли приложений», «токен», «адрес сайта», «имя пользователя», and «Подключить»; preserve product names and literal field names where needed.

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
pnpm run verify:workspace
git diff --check
```

Expected: all focused tests pass; frontend TypeScript, workspace bootstrap, and whitespace checks exit 0.

- [ ] **Step 5: Commit localization**

```bash
git add libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts
git commit -m "feat: localize manual connection guides"
```

### Task 4: Verify the combined onboarding changes

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: Telegram guided flow plus all manual provider guides.
- Produces: a clean, reviewable feature branch.

- [ ] **Step 1: Run the combined focused suite**

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/manual-connection-guides.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx
```

Expected: all test files pass with zero failures.

- [ ] **Step 2: Run static checks**

```bash
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
ESLINT_USE_FLAT_CONFIG=true pnpm exec eslint --config apps/frontend/eslint.config.mjs apps/frontend/src/components/launches/web3/providers/telegram.provider.tsx apps/frontend/src/components/launches/custom-fields-instructions.tsx
pnpm run verify:workspace
git diff --check
git status --short
```

Expected: all commands exit 0 and the worktree is clean. The repository may still print its known Node engine warning when run under Node 23.7.0.
