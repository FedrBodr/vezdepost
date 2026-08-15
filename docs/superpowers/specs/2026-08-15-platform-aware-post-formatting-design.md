# Platform-aware post formatting

## Goal

Make Vezdepost formatting predictable for each social network without losing
the convenience of one universal post. The editor, preview, publishing
validation, and the user's AI writing rules must rely on the same platform
capabilities.

The first delivery covers the seven currently active destinations:

- Telegram;
- MAX;
- LinkedIn;
- Tumblr;
- Pinterest;
- personal VK;
- VK Group.

The remaining integrations keep their current behavior through a compatible
fallback and will be covered after a separate capability audit.

Linear tracking: parent issue `FED-339`; current-stage issues `FED-340` through
`FED-345`; later-stage issues `FED-346` and `FED-347`.

## Product principles

1. A universal post remains the default when it preserves meaning and quality.
2. Platform-specific versions are created only when a real platform difference
   requires one.
3. Switching editors never silently deletes or rewrites the user's source
   content.
4. The preview shows the payload semantics that the destination will receive,
   including multi-message delivery.
5. The backend repeats authoritative validation before calling a provider API.
6. Existing providers without a capability profile continue to work as they do
   today.

## Capability registry

Add a shared `PlatformCapabilities` contract and a registry keyed by provider
identifier. It replaces scattered UI conditionals as the preferred source of
platform behavior while preserving the existing `editor` value as a fallback.

Each profile describes at least:

- output text mode: HTML, Markdown, plain text, or none;
- support for bold, underline, links, lists, and headings;
- maximum post text length;
- a distinct media-caption limit when applicable;
- supported media types, counts, and combinations;
- required provider-specific fields;
- handling of unsupported formatting;
- platform-specific delivery behavior, such as splitting media and text.

The contract belongs in a shared library that can be consumed by frontend and
server code. Provider API clients remain responsible for transport-specific
payload construction, but they must not redefine the same capabilities in a
second source of truth.

### Backward compatibility

For a provider with no explicit profile, derive a conservative fallback from
its existing `editor` mode and `maxLength()` behavior. This keeps all other
integrations operational while the detailed registry is rolled out gradually.

## Universal mode

Universal editor capabilities are the intersection of the profiles for the
channels selected in the current post, not the intersection of every provider
supported by Vezdepost.

The universal editor:

- exposes only formatting supported safely by every selected channel;
- uses the strictest applicable text limit;
- accounts for media-caption limits when media is attached;
- recommends a platform-specific version when one destination would materially
  reduce the quality or structure of the shared post;
- lets the user create that version as a copy without changing the universal
  source.

If selected providers do not yet have explicit profiles, their conservative
fallback participates in the intersection.

## Platform-specific mode

When the user selects one integration, the editor uses that platform's full
profile.

The UI must:

- show only supported formatting controls;
- show provider-specific fields in the existing provider settings area;
- display the correct text and caption counters;
- preview the normalized output rather than only the canonical editor HTML;
- explain platform delivery behavior before publication.

For Telegram, the preview must distinguish a media caption from a separate text
message. When visible text with media exceeds the 1,024-character caption
limit, it must show that media will be sent without a caption followed by the
full text. The existing 4,096-character message limit still applies.

### Existing unsupported formatting

Changing the selected destination must not mutate the canonical content. If it
contains unsupported formatting, the editor retains the source, disables tools
that cannot add more unsupported formatting, and shows both a warning and the
normalized preview.

Formatting loss alone is a warning when the resulting payload remains valid.
The user may publish after reviewing it.

## Normalization and validation

The publishing data flow is:

```text
canonical editor HTML
-> platform capability profile
-> HTML / Markdown / plain-text normalization
-> content and settings validation
-> normalized preview
-> server-side validation
-> provider API payload
```

Normalization preserves meaning, paragraph boundaries, supported links, and
supported emphasis. It removes or converts unsupported markup deterministically
and never invents replacement content.

