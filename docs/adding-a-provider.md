Project: postiz-app
Document: playbook

# Adding a Social Provider to Postiz

Reusable playbook distilled from adding the MAX messenger provider (2026-07-04, see
`docs/superpowers/plans/2026-07-04-max-provider.md`) and the VK Group provider
(2026-07-13, see `docs/superpowers/specs/2026-07-13-vk-group-provider-design.md`).
Read this before adding or extending any provider.

## 1. Pick the connect-flow pattern first

Postiz has three established patterns. Choosing the right one determines 80% of the work.

| Pattern | Provider flag | Examples | When |
|---|---|---|---|
| **Plain OAuth** | (defaults) | X, VK (personal wall), Mastodon | One OAuth → one identity, post to that identity |
| **OAuth + page picker** | `isBetweenSteps = true` | Facebook, LinkedIn Page, Instagram, GMB, YouTube, Tumblr, VK Group | After OAuth the user picks one of N pages/groups/channels; one channel = one picked entity |
| **Bot connect (web3)** | `isWeb3 = true` | Telegram, MAX | No OAuth; bot added as channel admin, handshake via `/connect <word>` + backend polling endpoint |

A fourth axis: `customFields()` (self-hosted instances like Mastodon/WordPress — user enters URL/keys) and `isChromeExtension` (cookie-based). Rarely needed.

**Extending an existing provider to a second entity type** (personal → pages/groups): subclass it
(`LinkedinPageProvider extends LinkedinProvider`, `VkGroupProvider extends VkProvider`), new
`identifier`, `isBetweenSteps = true`. Don't fork the file, don't add post-time toggles.

## 2. Backend touchpoints

All provider logic lives in `libraries/nestjs-libraries/src/integrations/social/<name>.provider.ts`
(Controller → Service → Repository rule: the backend app only wires controllers).

- `class XxxProvider extends SocialAbstract implements SocialProvider`
- Required members: `identifier`, `name`, `scopes`, `editor` (`'normal' | 'html' | 'markdown'`),
  `maxLength()`, `generateAuthUrl()`, `authenticate()`, `refreshToken()`, `post()`.
  Optional: `comment()`, `pages()`/`companies()` + `reConnect()` (between-steps),
  `analytics()`, `maxConcurrentJob` (match the platform's rate limits), `@Plug`/`@Tool` decorators.
- Register: import + `new XxxProvider()` in
  `libraries/nestjs-libraries/src/integrations/integration.manager.ts` (`socialIntegrationList`).
- Bot-connect providers additionally need a polling endpoint in
  `apps/backend/src/api/routes/integrations.controller.ts` (mirror `GET /telegram/updates`).

### Facts that are easy to get wrong

- **OAuth redirect URI is always** `${FRONTEND_URL}/integrations/social/<identifier>` — the
  identifier IS the route. Every redirect URI must be registered in the platform's app settings.
  For non-HTTPS local dev the convention is wrapping with `https://redirectmeto.com/...`
  (see `vk.provider.ts`).
- **Token refresh never touches identity.** `integration.service.ts` `refreshToken()` persists only
  `{accessToken, refreshToken, expiresIn}`; `internalId`/name/picture stay as saved at connect
  time. So between-steps providers may return the *user* identity from `refreshToken()` — the
  page/group binding is not affected.
- **Between-steps flow plumbing** (`no.auth.integrations.controller.ts`): after `authenticate()`,
  if `isBetweenSteps && !refresh` the controller duck-types the provider for a `pages` or
  `companies` method, calls it with the access token, and returns the list to the frontend. The
  user's pick comes back via `POST /integrations/provider/:id/connect` → `saveProviderPage()` →
  provider `fetchPageInformation(token, data)` whose return value becomes the channel identity.
  `reConnect(id, requiredId, accessToken)` is separate and also REQUIRED for between-steps
  providers: the manual-reconnect flow (`no.auth.integrations.controller.ts`) and background
  refresh (`refresh.integration.service.ts`) call it to re-resolve the page/group identity —
  without it, a channel with an expired token can only be deleted and re-added.
- **TS visibility:** if a subclass must override a helper (e.g. media upload), the base method must
  be `protected`, not `private`.
- **Import-time safety:** module-level SDK/client construction must not throw when its env var is
  unset — one broken provider blocks ALL providers from loading.
- **Store what `post()` needs in the token fields.** `post(id, accessToken, ...)` receives the
  integration's `internalId` and `accessToken` (`token` column) — bot-connect providers store the
  chat id as `accessToken`; page providers store the page token there (Facebook) or encode the
  entity in `internalId` (VK Group uses `-{groupId}`).

## 3. Frontend touchpoints

- Provider post-settings/preview component:
  `apps/frontend/src/components/new-launch/providers/<name>/<name>.provider.tsx`, registered in
  `show.all.providers.tsx`. A subclass provider (pages variant) usually reuses the parent's
  component under the new identifier.
- **Page picker** (between-steps only): create via the `withContinueProvider` HOC
  (`continue-provider/with-continue-provider.tsx`, ~40 lines of config — copy
  `linkedin.continue.tsx`), register in `continue-provider/list.tsx` keyed by identifier.
- **Bot connect** (web3 only): component in `components/launches/web3/providers/`, registered in
  `web3.list.tsx`. If it needs a public variable (bot name), thread it through
  `variable.context.tsx` + all three `apps/frontend/src/app/*/layout.tsx` files.
- Icon: `apps/frontend/public/icons/platforms/<identifier>.png` (identifier = filename).
- SWR rule: every fetch in its own `useXxx` hook, via `useFetch` from
  `libraries/helpers/src/utils/custom.fetch.tsx`.

## 4. Config & deployment

- New env vars go to `.env.example` and `docker-compose.yaml`. OAuth client ids follow the
  `<PLATFORM>_ID` / `<PLATFORM>_SECRET` convention (VK ID uses only `VK_ID` — PKCE, no secret).
- On the vezdepost prod box: env lives in the untracked `.env` next to docker-compose
  (`docs/devops/deployment.md`); env-only change = edit `.env` + `docker compose up -d`.
- No DB migration is needed for a new provider — `providerIdentifier` is a plain string column.

## 5. Verification pattern

There are **no unit tests for providers** in this repo (checked 2026-07: no `*.provider.spec.ts`).
The established gate is:

1. `pnpm run build` (root) — backend + frontend + libraries compile.
2. `pnpm run lint` (root only).
3. Manual runtime test: connect a real test account/channel, publish a text post and a media post
   from the calendar, verify on-platform; test the comment/thread flow if implemented.

Don't introduce a Jest/SDK-mocking harness — it's an unsupported pattern here.

## 6. Fork discipline (vezdepost-specific)

This fork syncs weekly with upstream `gitroomhq/postiz-app`. To keep merges painless:

- Prefer **new files + one-line registrations** over editing upstream files.
- When an upstream file must change, keep the diff semantically minimal and upstream-PR-able
  (English naming, no fork-specific strings in shared code).
- English commit messages; provider `name` in English ("VK Group", not «VK Группа») —
  UI translation happens elsewhere.
