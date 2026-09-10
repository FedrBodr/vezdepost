# Manual social connection guides

## Context

Telegram exposed the general failure mode in the channel connection UI: the
form or command was visible, but the prerequisite actions and permissions were
not. The same risk exists for every integration that asks a user to paste a
password, API token, instance address, or private key.

This change covers the currently registered custom-field integrations:

- Bluesky
- DEV Community
- Hashnode
- Lemmy
- Listmonk
- Medium
- Nostr
- VK Group
- WordPress

Interactive integrations such as MAX, Moltbook, and Farcaster remain a
separate follow-up because they have their own state machines rather than the
shared custom-field form.

## User experience

Each manual connection form shows a short, always-visible numbered guide above
its fields. The guide answers, in order:

1. where the user should go;
2. which credential or value to create or copy;
3. which value belongs in each Vezdepost field;
4. which prerequisite or permission is required;
5. which value is secret and must not be shared.

Instructions use product language rather than API language where possible.
They must not assume the user knows what an API token, instance, application
password, or hexadecimal key is. Field labels and hints must distinguish an
account password from a dedicated application password.

Long provider-specific caveats are kept after the numbered steps. Security
warnings are visually separated from ordinary notes.

## Provider rules

### Bluesky

Ask for the account handle and a dedicated App Password, not the main account
password. Explain the path through Settings to App Passwords. The default
service remains `https://bsky.social`; users on another provider can replace
it.

### DEV Community

Explain that the key is generated in DEV settings and is copied once into the
API key field. Treat it as a secret.

### Hashnode

Explain the Account Settings → Developer → API tokens path. Note that API
publishing requires a publication with API publishing access; connecting an
account alone does not change the Hashnode plan.

### Medium

State before the field that Medium no longer supports its API and does not
allow new integrations. The form is retained for accounts that already have a
self-issued integration token. If the Integration Tokens section is absent,
the user cannot create a compatible token.

### WordPress

Ask for the public HTTPS site address, WordPress username, and a dedicated
Application Password created under Users → Profile. Explicitly say not to use
the normal wp-admin password and that the selected user needs permission to
create posts and upload media.

### Lemmy

Explain that Service is the home address of the user's Lemmy instance, while
Identifier is the username or email used to sign in to that instance. No
developer setup is required.

### Listmonk

Explain that URL is the base address of the Listmonk installation and that the
credentials must be able to access its API/settings. Self-hosting details are
outside the scope of this connection form.

### Nostr

Explain that the provider requires the existing private key in 64-character
hexadecimal form. Warn that this key controls the account and should never be
sent to support or exposed in screenshots. Do not suggest third-party key
conversion sites.

### VK Group

Keep the existing permission-specific guide. It already names the exact VK
sections, minimum access, and secret-handling rule.

## Architecture

Provider classes remain the source of truth through
`customFieldsInstructions`. No new API endpoint or credential handling path is
introduced. The integration manager already serializes this metadata and the
shared frontend form already renders it.

The shared instruction component remains intentionally presentation-only.
Provider definitions supply copy; locale files supply English and Russian
translations. This keeps secrets out of URLs and preserves the existing POST
connection flow.

## Error handling and safety

- Password and token fields remain masked.
- Instructions never ask a user to send a secret to support.
- Dedicated/revocable credentials are preferred when the platform offers
  them.
- Unsupported or legacy platform behavior is disclosed before submission.
- Existing backend credential verification remains authoritative.

## Tests

- A provider metadata test asserts that every registered custom-field
  integration has a non-empty instruction guide.
- Translation tests assert that every guide string exists in English and
  Russian.
- Existing shared-form tests continue to prove that credentials are submitted
  in the request body rather than embedded in callback URLs.
- Focused provider tests cover high-risk wording such as WordPress Application
  Passwords, Bluesky App Passwords, Medium legacy support, and Nostr key
  secrecy.

## Sources checked

- Forem API: https://developers.forem.com/api/
- WordPress Application Passwords: https://developer.wordpress.org/advanced-administration/security/application-passwords/
- Bluesky App Passwords: https://bsky.social/about/blog/5-19-2023-user-faq
- Hashnode API token guidance: https://hashnode.com/blog/hashnode-gql-agent-skill
- Medium API status and integration tokens: https://github.com/Medium/medium-api-docs/blob/master/README.md