Validation messages have three severities:

- **information**: expected delivery behavior, such as Telegram using two
  messages;
- **warning**: a valid but lossy conversion, such as an unsupported underline;
- **blocking error**: a payload the provider is expected to reject, such as a
  missing Pinterest image, a missing required setting, an unsupported media
  combination, or a hard length limit violation.

The frontend gives immediate feedback. The backend runs the same logical rules
again and is authoritative for publishing. Provider errors remain a final
external failure mode and must be sanitized before being shown to users.

## AI chat posting rules

Provide a reusable system prompt for the user's writing chat. Its workflow is:

1. Receive source material, verified facts, objective, CTA, media context, and
   selected destinations.
2. Produce a platform-neutral semantic core.
3. Compare the selected platform requirements.
4. Group platforms that can use one universal version without material loss.
5. Produce separate versions only for groups or individual platforms that
   require different limits, structure, tone, formatting, fields, links,
   hashtags, or media treatment.
6. Self-check facts, required fields, and limits before returning the result.

The prompt must prohibit invented facts, figures, quotes, links, and outcomes.
When essential input is absent, it asks one concise clarifying question.

The output is organized for transfer into Vezdepost:

```text
UNIVERSAL VERSION
Suitable for: <platform list>
Formatting notes: <only when useful>
Text:
<post>

<PLATFORM OR GROUP> — SEPARATE VERSION
Reason for adaptation: <short reason>
<provider-specific fields>
Text:
<post>
```

The initial prompt covers Telegram, MAX, LinkedIn, Tumblr, Pinterest, personal
VK, and VK Group. It does not automatically publish content.

## Error handling

- Unknown provider profiles use the conservative fallback and emit no false
  claims about detailed support.
- Missing capability data must not crash the editor or publishing worker.
- A mismatch between frontend and backend validation is resolved in favor of
  the backend response, with a user-facing message that identifies the field or
  platform constraint.
- Sanitized provider errors may identify the provider operation and corrective
  action but must not expose tokens, authorization headers, cookies, or raw
  secret-bearing responses.
- Existing stored posts remain readable and editable without data migration;
  the canonical content representation stays HTML in this phase.

## Testing

Automated coverage includes:

- registry lookup and conservative fallback;
- universal capability intersection for different channel selections;
- normalization from canonical HTML for all seven active destinations;
- bold, underline, links, lists, headings, emoji, entities, and line breaks;
- posts with and without media;
- text and caption boundary values;
- Telegram media captions at and above 1,024 visible characters;
- unsupported-format warnings and blocking validation errors;
- editor toolbar and counter changes when switching between universal and
  platform-specific modes;
- preservation of canonical source content across destination switches;
- existing provider test suites to prevent publishing regressions.

After deployment, Codex runs automated, server-side, and unauthenticated smoke
checks. Authenticated acceptance publication to personal social accounts remains
a concise manual checklist for the user.

## Rollout

### Phase 1: active destinations

1. Introduce the shared contract, registry, fallback, and intersection logic.
2. Add verified profiles for the seven active destinations.
3. Connect the editor, preview, counters, and warnings.
4. Connect normalization and authoritative backend validation.
5. Deliver the reusable AI chat rules.
6. Run the regression matrix and deploy with existing readiness checks.

### Phase 2: remaining integrations

1. Audit provider documentation and current adapters for supported formatting,
   limits, media constraints, and required fields.
2. Prioritize providers by use and behavioral similarity.
3. Add profiles in tested batches: plain-text, HTML/Markdown, media-first, and
   video-first.

No capability value for an unaudited provider should be presented as verified.

## Out of scope

- Replacing canonical HTML with a new rich-document AST.
- Rewriting every provider in the first phase.
- Automatically changing the meaning or tone of user content inside the editor.
- Automatically publishing AI-generated content.
- Authenticated acceptance actions in personal social accounts.
